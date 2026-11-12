from datetime import date
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from streamlit.testing.v1 import AppTest
from cloud_runtime import bootstrap
from cloud_runtime.test_runtime import test_accounts, PASSWORD
from streamlit_panel.api_client import ApiClient

ROOT = Path(__file__).resolve().parents[1]


class Upload:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode()
        self.size = len(self.body)

    def getvalue(self):
        return self.body


class TeamAliasesUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.accounts = test_accounts()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sg-alias-ui-")
        self.environment = patch.dict(
            os.environ, {"SCOREGUARD_CLOUD_DATA_DIR": self.directory.name}
        )
        self.environment.start()

    def tearDown(self):
        if bootstrap._active:
            bootstrap._active.close()
        bootstrap._active = None
        bootstrap._active_key = None
        self.environment.stop()
        self.directory.cleanup()

    def login(self, username="Stefan"):
        app = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=25)
        app.secrets["OPERATOR_ACCOUNTS_JSON"] = self.accounts
        app.run()
        app.text_input(key="login_username").set_value(username)
        app.text_input(key="login_password").set_value(PASSWORD)
        app.button[0].click().run()
        self.assertFalse(app.exception)
        return app

    def submit(self, app, label):
        next(button for button in app.button if button.label == label).click().run()
        self.assertFalse(app.exception)

    def api(self, app):
        return ApiClient(app.session_state["auth_cookie"], app.session_state["user"]["id"])

    def test_details_open_mapping_form_save_the_Victoria_example_and_keep_sessions_separate(self):
        app = self.login()
        client = self.api(app)
        watch = {
            "date": "2026-11-11",
            "sources": ["flash"],
            "matches": [
                {
                    "id": "one",
                    "sport": "Fudbal",
                    "time": "13:00",
                    "league": "Kamerun 1",
                    "match": "Colombe – Victoria Utd Limbe",
                    "ht": "0:0",
                    "score": "1:0",
                }
            ],
        }
        client.configure(watch, False)
        app.run()
        app.button(key="link-clubs-one").click().run()
        self.assertFalse(app.exception)
        self.assertEqual(app.sidebar.radio[0].value, "Poveži nazive klubova")
        app.selectbox(key="alias_internal_pick").set_value("Victoria Utd Limbe").run()
        self.assertEqual(app.text_input(key="alias_internal_name").value, "Victoria Utd Limbe")
        app.text_input(key="alias_source_name").set_value("Victoria United")
        self.submit(app, "Sačuvaj povezivanje")
        self.assertEqual(client.team_aliases()["aliases"], [])
        app.checkbox(key="alias_confirmed").check()
        self.submit(app, "Sačuvaj povezivanje")
        self.assertEqual(app.dataframe[0].value.iloc[0]["Naziv na izvoru"], "Victoria United")
        self.assertEqual(client.team_aliases()["aliases"][0]["createdName"], "Stefan")
        other = self.login("Milos")
        other.sidebar.radio[0].set_value("Poveži nazive klubova").run()
        self.assertFalse(other.exception)
        self.assertEqual(self.api(other).team_aliases()["aliases"], [])
        self.assertTrue(
            any("Još nema sačuvanih povezivanja" in message.value for message in other.info)
        )
        app.run()
        self.assertEqual(len(client.team_aliases()["aliases"]), 1)
        self.submit(app, "Ukloni povezivanje")
        self.assertEqual(client.team_aliases()["aliases"], [])

    def test_backup_import_uses_real_operator_API_and_rejects_wrong_file_shapes(self):
        app = self.login()
        app.sidebar.radio[0].set_value("Poveži nazive klubova").run()
        payload = {
            "version": 1,
            "aliases": [
                {
                    "source": "all",
                    "internalName": "Victoria Utd Limbe",
                    "sourceName": "Victoria United",
                }
            ],
        }
        # AppTest does not implement file upload interactions; only the upload
        # widget is substituted. Validation and the HTTP service remain real.
        with patch("streamlit.file_uploader", return_value=Upload(payload)):
            app.run()
            app.checkbox(key="alias_import_confirmed").check()
            self.submit(app, "Uvezi povezivanja")
        self.assertEqual(self.api(app).team_aliases()["aliases"][0]["source"], "all")
        self.assertEqual(app.dataframe[0].value.iloc[0]["Izvor"], "Svi izvori")
        with patch("streamlit.file_uploader", return_value=Upload({"version": 1, "accounts": []})):
            app.run()
            app.checkbox(key="alias_import_confirmed").check()
            self.submit(app, "Uvezi povezivanja")
        self.assertEqual(len(self.api(app).team_aliases()["aliases"]), 1)
        self.assertTrue(app.error)

    def test_service_update_restarts_child_and_keeps_saved_links(self):
        with patch.object(bootstrap, "service_revision", return_value="version-one"):
            app = self.login()
            self.api(app).save_team_alias("flash", "Victoria Utd Limbe", "Victoria United", True)
            old = bootstrap._active.process
        with patch.object(bootstrap, "service_revision", return_value="version-two"):
            app.run()
            self.assertFalse(app.exception)
            self.assertNotEqual(bootstrap._active.process.pid, old.pid)
            self.assertIsNotNone(old.poll())
            self.assertEqual(
                self.api(app).team_aliases()["aliases"][0]["sourceName"], "Victoria United"
            )


if __name__ == "__main__":
    unittest.main()
