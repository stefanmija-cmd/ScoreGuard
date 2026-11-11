"""Server-side client. Authentication tokens never become Streamlit widgets."""
from __future__ import annotations
import os
from typing import Any
import requests
from urllib.parse import urlencode


class ApiError(Exception):
    def __init__(self, message: str, status: int = 0, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


class ApiClient:
    def __init__(self, cookie: str | None = None, operator_id: str | None = None,
                 base_url: str | None = None, origin: str | None = None):
        self.base_url = (base_url or os.environ.get("BACKEND_URL", "http://api:8080")).rstrip("/")
        self.origin = origin or os.environ.get("PUBLIC_ORIGIN", "http://localhost:8501")
        self.cookie = cookie
        self.operator_id = operator_id

    def _request(self, path: str, method: str = "GET", body: dict | None = None):
        headers = {"Origin": self.origin, "Accept": "application/json"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if self.operator_id:
            headers["X-ScoreGuard-Operator"] = self.operator_id
        try:
            if os.environ.get("SCOREGUARD_CLOUD") == "1" and self.base_url.startswith("http://127.0.0.1:"):
                with requests.Session() as session:
                    session.trust_env = False  # Private same-instance API; external source requests keep proxy settings.
                    response = session.request(method, self.base_url + path, json=body,
                                               headers=headers, timeout=(5, 55), allow_redirects=False)
            else:
                response = requests.request(method, self.base_url + path, json=body,
                                            headers=headers, timeout=(5, 55), allow_redirects=False)
        except requests.RequestException as error:
            raise ApiError("Server za proveru nije dostupan. Sačekajte nekoliko sekundi i pokušajte ponovo.") from error
        if response.status_code >= 300:
            try:
                data = response.json()
            except ValueError:
                data = {}
            raise ApiError(data.get("error", "Zahtev nije izvršen. Pokušajte ponovo."),
                           response.status_code, data.get("code"))
        return response

    def login(self, username: str, password: str):
        response = self._request("/api/auth/login", "POST", {"username": username, "password": password})
        cookie = response.headers.get("Set-Cookie", "").split(";", 1)[0]
        if not cookie:
            raise ApiError("Prijava nije potvrdila sesiju. Pokušajte ponovo.")
        user = response.json()["user"]
        return cookie, user

    def me(self):
        return self._request("/api/me").json()

    def logout(self):
        return self._request("/api/auth/logout", "POST").json()

    def monitor(self):
        return self._request("/api/monitor").json()

    def preview(self, text: str, date: str, format_name: str = "auto"):
        return self._request("/api/import/preview", "POST", {"text": text, "date": date, "format": format_name}).json()

    def configure(self, watch: dict, enabled: bool, imported: bool = False):
        return self._request("/api/watch", "PUT", {**watch, "enabled": enabled, "imported": imported}).json()

    def check(self, watch: dict, enabled: bool):
        return self._request("/api/compare", "POST", {**watch, "enabled": enabled, "trigger": "manual"}).json()

    def review(self, match_id: str, note: str):
        return self._request("/api/review", "POST", {"matchId": match_id, "note": note}).json()

    def package(self):
        return self._request("/downloads/ScoreGuard-streamlit-v0.6.zip").content

    def team_aliases(self):
        return self._request("/api/team-aliases").json()

    def save_team_alias(self, source: str, internal_name: str, source_name: str, confirmed: bool, scope: str = "own"):
        return self._request("/api/team-aliases", "POST", {"source": source, "internalName": internal_name, "sourceName": source_name, "confirmed": confirmed, "scope": scope}).json()

    def remove_team_alias(self, alias_id: str, scope: str = "own"):
        return self._request("/api/team-aliases", "DELETE", {"id": alias_id, "scope": scope}).json()

    def import_team_aliases(self, aliases: list, confirmed: bool):
        return self._request("/api/team-aliases/import", "POST", {"version": 1, "aliases": aliases, "confirmed": confirmed}).json()

    def confirm_match(self, match_id: str, source: str, event_id: str, scope: str = "own"):
        return self._request("/api/matching/confirm", "POST", {"matchId": match_id, "source": source, "eventId": event_id, "confirmed": True, "scope": scope}).json()

    def history(self, match_id: str):
        return self._request("/api/history?" + urlencode({"matchId": match_id})).json()

    def cases(self, offset: int = 0, resolved: bool = False, owner: str = "", query: str = ""):
        return self._request("/api/cases?" + urlencode({"offset": offset, "resolved": "1" if resolved else "0", "owner": owner, "q": query})).json()

    def case_action(self, case_id: str, action: str, version: int, note: str = ""):
        return self._request("/api/cases/action", "POST", {"id": case_id, "action": action, "version": version, "note": note}).json()

    def backup(self):
        return self._request("/api/backup").json()

    def restore_backup(self, backup: dict, confirmed: bool):
        return self._request("/api/backup/restore", "POST", {"backup": backup, "confirmed": confirmed}).json()
