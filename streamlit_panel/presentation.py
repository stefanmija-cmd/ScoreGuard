from __future__ import annotations
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from html import escape
import hashlib
import json
import re

BELGRADE = ZoneInfo("Europe/Belgrade")
SOURCE_NAMES = {"flash": "Flashscore", "f24": "Futbol24", "api": "API-Football"}
LEGACY_SOURCE_NAMES = {"sofa": "Sofascore (arhiva)"}
STATUS_NAMES = {"match": "Usaglašeno", "mismatch": "Neslaganje", "unverified": "Nije provereno"}


def input_age(value: str | None, now: datetime | None = None) -> str:
    if not value:
        return "Nepoznato"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        seconds = ((now or datetime.now(timezone.utc)) - parsed).total_seconds()
        if seconds < -30:
            return "Nepouzdano vreme"
        minutes = max(0, int(seconds // 60))
        return "pre " + (
            str(minutes) + " min"
            if minutes < 60
            else str(minutes // 60) + " h"
            if minutes < 1440
            else str(minutes // 1440) + " dana"
        )
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
    return hashlib.sha256(
        json.dumps([text, date, format_name], ensure_ascii=False).encode()
    ).hexdigest()


def combined_score(score: str | None, ht: str | None) -> str:
    return (score or "—") + " (" + (ht or "—") + ")"


def reference_fresh(reference: dict, now: datetime | None = None) -> bool:
    if reference.get("state") != "verified" or reference.get("stale"):
        return False
    try:
        checked = datetime.fromisoformat(reference["checkedAt"].replace("Z", "+00:00"))
        return -30 <= ((now or datetime.now(timezone.utc)) - checked).total_seconds() <= 330
    except (KeyError, AttributeError, TypeError, ValueError):
        return False


def score_values(match: dict, source: str | None = None) -> tuple:
    value = match if source is None else match.get("refs", {}).get(source) or {}
    if source is not None and value.get("state") != "verified":
        return None, None
    first_half = value.get("phase" if source else "expectedStatus") == "first_half"
    ht = None if first_half or value.get("htRequired") is False else value.get("ht")
    return value.get("score"), ht


def reference_score(reference: dict | None) -> str:
    reference = reference or {}
    score, ht = score_values({"refs": {"ref": reference}}, "ref")
    return combined_score(score, ht) + (" · zastarelo" if reference.get("stale") else "")


def score_markup(
    match: dict, sources: list[str], source: str | None = None, now: datetime | None = None
) -> str:
    """Mark only comparable, differing team values; missing data is never a zero."""
    refs = match.get("refs", {})
    baseline = score_values(match)
    values = score_values(match, source)
    trusted = [key for key in sources if reference_fresh(refs.get(key) or {}, now)]
    comparable = trusted if source is None else [source] if source in trusted else []

    def pair(value, part):
        parsed = re.fullmatch(r"(\d{1,2}):(\d{1,2})", value or "", flags=re.ASCII)
        if not parsed:
            return escape(str(value or "—"))
        base = re.fullmatch(r"(\d{1,2}):(\d{1,2})", baseline[part] or "", flags=re.ASCII)
        output = []
        for index, number in enumerate(parsed.groups()):
            differs = False
            for key in comparable:
                other = re.fullmatch(
                    r"(\d{1,2}):(\d{1,2})", score_values(match, key)[part] or "", flags=re.ASCII
                )
                if base and other and int(base[index + 1]) != int(other[index + 1]):
                    differs = True
            position = ("score" if part == 0 else "ht") + ("-home" if index == 0 else "-away")
            tip = (
                "Neslaganje: "
                + ("rezultat" if part == 0 else "poluvreme")
                + (" domaćina" if index == 0 else " gosta")
            )
            output.append(
                '<strong class="sg-score-diff" data-part="'
                + position
                + '" title="'
                + tip
                + '">'
                + number
                + "</strong>"
                if differs
                else '<span data-part="' + position + '">' + number + "</span>"
            )
        return ":".join(output)

    stale = (
        source is not None
        and refs.get(source, {}).get("state") == "verified"
        and not reference_fresh(refs[source], now)
    )
    return (
        '<span class="sg-score">'
        + pair(values[0], 0)
        + ' <span class="sg-half">('
        + pair(values[1], 1)
        + ")</span></span>"
        + (' <small class="sg-stale">zastarelo / vreme nije potvrđeno</small>' if stale else "")
    )


def score_line(match: dict, sources: list[str], source: str | None = None) -> str:
    label = SOURCE_NAMES.get(source, source) if source else "Source"
    return (
        SCORE_STYLES
        + '<div class="sg-score-line"><b>'
        + escape(label)
        + ":</b> "
        + score_markup(match, sources, source)
        + "</div>"
    )


SCORE_STYLES = """<style>
.sg-table-wrap {overflow:auto; max-height:650px; border:1px solid #d6ddd7; border-radius:8px;}
.sg-table {border-collapse:separate; border-spacing:0; width:100%; font-size:14px; color:#1d3228;}
.sg-table th {position:sticky; top:0; z-index:1; background:#f7f9fa; text-align:left;}
.sg-table th,.sg-table td {padding:10px 12px; border-bottom:1px solid #e0e7e0; vertical-align:middle;}
.sg-table tr[data-status="mismatch"] td {background:#fff0ec;}
.sg-table tr[data-status="match"] td {background:#eef7ed;}
.sg-table tr[data-status="unverified"] td {background:#fff9e9;}
.sg-score {white-space:nowrap; font-variant-numeric:tabular-nums; font-weight:600;}
.sg-half {font-weight:400; color:#42574b;}
.sg-score-diff {color:#a61d24; background:#ffe0df; border:1px solid #b52b32; border-radius:3px; padding:0 2px; font-weight:800;}
.sg-stale {color:#76551b; display:block; font-size:11px;}
.sg-score-line {padding:5px 0; color:#1d3228;}
</style>"""


def score_table_html(
    matches: list[dict],
    sources: list[str],
    table_id: str = "sg-monitor",
    shared_counts: list[int] | None = None,
) -> str:
    rows = table_rows(matches, sources)
    if not rows:
        return ""
    columns = list(rows[0])
    if shared_counts is not None:
        columns = [
            "Datum",
            "Utakmica",
            "Source",
            *[SOURCE_NAMES[key] for key in sources],
            "Provera",
            "Spiskova",
        ]
    score_columns = {"Source": None, **{SOURCE_NAMES[key]: key for key in sources}}
    now = datetime.now(timezone.utc)
    body = []
    for index, (match, row) in enumerate(zip(matches, rows)):
        if shared_counts is not None:
            row["Spiskova"] = shared_counts[index]
        cells = []
        for column in columns:
            content = (
                score_markup(match, sources, score_columns[column], now)
                if column in score_columns
                else escape(str(row[column]))
            )
            cells.append("<td>" + content + "</td>")
        status = match.get("comparisonStatus", "unverified")
        status = status if status in STATUS_NAMES else "unverified"
        body.append('<tr data-status="' + status + '">' + "".join(cells) + "</tr>")
    return (
        SCORE_STYLES
        + '<div class="sg-table-wrap"><table class="sg-table" id="'
        + escape(table_id, quote=True)
        + '"><thead><tr>'
        + "".join('<th scope="col">' + escape(column) + "</th>" for column in columns)
        + "</tr></thead><tbody>"
        + "".join(body)
        + "</tbody></table></div>"
    )


def table_rows(matches: list[dict], sources: list[str]) -> list[dict]:
    result = []
    for match in matches:
        refs = match.get("refs", {})
        row = {
            "Datum": match.get("date", ""),
            "Početak": match.get("time", "—"),
            "Šifra": match.get("internalId", "—"),
            "Utakmica": match.get("match", "—"),
            "Takmičenje": match.get("league", "—"),
            "Source": combined_score(*score_values(match)),
        }
        for source in sources:
            row[SOURCE_NAMES[source]] = reference_score(refs.get(source))
        row["Provera"] = STATUS_NAMES.get(match.get("comparisonStatus"), "Nije provereno")
        row["Interni unos"] = input_age(match.get("importedAt"))
        result.append(row)
    return result


def preview_rows(result: dict) -> list[dict]:
    if result.get("format") == "native":
        return [
            {
                "Šifra": m["internalId"],
                "Utakmica": m["match"],
                "Takmičenje": m["league"],
                "Dan i vreme": m["scheduleRaw"],
                "FT/HT": m.get("marketRaw") or "—",
                "Trenutni rezultat": m.get("numericScore") or "—",
                "Poluvreme": m.get("colonScore") or "—",
                "Minut gola (ne proverava se)": m.get("minuteRaw") or "—",
                "Period": m.get("phaseRaw") or "—",
            }
            for m in result.get("preview", [])
        ]
    return [
        {
            "Utakmica": m["match"],
            "Takmičenje": m["league"],
            "Početak": m["time"],
            "Trenutni rezultat": m.get("score") or "—",
            "Poluvreme": m.get("ht") or "—",
        }
        for m in result.get("rows", [])
    ]
