import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from cloud_runtime.runtime import CloudRuntime, CloudRuntimeError, account_config, node_binary
from streamlit_panel.api_client import ApiClient, ApiError

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "Cloud-runtime-test-password-only-123!"


def test_accounts():
    script = (
        "import {createAccount} from './auth/core.mjs';const password='"
        + PASSWORD
        + "';console.log(JSON.stringify({version:1,accounts:[await createAccount({username:'stefan',name:'Stefan',role:'admin',password}),await createAccount({username:'milos',name:'Milos',password})]}));"
    )
    return subprocess.check_output(
        [node_binary(), "--input-type=module", "-e", script], cwd=ROOT, text=True
    ).strip()


class CloudRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.accounts = test_accounts()

    def setUp(self):
        self.environment = patch.dict(os.environ)
        self.environment.start()
        self.temp = tempfile.TemporaryDirectory(prefix="sg-cloud-runtime-test-")
        self.runtime = None

    def tearDown(self):
        if self.runtime:
            self.runtime.close()
        self.temp.cleanup()
        self.environment.stop()

    def start(self):
        self.runtime = CloudRuntime(self.accounts, directory=self.temp.name).start()
        return self.runtime

    def test_invalid_configuration_fails_without_default_accounts_or_secret_echo(self):
        for raw in (
            "private-value-that-must-not-be-echoed",
            "{}",
            '{"version":1,"accounts":[{"password":"readable"}]}',
        ):
            with self.assertRaises(CloudRuntimeError) as caught:
                account_config(raw)
            self.assertNotIn(raw, str(caught.exception))

    def test_repeated_and_concurrent_start_uses_one_private_service(self):
        runtime = self.start()
        pid = runtime.process.pid
        with ThreadPoolExecutor(max_workers=4) as pool:
            pids = list(pool.map(lambda _: runtime.start().process.pid, range(8)))
        self.assertEqual(pids, [pid] * 8)
        self.assertTrue(runtime.status()["running"])
        self.assertTrue(runtime.base_url.startswith("http://127.0.0.1:"))
        for name in ("operators.json", "aliases.json", "session-signing-key"):
            self.assertEqual((Path(self.temp.name) / name).stat().st_mode & 0o777, 0o600)

    def test_real_api_login_native_import_and_operator_isolation(self):
        self.start()
        cookie, user = ApiClient().login("Stefan", PASSWORD)
        stefan = ApiClient(cookie, user["id"])
        native = (
            "F\nVenecuela Kup\n72499\nZamora\nAtletico Barinas\nsre 21:30\nFT\n0\n0\n0:0\n2nd half"
        )
        preview = stefan.preview(native, "2026-11-11")
        self.assertEqual(preview["errors"], [])
        stefan.configure(
            {"date": "2026-11-11", "sources": ["flash"], "matches": preview["rows"]}, False
        )
        self.assertEqual(stefan.monitor()["monitor"]["watch"]["matches"][0]["internalId"], "72499")
        cookie, user = ApiClient().login("milos", PASSWORD)
        self.assertIsNone(ApiClient(cookie, user["id"]).monitor()["monitor"])
        with self.assertRaises(ApiError) as caught:
            ApiClient().login("Stefan", "invalid-password")
        self.assertEqual(caught.exception.status, 401)
        stefan.logout()
        with self.assertRaises(ApiError):
            stefan.monitor()

    def test_supervisor_restarts_failed_child_and_restores_local_watch_and_session(self):
        runtime = self.start()
        cookie, user = ApiClient().login("stefan", PASSWORD)
        client = ApiClient(cookie, user["id"])
        watch = {
            "date": "2026-11-11",
            "sources": ["flash"],
            "matches": [
                {
                    "id": "one",
                    "sport": "Fudbal",
                    "time": "21:30",
                    "league": "Venecuela Kup",
                    "match": "Zamora – Atletico Barinas",
                    "ht": "0:0",
                    "score": "1:0",
                }
            ],
        }
        client.configure(watch, False)
        client.review("one", "Supervisor recovery test")
        pid = runtime.process.pid
        runtime.process.kill()
        runtime.process.wait(timeout=5)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            status = runtime.status()
            if status["running"] and runtime.process.pid != pid:
                break
            time.sleep(0.1)
        self.assertNotEqual(runtime.process.pid, pid)
        self.assertTrue(runtime.status()["running"])
        self.assertGreaterEqual(runtime.restarts, 1)
        restored = ApiClient(cookie, user["id"]).monitor()["monitor"]
        self.assertEqual(restored["reviews"]["one"]["note"], "Supervisor recovery test")
        self.assertFalse(restored["enabled"])


if __name__ == "__main__":
    unittest.main()
