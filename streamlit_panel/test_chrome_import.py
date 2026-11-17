import copy
from datetime import date, datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import zipfile
from streamlit.testing.v1 import AppTest
from streamlit_panel.chrome_import import (
    validate_packet,
    receive_packet,
    fixture_signature,
    result_fingerprint,
    extension_zip,
)
from streamlit_panel.test_futbol24_ui import FakeApi
from streamlit_panel.api_client import ApiError

CHANNEL = "a" * 48
OPERATOR = "operator-test"


def packet(text="snapshot", **changes):
    return {
        "version": 1,
        "text": text,
        "id": hashlib.sha256(text.encode()).hexdigest(),
        "operator": OPERATOR,
        "channel": CHANNEL,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "count": 1,
        **changes,
    }


def fixture(score="0:0", internal_id="72499"):
    return {
        "id": internal_id,
        "internalId": internal_id,
        "date": "2026-11-11",
        "time": "21:30",
        "match": "Zamora – Atletico Barinas",
        "league": "Venecuela Kup",
        "sport": "Fudbal",
        "score": score,
        "ht": "0:0",
        "expectedStatus": "second_half",
    }


class ChromeImportTests(unittest.TestCase):
    def setUp(self):
        self.rows = [fixture()]
        self.api = Mock()
        self.api.preview.return_value = {"rows": self.rows, "errors": [], "warnings": []}
        self.api.monitor.return_value = {
            "monitor": {
                "watch": {
                    "date": "2026-11-11",
                    "sources": ["flash"],
                    "matches": copy.deepcopy(self.rows),
                },
                "enabled": False,
            }
        }
        self.session = {"chrome_date": date(2026, 11, 11)}

    def arm(self):
        self.session["chrome_auto_settings"] = {
            "fixtures": fixture_signature(self.rows),
            "date": "2026-11-11",
        }
        self.session["chrome_applied_fingerprint"] = result_fingerprint(self.rows)

    def receive(self, value=None):
        return receive_packet(value or packet(), self.api, OPERATOR, CHANNEL, self.session)

    def test_packet_rejects_other_operator_channel_modified_content_and_expired_reads(self):
        now = datetime.now(timezone.utc)
        for changes in [
            {"operator": "operator-other"},
            {"channel": "wrong"},
            {"id": "wrong"},
            {"text": ""},
            {"capturedAt": "invalid"},
            {"capturedAt": (now - timedelta(seconds=331)).isoformat()},
            {"capturedAt": (now + timedelta(seconds=31)).isoformat()},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_packet(packet(**changes), OPERATOR, CHANNEL, now)
        self.api.configure.assert_not_called()

    def test_first_snapshot_is_previewed_and_never_imported_without_operator_confirmation(self):
        self.assertTrue(self.receive())
        self.api.preview.assert_called_once_with("snapshot", "2026-11-11", "native")
        self.assertIn("chrome_pending", self.session)
        self.api.configure.assert_not_called()

    def test_approved_score_change_imports_into_current_operator_and_preserves_paused_checks(self):
        self.arm()
        self.api.preview.return_value["rows"] = [fixture("2:1")]
        value = packet(captureId="approved-change")
        self.receive(value)
        self.api.configure.assert_called_once_with(
            {"date": "2026-11-11", "sources": ["flash"], "matches": [fixture("2:1")]},
            False,
            imported=True,
            chrome_capture={
                "id": "approved-change",
                "capturedAt": value["capturedAt"],
                "automatic": True,
            },
        )
        self.assertNotIn("chrome_pending", self.session)

    def test_changed_fixture_set_and_partial_or_invalid_snapshots_pause_without_replacing_watch(
        self,
    ):
        for result in [
            {"rows": [fixture("0:0", "99999")], "errors": []},
            {"rows": [], "errors": []},
            {"rows": self.rows, "errors": ["Oštećen red"]},
        ]:
            with self.subTest(result=result):
                self.setUp()
                self.arm()
                self.api.preview.return_value = result
                self.receive()
                self.api.configure.assert_not_called()
                self.assertNotIn("chrome_auto_settings", self.session)
                self.assertIn("chrome_pending", self.session)

    def test_manual_import_or_changed_watch_cannot_be_silently_overwritten_by_old_pairing(self):
        self.arm()
        self.api.monitor.return_value["monitor"]["watch"]["matches"] = [fixture("0:0", "99999")]
        self.receive()
        self.api.configure.assert_not_called()
        self.assertNotIn("chrome_auto_settings", self.session)

    def test_new_reads_refresh_import_age_without_reimporting_duplicate_deliveries(self):
        self.arm()
        value = packet()
        self.assertTrue(self.receive(value))
        self.assertFalse(self.receive(value))
        self.api.configure.assert_called_once_with(
            self.api.monitor.return_value["monitor"]["watch"],
            False,
            imported=True,
            chrome_capture={
                "id": value["capturedAt"],
                "capturedAt": value["capturedAt"],
                "automatic": True,
            },
        )
        self.assertEqual(self.session["chrome_last_import"], value["capturedAt"])
        newer = packet(
            captureId="fresh-read",
            capturedAt=(datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),
        )
        self.assertTrue(self.receive(newer))
        self.assertEqual(self.api.configure.call_count, 2)
        self.assertEqual(self.session["chrome_last_import"], newer["capturedAt"])

    def test_unchanged_approved_read_requests_one_common_check_for_both_selected_sources(self):
        self.arm()
        snapshot = self.api.monitor.return_value["monitor"]
        snapshot["enabled"] = True
        snapshot["watch"]["sources"] = ["flash", "f24"]
        value = packet(captureId="common-cycle")
        self.assertTrue(self.receive(value))
        self.api.configure.assert_called_once_with(
            snapshot["watch"],
            True,
            imported=True,
            chrome_capture={
                "id": "common-cycle",
                "capturedAt": value["capturedAt"],
                "automatic": True,
            },
        )
        self.assertIn("pokreće se automatski", self.session["chrome_notice"])
        self.assertFalse(self.receive(value))
        self.api.configure.assert_called_once()

    def test_manual_reread_of_same_content_can_refresh_an_unconfirmed_preview(self):
        first = packet()
        self.receive(first)
        second = packet(requestId="manual-request")
        self.assertTrue(self.receive(second))
        self.assertEqual(
            self.session["chrome_pending"]["packet"]["capturedAt"], second["capturedAt"]
        )
        self.api.configure.assert_not_called()

    def test_score_changes_keep_backend_match_ids_instead_of_new_parser_ids(self):
        self.arm()
        self.api.monitor.return_value["monitor"]["watch"]["matches"][0]["id"] = "stable-backend-id"
        parsed = fixture("2:1")
        parsed["id"] = "new-parser-id"
        self.api.preview.return_value["rows"] = [parsed]
        self.receive(packet(captureId="new-score"))
        saved = self.api.configure.call_args.args[0]
        self.assertEqual(saved["matches"][0]["id"], "stable-backend-id")
        self.assertEqual(saved["matches"][0]["score"], "2:1")

    def test_older_read_cannot_replace_a_newer_import(self):
        self.arm()
        newer = packet(
            captureId="newer",
            capturedAt=(datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),
        )
        self.assertTrue(self.receive(newer))
        self.assertFalse(self.receive(packet(captureId="older")))
        self.api.configure.assert_called_once()
        self.assertEqual(self.session["chrome_last_import"], newer["capturedAt"])

    def test_extension_download_is_complete_and_excludes_server_configuration(self):
        with zipfile.ZipFile(io.BytesIO(extension_zip())) as archive:
            self.assertIsNone(archive.testzip())
            names = archive.namelist()
            self.assertEqual(len(names), len(set(names)))
            self.assertIn("manifest.json", names)
            self.assertIn("README.md", names)
            self.assertEqual(json.loads(archive.read("manifest.json"))["manifest_version"], 3)
            self.assertFalse(any("secret" in name or "operators" in name for name in names))

    def test_approved_date_survives_leaving_the_date_widget_page(self):
        self.arm()
        self.session.pop("chrome_date")
        self.session["chrome_base_date"] = "2026-11-11"
        self.api.preview.return_value["rows"] = [fixture("1:0")]
        self.receive()
        self.api.preview.assert_called_once_with("snapshot", "2026-11-11", "native")
        self.api.configure.assert_called_once()

    def test_failed_import_is_not_acknowledged_and_can_retry_the_same_delivery(self):
        self.arm()
        self.api.preview.return_value["rows"] = [fixture("1:0")]
        self.api.configure.side_effect = [ApiError("Temporary failure", 503), None]
        value = packet()
        with self.assertRaises(ApiError):
            self.receive(value)
        self.assertNotIn("chrome_received_id", self.session)
        self.assertTrue(self.receive(value))
        self.assertEqual(self.api.configure.call_count, 2)

    def test_paused_source_checks_are_visible_and_can_be_enabled_from_chrome_page(self):
        api = self.api
        api.me.return_value = {
            "id": OPERATOR,
            "name": "Test",
            "role": "operator",
            "authenticated": True,
        }
        payload = FakeApi().monitor()
        api.monitor.return_value = payload

        def configure(watch, enabled, **kwargs):
            payload["monitor"]["enabled"] = enabled

        api.configure.side_effect = configure
        with patch("streamlit_panel.api_client.ApiClient", return_value=api):
            app = AppTest.from_file(
                str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
            )
            app.session_state["auth_cookie"] = "test-cookie"
            app.session_state["user"] = {"id": OPERATOR}
            app.session_state["page"] = "Chrome uvoz"
            app.run()
            self.assertFalse(app.exception)
            self.assertTrue(
                any(
                    "Provere izvora su trenutno pauzirane" in notice.value for notice in app.warning
                )
            )
            app.button(key="chrome_enable_checks").click().run()
            self.assertFalse(app.exception)
            api.configure.assert_called_once_with(payload["monitor"]["watch"], True)
            self.assertTrue(
                any(
                    "provera Flashscore/Futbol24 rezultata je uključena" in caption.value
                    for caption in app.caption
                )
            )

    def test_streamlit_chrome_flow_requires_opt_in_preview_and_explicit_first_import(self):
        api = self.api
        api.me.return_value = {
            "id": OPERATOR,
            "name": "Test",
            "role": "operator",
            "authenticated": True,
        }
        original = FakeApi().monitor()
        api.monitor.return_value = original
        self.api.preview.return_value = {"rows": [fixture()], "errors": [], "warnings": []}
        with (
            patch("streamlit_panel.api_client.ApiClient", return_value=api),
            patch("streamlit_panel.chrome_import._bridge", return_value=packet()),
        ):
            app = AppTest.from_file(
                str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
            )
            app.session_state["auth_cookie"] = "test-cookie"
            app.session_state["user"] = {"id": OPERATOR}
            app.session_state["page"] = "Chrome uvoz"
            app.run()
            self.assertFalse(app.exception)
            self.assertEqual(len(app.get("download_button")), 1)
            api.preview.assert_not_called()
            app.session_state["chrome_channel"] = CHANNEL
            app.date_input(key="chrome_date").set_value(date(2026, 11, 11))
            app.checkbox(key="chrome_receive").check().run()
            self.assertFalse(app.exception)
            api.configure.assert_not_called()
            self.assertEqual(
                app.dataframe[0].value.iloc[0]["Utakmica"], "Zamora – Atletico Barinas"
            )
            app.checkbox(key="chrome_auto_requested").check()
            app.button(key="chrome_confirm").click().run()
            self.assertFalse(app.exception)
            api.configure.assert_called_once()
            self.assertTrue(api.configure.call_args.kwargs["chrome_capture"]["automatic"])
            self.assertEqual(
                api.configure.call_args.kwargs["chrome_capture"]["capturedAt"],
                app.session_state["chrome_last_import"],
            )
            self.assertIn("chrome_auto_settings", app.session_state)
            app.checkbox(key="chrome_receive").uncheck().run()
            self.assertNotIn("chrome_auto_settings", app.session_state)

    def test_monitor_explains_waiting_for_the_next_chrome_read_and_keeps_manual_check_available(
        self,
    ):
        api = self.api
        api.me.return_value = {
            "id": OPERATOR,
            "name": "Test",
            "role": "operator",
            "authenticated": True,
        }
        payload = FakeApi().monitor()
        payload["monitor"].update(enabled=True, syncWithImport=True, nextCheckAt=None)
        api.monitor.return_value = payload
        with patch("streamlit_panel.api_client.ApiClient", return_value=api):
            app = AppTest.from_file(
                str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
            )
            app.session_state["auth_cookie"] = "test-cookie"
            app.session_state["user"] = {"id": OPERATOR}
            app.run()
            self.assertFalse(app.exception)
            self.assertTrue(
                any("čeka se sledeće čitanje" in caption.value for caption in app.caption)
            )
            check_button = next(button for button in app.button if button.label == "Proveri sada")
            self.assertFalse(check_button.disabled)
            check_button.click().run()
            self.assertFalse(app.exception)
            api.check.assert_called_once_with(payload["monitor"]["watch"], True)


if __name__ == "__main__":
    unittest.main()
