from datetime import date
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from streamlit.testing.v1 import AppTest
from cloud_runtime import bootstrap
from cloud_runtime.test_runtime import test_accounts, PASSWORD


class CloudAppTests(unittest.TestCase):
    def test_cloud_notice_has_toolbar_clearance_before_login_in_both_storage_modes(self):
        path = str(Path(__file__).resolve().parents[1] / "streamlit_app.py")
        for durable in (False, True):
            with self.subTest(durable=durable):
                runtime = SimpleNamespace(
                    status=lambda: {"running": True, "durableStorage": durable, "error": None}
                )
                with (
                    patch("cloud_runtime.bootstrap.boot_cloud", return_value=runtime),
                    patch.dict(os.environ, {"SCOREGUARD_CLOUD": "1"}),
                ):
                    app = AppTest.from_file(path, default_timeout=20).run()
                self.assertFalse(app.exception)
                self.assertEqual(app.text_input(key="login_username").label, "Korisničko ime")
                elements = list(app.main)
                style_index = next(
                    i
                    for i, element in enumerate(elements)
                    if element.type == "markdown" and "padding-top: 5rem" in element.value
                )
                notice_index = next(
                    i
                    for i, element in enumerate(elements)
                    if element.type == ("info" if durable else "warning")
                )
                self.assertLess(style_index, notice_index)
                self.assertIn("padding-top: 5.5rem", elements[style_index].value)
                self.assertFalse(any("padding-top: 2rem" in item.value for item in app.markdown))

    def tearDown(self):
        if bootstrap._active:
            bootstrap._active.close()
        bootstrap._active = None
        bootstrap._active_key = None

    def test_missing_secrets_shows_setup_instructions(self):
        app = AppTest.from_file(
            str(Path(__file__).resolve().parents[1] / "streamlit_app.py"), default_timeout=20
        ).run()
        self.assertFalse(app.exception)
        self.assertTrue(any("Secrets" in error.value for error in app.error))

    def test_root_cloud_entrypoint_logs_in_imports_and_isolates_two_operator_sessions(self):
        with (
            tempfile.TemporaryDirectory(prefix="sg-cloud-app-test-") as directory,
            patch.dict(os.environ, {"SCOREGUARD_CLOUD_DATA_DIR": directory}),
        ):
            try:
                path = str(Path(__file__).resolve().parents[1] / "streamlit_app.py")
                config = test_accounts()
                app = AppTest.from_file(path, default_timeout=25)
                app.secrets["OPERATOR_ACCOUNTS_JSON"] = config
                app.run()
                self.assertFalse(app.exception)
                app.text_input(key="login_username").set_value("Stefan")
                app.text_input(key="login_password").set_value(PASSWORD)
                app.button[0].click().run()
                self.assertFalse(app.exception)
                self.assertTrue(any("Stefan" in value.value for value in app.sidebar.markdown))
                pid = bootstrap._active.process.pid
                app.sidebar.radio[0].set_value("Uvoz mečeva").run()
                app.date_input(key="import_date").set_value(date(2026, 11, 11))
                app.text_area(key="import_text").set_value(
                    "F\nVenecuela Kup\n72499\nZamora\nAtletico Barinas\nsre 21:30\nFT\n0\n0\n0:0\n2nd half"
                )
                next(
                    button for button in app.button if button.label == "Pregledaj unos"
                ).click().run()
                self.assertFalse(app.exception)
                app.checkbox(key="import_enabled").uncheck()
                next(
                    button for button in app.button if button.label == "Uvezi mečeve"
                ).click().run()
                app.sidebar.radio[0].set_value("Pregled mečeva").run()
                self.assertFalse(app.exception)
                self.assertEqual(
                    app.dataframe[0].value.iloc[0]["Utakmica"], "Zamora – Atletico Barinas"
                )
                other = AppTest.from_file(path, default_timeout=25)
                other.secrets["OPERATOR_ACCOUNTS_JSON"] = config
                other.run()
                other.text_input(key="login_username").set_value("Milos")
                other.text_input(key="login_password").set_value(PASSWORD)
                other.button[0].click().run()
                self.assertFalse(other.exception)
                self.assertTrue(
                    any("Još nema unetih mečeva" in value.value for value in other.info)
                )
                self.assertEqual(bootstrap._active.process.pid, pid)
                self.assertTrue(
                    any(
                        "privrem" in value.value or "izgubljeni" in value.value
                        for value in other.warning
                    )
                )
            finally:
                if bootstrap._active:
                    bootstrap._active.close()


if __name__ == "__main__":
    unittest.main()
