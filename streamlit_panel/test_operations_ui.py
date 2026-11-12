from datetime import datetime, timezone
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from streamlit.testing.v1 import AppTest
from streamlit_panel.operations_ui import detect_alerts
from streamlit_panel.presentation import input_age


class FakeApi:
    workflow = None
    signature = "score-2-0"
    calls = []
    case_requests = []

    def __init__(self, *args, **kwargs):
        pass

    def me(self):
        return {"id": "operator-milos", "name": "Milos", "role": "operator", "authenticated": True}

    def monitor(self):
        at = datetime.now(timezone.utc).isoformat()
        match = {
            "id": "one",
            "sport": "Fudbal",
            "time": "18:00",
            "date": "2026-11-11",
            "internalId": "12345",
            "match": "Team A – Team B",
            "league": "Liga",
            "score": "1:0",
            "ht": "0:0",
            "comparisonStatus": "mismatch",
            "comparisonReason": "Rezultat: interno 1:0, Flashscore 2:0.",
            "priority": 0,
            "priorityLabel": "1 · Završeni meč",
            "alertSignature": self.signature,
            "importedAt": at,
            "refs": {
                "flash": {
                    "state": "verified",
                    "score": "2:0",
                    "ht": "0:0",
                    "phase": "finished",
                    "phaseLabel": "Završeno",
                    "eventState": "finished",
                    "checkedAt": at,
                }
            },
            "workflow": copy.deepcopy(self.workflow),
        }
        watch = {"date": "2026-11-11", "sources": ["flash"], "matches": [match]}
        return {
            "operations": True,
            "monitor": {"watch": watch, "enabled": False, "lastResult": None, "importedAt": at},
            "view": {
                "counts": {"all": 1, "match": 0, "mismatch": 1, "unverified": 0},
                "matches": [match],
            },
            "storage": {"mode": "local", "durable": False, "state": "ready"},
        }

    def history(self, match_id):
        match = self.monitor()["view"]["matches"][0]
        return {
            "events": [
                {
                    "at": match["importedAt"],
                    "internal": {"score": "1:0", "ht": "0:0"},
                    "refs": match["refs"],
                    "comparisonStatus": "mismatch",
                }
            ]
        }

    def case_action(self, case_id, action, version, note=""):
        self.calls.append((action, case_id, version, note))
        self.workflow["version"] += 1
        self.workflow["workStatus"] = {
            "claim": "in_progress",
            "resolve": "resolved",
            "release": "new",
            "reopen": "new",
        }[action]
        self.workflow["owner"] = "operator-milos" if action in ("claim", "resolve") else None
        self.workflow["ownerName"] = "Milos" if self.workflow["owner"] else None
        return {"case": self.workflow}

    def cases(self, offset=0, resolved=False, owner="", query=""):
        self.case_requests.append((offset, resolved, owner, query))
        if self.workflow["workStatus"] == "resolved" and not resolved:
            return {"total": 0, "cases": []}
        match = self.monitor()["view"]["matches"][0]
        evidence = {
            "date": match["date"],
            "match": match["match"],
            "operator": "operator-test",
            "internal": {"score": "1:0", "ht": "0:0"},
            "refs": match["refs"],
            "signature": self.signature,
        }
        return {
            "total": 1,
            "cases": [
                {
                    **self.workflow,
                    "evidence": evidence,
                    "priority": 0,
                    "comparisonStatus": "mismatch",
                    "comparisonReason": match["comparisonReason"],
                    "operatorCount": 2,
                    "events": [],
                }
            ],
        }

    def backup(self):
        return {
            "app": "ScoreGuard",
            "version": 2,
            "watch": self.monitor()["monitor"]["watch"],
            "aliases": [],
            "history": [],
        }


class OperationsUITests(unittest.TestCase):
    def setUp(self):
        FakeApi.workflow = {
            "id": "a" * 32,
            "workStatus": "new",
            "owner": None,
            "ownerName": None,
            "version": 2,
        }
        FakeApi.signature = "score-2-0"
        FakeApi.calls = []
        FakeApi.case_requests = []

    def app(self):
        app = AppTest.from_file(
            str(Path(__file__).with_name("streamlit_app.py")), default_timeout=20
        )
        app.session_state["auth_cookie"] = "test-only-cookie"
        app.session_state["user"] = {"id": "operator-milos"}
        app.run()
        self.assertFalse(app.exception)
        return app

    def test_alarm_ignores_repeat_polls_and_detects_changes_and_reappearance(self):
        match = {
            "id": "one",
            "match": "A – B",
            "comparisonStatus": "mismatch",
            "alertSignature": "difference-1",
        }
        first, events = detect_alerts([match], None)
        self.assertEqual(events, [])
        self.assertEqual(detect_alerts([match], first)[1], [])
        self.assertEqual(
            len(detect_alerts([{**match, "alertSignature": "difference-2"}], first)[1]), 1
        )
        self.assertEqual(len(detect_alerts([match], {})[1]), 1)
        self.assertEqual(
            input_age("2026-11-11T18:00:00Z", datetime(2026, 11, 11, 18, 7, tzinfo=timezone.utc)),
            "pre 7 min",
        )

    def test_monitor_is_read_only_and_legacy_case_status_does_not_hide_a_difference(self):
        with patch("streamlit_panel.api_client.ApiClient", FakeApi):
            app = self.app()
            for status in ("new", "in_progress", "resolved"):
                FakeApi.workflow.update(
                    workStatus=status, owner="operator-milos", ownerName="Milos"
                )
                app.run()
                self.assertFalse(app.exception)
                frame = app.dataframe[0].value
                self.assertTrue(
                    {"Prioritet", "Obrada", "Operater", "Razlog"}.isdisjoint(frame.columns)
                )
                self.assertEqual(frame.iloc[0]["Provera"], "Neslaganje")
                self.assertTrue(any("Rezultat: interno 1:0" in error.value for error in app.error))
                self.assertTrue(
                    any("Promene rezultata ovog meča" == heading.value for heading in app.subheader)
                )
                self.assertFalse(
                    any("Obrada slučaja" == heading.value for heading in app.subheader)
                )
                self.assertEqual(len(app.text_area), 0)
                labels = {button.label for button in app.button}
                self.assertTrue(
                    {
                        "Preuzmi slučaj",
                        "Oslobodi slučaj",
                        "Zatvori slučaj",
                        "Ponovo otvori slučaj",
                        "Sačuvaj obradu",
                    }.isdisjoint(labels)
                )
            self.assertEqual(FakeApi.calls, [])

    def test_sound_plays_once_for_a_changed_difference_when_enabled(self):
        with patch("streamlit_panel.api_client.ApiClient", FakeApi):
            app = self.app()
            app.checkbox(key="sound_enabled").check().run()
            self.assertEqual(len(app.get("audio")), 0)
            FakeApi.signature = "score-3-0"
            app.run()
            self.assertFalse(app.exception)
            self.assertEqual(len(app.get("audio")), 1)
            app.run()
            self.assertEqual(len(app.get("audio")), 0)

    def test_shared_queue_and_backup_are_available_without_installation_in_help(self):
        with patch("streamlit_panel.api_client.ApiClient", FakeApi):
            app = self.app()
            FakeApi.workflow["workStatus"] = "resolved"
            app.sidebar.radio[0].set_value("Zajednička neslaganja").run()
            self.assertFalse(app.exception)
            self.assertEqual(app.dataframe[0].value.iloc[0]["Spiskova"], 2)
            self.assertEqual(app.dataframe[0].value.iloc[0]["Provera"], "Neslaganje")
            self.assertTrue(
                {"Prioritet", "Obrada", "Operater"}.isdisjoint(app.dataframe[0].value.columns)
            )
            self.assertEqual(FakeApi.case_requests[-1], (0, True, "", ""))
            self.assertEqual(FakeApi.calls, [])
            self.assertEqual(len(app.text_area), 0)
            self.assertFalse(any("slučaj" in button.label for button in app.button))
            app.sidebar.radio[0].set_value("Podešavanja").run()
            app.button(key="prepare_backup").click().run()
            self.assertFalse(app.exception)
            self.assertEqual(json.loads(app.session_state["backup_bytes"])["app"], "ScoreGuard")
            app.sidebar.radio[0].set_value("Pomoć").run()
            self.assertFalse(app.exception)
            text = "\n".join(item.value for item in app.markdown)
            self.assertNotIn("SCOREGUARD_STORAGE_KEY", text)
            self.assertNotIn("docker compose", text)


if __name__ == "__main__":
    unittest.main()
