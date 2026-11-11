from __future__ import annotations
import atexit
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit
import uuid
import requests


class CloudRuntimeError(Exception):
    pass


def account_config(raw):
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        if value.get("version") != 1 or not value.get("accounts"):
            raise ValueError
        for account in value["accounts"]:
            if not all(key in account for key in ("username", "passwordHash", "salt", "iterations")):
                raise ValueError
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    except (ValueError, TypeError, AttributeError, KeyError):
        raise CloudRuntimeError("Neispravna konfiguracija naloga. U Streamlit Secrets nalepite ceo sadržaj preuzetog cloud-secrets.toml fajla.") from None


def node_binary():
    try:
        import nodejs_wheel
        binary = Path(nodejs_wheel.__file__).parent / ("node.exe" if os.name == "nt" else "bin/node")
        if binary.is_file():
            return str(binary)
    except ImportError:
        pass
    raise CloudRuntimeError("Nedostaje runtime za servis. Objavite ceo Cloud paket sa njegovim requirements.txt fajlom i izaberite Python 3.12.")


class CloudRuntime:
    def __init__(self, accounts_json, aliases_json="{}", directory=None, project=None):
        self.project = Path(project or Path(__file__).resolve().parents[1])
        self.accounts_json = account_config(accounts_json)
        try:
            aliases = json.loads(aliases_json)
            if not isinstance(aliases, dict):
                raise ValueError
            if "teams" in aliases:
                aliases = {source: {"teams": aliases["teams"]} for source in ("flash", "sofa", "api")}
            for source in ("flash", "sofa", "api"):
                teams = aliases.get(source, {}).get("teams", {})
                if not isinstance(teams, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in teams.items()):
                    raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise CloudRuntimeError("TEAM_ALIASES_JSON mora biti ispravan JSON sa mapom teams.") from None
        self.aliases_json = json.dumps(aliases)
        key = hashlib.sha256(str(self.project).encode()).hexdigest()[:16]
        self.directory = Path(directory or Path(tempfile.gettempdir()) / ("scoreguard-cloud-" + key))
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.stopped = threading.Event()
        self.process = None
        self.base_url = None
        self.origin = None
        self.started_at = None
        self.error = None
        self.restarts = 0
        self._log = None
        self._thread = None

    def _write_private(self, name, content):
        path = self.directory / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write(content)
        path.chmod(0o600)

    def _start_locked(self):
        if self.process and self.process.poll() is None:
            return
        if self.stopped.is_set():
            raise CloudRuntimeError("Cloud servis je zaustavljen.")
        self.error = None
        self._write_private("operators.json", self.accounts_json)
        self._write_private("aliases.json", self.aliases_json)
        boot_id = uuid.uuid4().hex
        environment = os.environ.copy()
        environment.update({"SCOREGUARD_CLOUD_DATA_DIR": str(self.directory), "SCOREGUARD_CLOUD_BOOT_ID": boot_id,
                            "SCOREGUARD_CLOUD_PARENT_PID": str(os.getpid()), "NODE_USE_ENV_PROXY": "1"})
        if self._log:
            self._log.close()
        log_path = self.directory / "service.log"
        if log_path.exists() and log_path.stat().st_size > 1024 * 1024:
            log_path.unlink()
        self._log = open(log_path, "ab")
        log_path.chmod(0o600)
        self.process = subprocess.Popen([node_binary(), "--max-old-space-size=256", str(self.project / "cloud_runtime/server.mjs")],
                                        cwd=self.project, env=environment, stdin=subprocess.DEVNULL,
                                        stdout=self._log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + (45 if environment.get("SCOREGUARD_STORAGE_URL") else 15)
        session = requests.Session()
        session.trust_env = False  # Only this loopback health request bypasses outbound proxies.
        try:
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    break
                try:
                    ready = json.loads((self.directory / "ready.json").read_text())
                    location = urlsplit(ready["baseUrl"])
                    if ready["bootId"] != boot_id or location.hostname != "127.0.0.1" or location.scheme != "http":
                        raise ValueError
                    response = session.get(ready["baseUrl"] + "/healthz", timeout=1)
                    if response.ok and response.json().get("service") == "scoreguard-scraper":
                        self.base_url, self.origin, self.started_at = ready["baseUrl"], ready["origin"], ready["startedAt"]
                        os.environ.update({"BACKEND_URL": self.base_url, "PUBLIC_ORIGIN": self.origin, "SCOREGUARD_CLOUD": "1"})
                        return
                except (OSError, ValueError, KeyError, requests.RequestException):
                    pass
                self.stopped.wait(0.1)
        finally:
            session.close()
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=5)
        raise CloudRuntimeError("Servis nije pokrenut. Proverite Streamlit Secrets i da je ceo Cloud paket prenet na GitHub, pa izaberite Reboot app.")

    def start(self):
        with self.lock:
            try:
                self._start_locked()
            except (CloudRuntimeError, OSError, subprocess.SubprocessError) as error:
                self.close()
                if isinstance(error, CloudRuntimeError):
                    raise
                raise CloudRuntimeError("Servis nije pokrenut. Proverite da su ceo Cloud paket i requirements.txt na GitHub-u, pa izaberite Reboot app.") from None
            if self._thread is None:
                self._thread = threading.Thread(target=self._supervise, name="scoreguard-cloud-services", daemon=True)
                self._thread.start()
                atexit.register(self.close)
        return self

    def _supervise(self):
        while not self.stopped.wait(3):
            with self.lock:
                if self.stopped.is_set():
                    break
                if self.process and self.process.poll() is not None:
                    try:
                        self.restarts += 1
                        self._start_locked()
                    except (CloudRuntimeError, OSError, subprocess.SubprocessError) as error:
                        self.error = str(error) if isinstance(error, CloudRuntimeError) else "Ponovno pokretanje servisa nije uspelo. Izaberite Reboot app."

    def status(self):
        with self.lock:
            return {"running": bool(self.process and self.process.poll() is None and not self.error),
                    "startedAt": self.started_at, "restarts": self.restarts, "error": self.error,
                    "durableStorage": bool(os.environ.get("SCOREGUARD_STORAGE_URL") and os.environ.get("SCOREGUARD_STORAGE_KEY"))}

    def close(self):
        self.stopped.set()
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=35)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            if self._log:
                self._log.close()
                self._log = None
