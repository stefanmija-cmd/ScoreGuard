import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest.mock import patch
from streamlit.testing.v1 import AppTest
from streamlit_panel.presentation import score_table_html, table_rows
from streamlit_panel.ui_test_helpers import ScoreTableParser, rendered_table, score_table
from streamlit_panel.test_futbol24_ui import FakeApi


class ScoreDisplayTests(unittest.TestCase):
    def setUp(self):
        self.match = {
            "id": "one",
            "match": "Team A – Team B",
            "time": "20:00",
            "league": "Liga",
            "score": "2:0",
            "ht": "1:0",
            "comparisonStatus": "mismatch",
            "refs": {
                "flash": {
                    "state": "verified",
                    "score": "2:1",
                    "ht": "1:0",
                    "checkedAt": datetime.now(timezone.utc).isoformat(),
                }
            },
        }

    def table(self, sources=None):
        return ScoreTableParser(score_table_html([self.match], sources or ["flash"]))

    def differences(self, table):
        return [(item["column"], item["part"], item["value"]) for item in table.differences]

    def test_only_away_score_values_differ_in_the_requested_example(self):
        table = self.table()
        self.assertEqual(table.frame().iloc[0]["Interno"], "2:0 (1:0)")
        self.assertEqual(table.frame().iloc[0]["Flashscore"], "2:1 (1:0)")
        self.assertEqual(
            self.differences(table),
            [("Flashscore", "score-away", "1")],
        )
        self.assertFalse(
            {
                "Source",
                "Poluvreme",
                "Flashscore · poluvreme",
                "Razlog",
                "Prioritet",
                "Obrada",
            }.intersection(table.headers)
        )

    def test_only_halftime_home_values_are_highlighted_when_current_scores_agree(self):
        self.match["refs"]["flash"].update(score="2:0", ht="0:0")
        self.assertEqual(
            self.differences(self.table()),
            [("Flashscore", "ht-home", "0")],
        )

    def test_each_source_is_compared_to_source_and_only_selected_sources_contribute(self):
        self.match["refs"]["f24"] = {**self.match["refs"]["flash"], "score": "3:0"}
        self.assertEqual(
            self.differences(self.table(["flash", "f24"])),
            [
                ("Flashscore", "score-away", "1"),
                ("Futbol24", "score-home", "3"),
            ],
        )
        self.match["refs"]["flash"]["score"] = "2:0"
        self.assertEqual(self.table().differences, [])
        self.assertEqual(
            self.differences(self.table(["flash", "f24"])),
            [("Futbol24", "score-home", "3")],
        )

    def test_only_flashscore_and_futbol24_values_are_marked_when_three_sources_disagree(self):
        self.match["refs"]["f24"] = {**self.match["refs"]["flash"], "score": "3:0"}
        self.match["refs"]["api"] = {**self.match["refs"]["flash"], "score": "5:4", "ht": "0:0"}
        table = self.table(["flash", "f24", "api"])
        self.assertEqual(
            self.differences(table),
            [("Flashscore", "score-away", "1"), ("Futbol24", "score-home", "3")],
        )
        self.assertEqual(table.frame().iloc[0]["API-Football"], "5:4 (0:0)")

    def test_stale_unverified_missing_and_future_references_never_create_red_values(self):
        original = copy.deepcopy(self.match["refs"]["flash"])
        now = datetime.now(timezone.utc)
        for updates in [
            {"stale": True},
            {"state": "unverified"},
            {"checkedAt": None},
            {"checkedAt": "invalid"},
            {"checkedAt": now.replace(tzinfo=None).isoformat()},
            {"checkedAt": (now - timedelta(seconds=331)).isoformat()},
            {"checkedAt": (now + timedelta(seconds=31)).isoformat()},
        ]:
            with self.subTest(updates=updates):
                self.match["refs"]["flash"] = {**original, **updates}
                self.assertEqual(self.table().differences, [])
        self.match["refs"] = {}
        self.assertEqual(self.table().frame().iloc[0]["Flashscore"], "— (—)")

    def test_missing_scores_are_not_zero_and_first_half_has_no_final_halftime(self):
        self.match.update(score="0:0", ht=None)
        self.match["refs"]["flash"].update(score="0:0", ht="0:0")
        self.assertEqual(self.table().frame().iloc[0]["Interno"], "0:0 (—)")
        self.assertEqual(self.table().differences, [])
        self.match.update(ht="0:0", expectedStatus="first_half")
        self.match["refs"]["flash"].update(phase="first_half", htRequired=False)
        table = self.table()
        self.assertEqual(table.frame().iloc[0]["Interno"], "0:0 (—)")
        self.assertEqual(table.frame().iloc[0]["Flashscore"], "0:0 (—)")
        self.assertEqual(table.differences, [])

    def test_extra_time_uses_regular_score_and_never_total_or_penalty_score(self):
        self.match.update(score="2:0")
        self.match["refs"]["flash"].update(
            score="2:0", phase="extra_time", current="3:1", penalties="4:3"
        )
        self.assertEqual(self.table().frame().iloc[0]["Flashscore"], "2:0 (1:0)")
        self.assertEqual(self.table().differences, [])

    def test_status_difference_alone_does_not_mark_agreeing_numbers(self):
        self.match["refs"]["flash"].update(score="2:0")
        self.assertEqual(self.table().differences, [])
        self.assertEqual(self.table().frame().iloc[0]["Provera"], "Neslaganje")

    def test_match_text_and_score_fallback_are_escaped(self):
        self.match.update(
            match='<img src=x onerror="alert(1)">',
            league="<script>bad()</script>",
            score="<svg/onload=alert(1)>",
        )
        markup = score_table_html([self.match], ["flash"])
        self.assertNotIn("<img", markup)
        self.assertNotIn("<script", markup)
        self.assertNotIn("<svg", markup)
        self.assertIn("&lt;img", markup)
        self.assertEqual(self.table().frame().iloc[0]["Utakmica"], self.match["match"])

    def test_plain_table_rows_keep_combined_scores_for_export(self):
        row = table_rows([self.match], ["flash"])[0]
        self.assertEqual(row["Interno"], "2:0 (1:0)")
        self.assertEqual(row["Flashscore"], "2:1 (1:0)")

    def test_streamlit_renders_same_precise_difference_in_table_and_details(self):
        payload = FakeApi().monitor()
        payload["view"]["matches"] = [self.match]
        payload["monitor"]["watch"]["matches"] = [self.match]
        payload["monitor"]["watch"]["sources"] = ["flash"]
        with (
            patch("streamlit_panel.api_client.ApiClient", FakeApi),
            patch.object(FakeApi, "monitor", return_value=payload),
        ):
            app = AppTest.from_file(
                str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
            )
            app.session_state["auth_cookie"] = "test-cookie"
            app.session_state["user"] = {"id": "operator-test"}
            app.run()
        self.assertFalse(app.exception)
        self.assertEqual(
            self.differences(ScoreTableParser(rendered_table(app))),
            [("Flashscore", "score-away", "1")],
        )
        details = [
            item.proto.body
            for item in app.get("html")
            if 'class="sg-score-line"' in item.proto.body
        ]
        self.assertEqual(len(details), 2)
        self.assertNotIn('class="sg-score-diff"', details[0])
        self.assertIn("Interno", details[0])
        self.assertIn(
            'data-part="score-away" title="Neslaganje: rezultat gosta">1</strong>', details[1]
        )

    def test_paging_filter_and_search_still_work_with_the_compact_table(self):
        payload = FakeApi().monitor()
        matches = [
            {
                **copy.deepcopy(self.match),
                "id": str(index),
                "match": "Team " + str(index) + " – Guest",
            }
            for index in range(121)
        ]
        matches[-1]["comparisonStatus"] = "match"
        payload["view"]["matches"] = matches
        payload["monitor"]["watch"]["matches"] = matches
        with (
            patch("streamlit_panel.api_client.ApiClient", FakeApi),
            patch.object(FakeApi, "monitor", return_value=payload),
        ):
            app = AppTest.from_file(
                str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
            )
            app.session_state["auth_cookie"] = "test-cookie"
            app.session_state["user"] = {"id": "operator-test"}
            app.run()
            self.assertFalse(app.exception)
            self.assertEqual(len(score_table(app)), 100)
            app.number_input(key="monitor_page_number").set_value(2).run()
            self.assertFalse(app.exception)
            self.assertEqual(len(score_table(app)), 21)
            app.radio(key="result_filter").set_value("Usaglašeno").run()
            self.assertFalse(app.exception)
            self.assertEqual(score_table(app).iloc[0]["Utakmica"], "Team 120 – Guest")
            app.radio(key="result_filter").set_value("Svi mečevi").run()
            app.text_input(key="search").set_value("Team 119").run()
            self.assertFalse(app.exception)
            self.assertEqual(score_table(app).iloc[0]["Utakmica"], "Team 119 – Guest")


if __name__ == "__main__":
    unittest.main()
