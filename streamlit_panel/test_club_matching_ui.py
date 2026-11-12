import unittest
from pathlib import Path
from unittest.mock import patch
from streamlit.testing.v1 import AppTest


class FakeApi:
    def __init__(self, *args, **kwargs):
        pass

    def me(self):
        return {"id": "operator-test", "name": "Test", "role": "operator", "authenticated": True}

    def monitor(self):
        match = {
            "id": "one",
            "sport": "Fudbal",
            "match": "Zamora – Atletico Barinas",
            "league": "Venecuela Kup",
            "date": "2026-11-11",
            "time": "21:30",
            "score": "1:0",
            "ht": "0:0",
            "comparisonStatus": "match",
            "refs": {
                "flash": {
                    "state": "verified",
                    "score": "1:0",
                    "ht": "0:0",
                    "sourceHome": "Zamora",
                    "sourceAway": "Atletico Barinas",
                    "sourceLeague": "Copa Venezuela",
                    "stale": False,
                }
            },
            "ack": None,
        }
        return {
            "monitor": {
                "watch": {"date": "2026-11-11", "sources": ["flash"], "matches": [match]},
                "enabled": False,
                "lastResult": None,
            },
            "view": {
                "counts": {"all": 1, "match": 1, "mismatch": 0, "unverified": 0},
                "matches": [match],
            },
        }


class ClubMatchUITest(unittest.TestCase):
    def test_automatic_similarity_is_explained_in_details_without_a_new_table_column(self):
        payload = FakeApi().monitor()
        ref = payload["view"]["matches"][0]["refs"]["flash"]
        ref["matching"] = {
            "method": "similarity",
            "homeSimilarity": 0.8,
            "awaySimilarity": 26 / 31,
            "threshold": 0.8,
        }
        with (
            patch("streamlit_panel.api_client.ApiClient", FakeApi),
            patch.object(FakeApi, "monitor", return_value=payload),
        ):
            app = AppTest.from_file(
                str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
            )
            app.session_state["auth_cookie"] = "unit-test-placeholder"
            app.session_state["user"] = {"id": "operator-test"}
            app.run()
        self.assertFalse(app.exception)
        self.assertTrue(
            any(
                "Automatsko povezivanje" in caption.value
                and "80.0%" in caption.value
                and "83.9%" in caption.value
                for caption in app.caption
            )
        )
        self.assertNotIn("Razlog", app.dataframe[0].value.columns)
        self.assertEqual(app.dataframe[0].value.iloc[0]["Provera"], "Usaglašeno")

    def test_details_show_source_clubs_and_competition_without_requiring_equal_labels(self):
        path = str(Path(__file__).with_name("streamlit_app.py"))
        with patch("streamlit_panel.api_client.ApiClient", FakeApi):
            app = AppTest.from_file(path, default_timeout=20)
            app.session_state["auth_cookie"] = "unit-test-placeholder"
            app.session_state["user"] = {"id": "operator-test"}
            app.run()
        self.assertFalse(app.exception)
        self.assertTrue(
            any(
                "Copa Venezuela" in caption.value and "Zamora" in caption.value
                for caption in app.caption
            )
        )
        self.assertEqual(app.dataframe[0].value.iloc[0]["Provera"], "Usaglašeno")

    def test_finished_examples_keep_the_reason_in_details_only(self):
        reason = "Rezultat i poluvreme se poklapaju sa svim izabranim izvorima. Flashscore: Završeno. Interna oznaka „FT / 2nd half“ može ostati i posle završetka utakmice."
        payload = FakeApi().monitor()
        first = payload["view"]["matches"][0]
        first.update(
            match="Austria U19 – Belarus U19",
            score="0:1",
            ht="0:0",
            comparisonReason=reason,
            native={"market": "FT", "phase": "2nd half"},
        )
        second = {
            **first,
            "id": "two",
            "match": "France U19 – Norway U19",
            "score": "6:0",
            "ht": "3:0",
        }
        payload["view"]["matches"] = [first, second]
        payload["view"]["counts"] = {"all": 2, "match": 2, "mismatch": 0, "unverified": 0}
        payload["monitor"]["watch"]["matches"] = [first, second]
        path = str(Path(__file__).with_name("streamlit_app.py"))
        with (
            patch("streamlit_panel.api_client.ApiClient", FakeApi),
            patch.object(FakeApi, "monitor", return_value=payload),
        ):
            app = AppTest.from_file(path, default_timeout=20)
            app.session_state["auth_cookie"] = "unit-test-placeholder"
            app.session_state["user"] = {"id": "operator-test"}
            app.run()
            self.assertFalse(app.exception)
            frame = app.dataframe[0].value
            self.assertEqual(frame["Provera"].tolist(), ["Usaglašeno", "Usaglašeno"])
            self.assertNotIn("Razlog", frame.columns)
            self.assertTrue(any(reason == message.value for message in app.success))
            first.update(
                comparisonStatus="mismatch",
                comparisonReason="Poluvreme: interno 0:0, Flashscore 0:1.",
            )
            app.run()
            self.assertFalse(app.exception)
            self.assertEqual(app.dataframe[0].value.iloc[0]["Provera"], "Neslaganje")
            self.assertTrue(
                any(
                    "Poluvreme: interno 0:0, Flashscore 0:1." == message.value
                    for message in app.error
                )
            )


if __name__ == "__main__":
    unittest.main()
