from __future__ import annotations
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import hashlib
import json

BELGRADE = ZoneInfo("Europe/Belgrade")
SOURCE_NAMES = {"flash": "Flashscore", "sofa": "Sofascore", "api": "API-Football"}
STATUS_NAMES = {"match": "Usaglašeno", "mismatch": "Neslaganje", "unverified": "Nije provereno"}
WORK_NAMES = {"new": "Novo", "in_progress": "U obradi", "resolved": "Rešeno"}


def input_age(value: str | None, now: datetime | None = None) -> str:
    if not value:
        return "Nepoznato"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        seconds = ((now or datetime.now(timezone.utc)) - parsed).total_seconds()
        if seconds < -30:
            return "Nepouzdano vreme"
        minutes = max(0, int(seconds // 60))
        return "pre " + (str(minutes) + " min" if minutes < 60 else str(minutes // 60) + " h" if minutes < 1440 else str(minutes // 1440) + " dana")
    except (TypeError, ValueError):
        return "Nepoznato"


def local_time(value: str | None, include_date: bool = False) -> str:
    if not isinstance(value, str) or not value:
        return "—"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(BELGRADE)
        return parsed.strftime("%d.%m.%Y. %H:%M:%S" if include_date else "%H:%M:%S")
    except (ValueError, TypeError):
        return "—"


def preview_fingerprint(text: str, date: str, format_name: str) -> str:
    return hashlib.sha256(json.dumps([text, date, format_name], ensure_ascii=False).encode()).hexdigest()


def reference_score(reference: dict | None, half_time: bool = False) -> str:
    if not reference or reference.get("state") != "verified":
        return "—"
    value = reference.get("ht" if half_time else "score") or "—"
    return value + (" · zastarelo" if reference.get("stale") else "")


def table_rows(matches: list[dict], sources: list[str]) -> list[dict]:
    result = []
    for match in matches:
        refs = match.get("refs", {})
        row = {"Datum": match.get("date", ""), "Početak": match["time"],
               "Šifra": match.get("internalId", "—"), "Utakmica": match["match"],
               "Takmičenje": match["league"], "Interno": match.get("score") or "—",
               "Poluvreme": match.get("ht") or "—"}
        for source in sources:
            row[SOURCE_NAMES[source]] = reference_score(refs.get(source))
            row[SOURCE_NAMES[source] + " · poluvreme"] = reference_score(refs.get(source), True)
        row["Provera"] = STATUS_NAMES.get(match.get("comparisonStatus"), "Nije provereno")
        row["Prioritet"] = match.get("priorityLabel", "—")
        row["Interni unos"] = input_age(match.get("importedAt"))
        workflow = match.get("workflow") or {}
        row["Obrada"] = WORK_NAMES.get(workflow.get("workStatus"), "Obrađeno" if match.get("ack") else "Čeka proveru")
        row["Operater"] = workflow.get("ownerName") or "—"
        result.append(row)
    return result


def preview_rows(result: dict) -> list[dict]:
    if result.get("format") == "native":
        return [{"Šifra": m["internalId"], "Utakmica": m["match"], "Takmičenje": m["league"],
                 "Dan i vreme": m["scheduleRaw"], "FT/HT": m.get("marketRaw") or "—",
                 "Trenutni rezultat": m.get("numericScore") or "—", "Poluvreme": m.get("colonScore") or "—",
                 "Minut gola (ne proverava se)": m.get("minuteRaw") or "—",
                 "Period": m.get("phaseRaw") or "—"} for m in result.get("preview", [])]
    return [{"Utakmica": m["match"], "Takmičenje": m["league"], "Početak": m["time"],
             "Trenutni rezultat": m.get("score") or "—", "Poluvreme": m.get("ht") or "—"}
            for m in result.get("rows", [])]


def row_style(row):
    color = {"Neslaganje": "#fff0ec", "Usaglašeno": "#eef7ed", "Nije provereno": "#fff9e9"}.get(row.get("Provera"), "")
    return ["background-color: " + color if color else "" for _ in row]
