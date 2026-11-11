from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import threading
import streamlit as st
from cloud_runtime.runtime import CloudRuntime, CloudRuntimeError, account_config

_lock = threading.Lock()
_active = None
_active_key = None


def service_revision():
    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    files = [root / "cloud_runtime/server.mjs"]
    for folder in ("service", "scraper", "auth"):
        files.extend((root / folder).rglob("*.mjs"))
    for path in sorted(files):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def get_runtime(accounts_json, aliases_json="{}"):
    global _active, _active_key
    accounts_json = account_config(accounts_json)
    if not isinstance(aliases_json, str):
        try:
            aliases_json = json.dumps(aliases_json)
        except (ValueError, TypeError):
            raise CloudRuntimeError("TEAM_ALIASES_JSON mora biti ispravan JSON sa mapom teams.") from None
    directory = os.environ.get("SCOREGUARD_CLOUD_DATA_DIR")
    optional = "|".join(os.environ.get(name, "") for name in ("APIFOOTBALL_KEY", "APIFOOTBALL_DAILY_LIMIT", "SCOREGUARD_STORAGE_URL", "SCOREGUARD_STORAGE_KEY", "SCOREGUARD_STORAGE_NAMESPACE"))
    key = hashlib.sha256((accounts_json + "|" + aliases_json + "|" + str(directory) + "|" + optional + "|" + service_revision()).encode()).hexdigest()
    with _lock:
        if _active_key != key or _active is None or _active.stopped.is_set():
            if _active:
                _active.close()
            _active = CloudRuntime(accounts_json, aliases_json, directory=directory).start()
            _active_key = key
        return _active


def boot_cloud():
    try:
        raw = st.secrets.get("OPERATOR_ACCOUNTS_JSON")
        aliases = st.secrets.get("TEAM_ALIASES_JSON", "{}")
        for name in ("APIFOOTBALL_KEY", "APIFOOTBALL_DAILY_LIMIT", "SCOREGUARD_STORAGE_URL", "SCOREGUARD_STORAGE_KEY", "SCOREGUARD_STORAGE_NAMESPACE"):
            value = st.secrets.get(name, os.environ.get(name, ""))
            if str(value).strip():
                os.environ[name] = str(value).strip()
            else:
                os.environ.pop(name, None)
    except (FileNotFoundError, st.errors.StreamlitSecretNotFoundError):
        raw = None
        aliases = "{}"
    if not raw:
        raise CloudRuntimeError("Nedostaju nalozi. Otvorite Advanced settings → Secrets i nalepite ceo sadržaj preuzetog cloud-secrets.toml fajla. BACKEND_URL i PUBLIC_ORIGIN nisu potrebni.")
    return get_runtime(raw, aliases)
