import copy
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch
from streamlit.testing.v1 import AppTest
from streamlit_panel.presentation import SOURCE_NAMES


class FakeApi:
    def __init__(self, *args, **kwargs):
        pass

    def me(self):
        return {"id": "operator-test", "name": "Test", "role": "operator", "authenticated": True}

    def monitor(self):
        ref = {
            "state": "verified",
            "score": "6:0",
            "ht": "3:0",
            "eventState": "finished",
            "phase": "finished",
            "phaseLabel": "Završeno",
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "url": "https://www.futbol24.com/match/2026/11/11/example",
        }
        match = {
            "id": "one",
            "sport": "Fudbal",
            "match": "France U19 – Norway U19",
            "league": "Liga",
            "date": "2026-11-11",
            "time": "18:00",
            "score": "6:0",
            "ht": "3:0",
            "comparisonStatus": "match",
            "comparisonReason": "Rezultat i poluvreme se poklapaju.",
            "refs": {"flash": copy.deepcopy(ref), "f24": copy.deepcopy(ref)},
        }
        return {
            "monitor": {
                "watch": {"date": "2026-11-11", "sources": ["flash", "f24"], "matches": [match]},
                "enabled": False,
                "lastResult": None,
            },
            "view": {
                "counts": {"all": 1, "match": 1, "mismatch": 0, "unverified": 0},
                "matches": [match],
            },
        }

    def history(self, match_id):
        return {
            "events": [
                {
                    "at": "2026-11-11T20:00:00Z",
                    "internal": {"score": "6:0", "ht": "3:0"},
                    "refs": {"sofa": {"score": "6:0", "ht": "3:0"}},
                    "comparisonStatus": "match",
                }
            ]
        }


class Futbol24UITests(unittest.TestCase):
    def test_active_table_and_settings_offer_futbol24_instead_of_sofascore(self):
        with patch("streamlit_panel.api_client.ApiClient", FakeApi):
            app = AppTest.from_file(
                str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
            )
            app.session_state["auth_cookie"] = "unit-test-cookie"
            app.session_state["user"] = {"id": "operator-test"}
            app.run()
            self.assertFalse(app.exception)
            columns = app.dataframe[0].value.columns
            self.assertIn("Futbol24", columns)
            self.assertIn("Futbol24 · poluvreme", columns)
            self.assertNotIn("Sofascore", columns)
            self.assertNotIn("Razlog", columns)
            self.assertTrue(
                any(node.proto.label == "Otvori Futbol24" for node in app.get("link_button"))
            )
            app.sidebar.radio[0].set_value("Podešavanja").run()
            self.assertFalse(app.exception)
            options = app.multiselect[0].options
            self.assertIn("Futbol24", options)
            self.assertNotIn("Sofascore", options)
            self.assertEqual(list(SOURCE_NAMES), ["flash", "f24", "api"])

    def test_historical_sofascore_values_are_labelled_as_archived(self):
        from streamlit_panel.operations_ui import render_timeline

        with (
            patch("streamlit_panel.operations_ui.st.dataframe") as frame,
            patch("streamlit_panel.operations_ui.st.subheader"),
        ):
            render_timeline(FakeApi(), "one", lambda error: self.fail(str(error)))
        columns = frame.call_args.args[0].columns
        self.assertIn("Sofascore (arhiva)", columns)
        self.assertNotIn("Futbol24", columns)


if __name__ == "__main__":
    unittest.main()
