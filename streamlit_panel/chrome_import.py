"""Authenticated, opt-in browser bridge; no connection to the internal server."""

from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import secrets
import zipfile
import streamlit as st
import streamlit.components.v1 as components
from streamlit_panel.presentation import BELGRADE, SOURCE_NAMES, local_time, preview_rows
from streamlit_panel.api_client import ApiError

_bridge = components.declare_component(
    "scoreguard_chrome_bridge_v013", path=str(Path(__file__).with_name("chrome_component"))
)
MAX_BYTES = 256000


def validate_packet(packet, operator, channel, now=None):
    if (
        not isinstance(packet, dict)
        or packet.get("version") != 1
        or packet.get("operator") != operator
        or packet.get("channel") != channel
    ):
        raise ValueError("Prenos ne pripada ovoj prijavljenoj sesiji operatera.")
    text = packet.get("text")
    if not isinstance(text, str) or not text or len(text.encode()) > MAX_BYTES:
        raise ValueError("Prazan ili prevelik spisak iz dodatka.")
    if (
        packet.get("id") != hashlib.sha256(text.encode()).hexdigest()
        or not isinstance(packet.get("requestId", ""), str)
        or len(packet.get("requestId", "")) > 100
        or not isinstance(packet.get("captureId", ""), str)
        or len(packet.get("captureId", "")) > 100
    ):
        raise ValueError("Sadržaj prenosa nije celovit.")
    try:
        captured = datetime.fromisoformat(packet["capturedAt"].replace("Z", "+00:00"))
        age = ((now or datetime.now(timezone.utc)) - captured).total_seconds()
        if not -30 <= age <= 330:
            raise ValueError
    except (KeyError, TypeError, AttributeError, ValueError):
        raise ValueError(
            "Pročitajte Backoffice tabelu ponovo; prenos je zastareo ili vreme nije pouzdano."
        ) from None
    return text


def fixture_signature(rows):
    return sorted(
        (
            str(row.get("internalId", "")),
            row.get("date", ""),
            row.get("time", ""),
            row.get("match", ""),
            row.get("league", ""),
        )
        for row in rows
    )


def result_fingerprint(rows):
    values = sorted(
        (str(row.get("internalId", "")), row.get("score"), row.get("ht"), row.get("expectedStatus"))
        for row in rows
    )
    return hashlib.sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()


def capture_details(packet, automatic):
    return {
        "id": packet.get("captureId") or packet["capturedAt"],
        "capturedAt": packet["capturedAt"],
        "automatic": automatic,
    }


def receive_packet(packet, api, operator, channel, session, now=None):
    delivery_id = (
        str(packet.get("id", ""))
        + ":"
        + str(packet.get("captureId") or packet.get("capturedAt", ""))
        if isinstance(packet, dict)
        else ""
    )
    if (
        isinstance(packet, dict)
        and packet.get("operator") == operator
        and packet.get("channel") == channel
        and session.get("chrome_received_id") == delivery_id
    ):
        return False
    text = validate_packet(packet, operator, channel, now)
    previous_capture = session.get("chrome_received_at")
    if previous_capture and datetime.fromisoformat(
        packet["capturedAt"].replace("Z", "+00:00")
    ) < datetime.fromisoformat(previous_capture.replace("Z", "+00:00")):
        return False
    selected_date = session.get("chrome_date")
    base_date = (
        selected_date.isoformat()
        if selected_date
        else session.get("chrome_base_date", datetime.now(BELGRADE).date().isoformat())
    )
    result = api.preview(text, base_date, "native")
    session["chrome_pending"] = {"packet": packet, "preview": result, "date": base_date}
    settings = session.get("chrome_auto_settings")
    if not settings:
        session["chrome_received_id"] = delivery_id
        session["chrome_received_at"] = packet["capturedAt"]
        session["chrome_notice"] = (
            "Primljen spisak. Otvorite Chrome uvoz, proverite pregled i potvrdite prvi uvoz."
        )
        return True
    rows = result.get("rows", [])
    snapshot = api.monitor().get("monitor") or {}
    watch = snapshot.get("watch") or {}
    if (
        result.get("errors")
        or not rows
        or fixture_signature(rows) != settings["fixtures"]
        or fixture_signature(watch.get("matches", [])) != settings["fixtures"]
        or base_date != settings["date"]
        or watch.get("date") != settings["date"]
    ):
        session.pop("chrome_auto_settings", None)
        session["chrome_received_id"] = delivery_id
        session["chrome_received_at"] = packet["capturedAt"]
        session["chrome_notice"] = (
            "Automatski uvoz je pauziran: promenjeni su spisak, datum ili format. Postojeći spisak nije zamenjen. Proverite Chrome uvoz i potvrdite ponovo."
        )
        return True
    fingerprint = result_fingerprint(rows)
    changed = fingerprint != result_fingerprint(watch["matches"])
    if changed:
        ids = {
            (row.get("date", ""), str(row.get("internalId", ""))): row["id"]
            for row in watch["matches"]
        }
        rows = [
            {**row, "id": ids[(row.get("date", ""), str(row.get("internalId", "")))]}
            for row in rows
        ]
        imported_watch = {"date": base_date, "sources": watch["sources"], "matches": rows}
    else:
        imported_watch = watch
    api.configure(
        imported_watch,
        snapshot.get("enabled", False),
        imported=True,
        chrome_capture=capture_details(packet, True),
    )
    session["chrome_applied_fingerprint"] = fingerprint
    session["chrome_last_import"] = packet["capturedAt"]
    session["chrome_notice"] = (
        "Ažurirano iz otvorenog Backoffice taba: " + str(len(rows)) + " mečeva."
        if changed
        else "Spisak je ponovo pročitan i uvezen; rezultati se nisu promenili."
    )
    session["chrome_notice"] += (
        " Provera izabranih izvora pokreće se automatski."
        if snapshot.get("enabled")
        else " Provere izvora su pauzirane."
    )
    session.pop("chrome_pending", None)
    session["chrome_received_id"] = delivery_id
    session["chrome_received_at"] = packet["capturedAt"]
    return True


def extension_zip():
    root = Path(__file__).resolve().parents[1] / "chrome_extension"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.iterdir()):
            if path.is_file() and path.suffix in {".json", ".mjs", ".js", ".html", ".css", ".md"}:
                archive.write(path, path.name)
    return output.getvalue()


@st.fragment(run_every="15s")
def render_receiver(api, operator, handle_error):
    channel = st.session_state.setdefault("chrome_channel", secrets.token_hex(24))
    packet = _bridge(
        channel=channel, operator=operator, default=None, key="scoreguard_chrome_receiver_v013"
    )
    if st.session_state.get("chrome_notice"):
        st.caption(st.session_state["chrome_notice"])
    if packet:
        try:
            if receive_packet(packet, api, operator, channel, st.session_state):
                st.rerun()
        except ValueError as error:
            st.error(str(error))
        except ApiError as error:
            handle_error(error)


def render_chrome_import(api, handle_error):
    import pandas as pd

    st.title("Uvoz preko Chrome dodatka")
    st.write(
        "Dodatak čita već učitanu tabelu u izabranom Backoffice tabu. Ne osvežava internu stranicu i ne šalje dodatne zahteve internom serveru."
    )
    st.download_button(
        "Preuzmi Chrome dodatak",
        extension_zip(),
        file_name="ScoreGuard-Chrome.zip",
        mime="application/zip",
    )
    st.markdown(
        "1. Raspakujte ZIP. U Chrome otvorite `chrome://extensions`, uključite **Developer mode**, izaberite **Load unpacked** i odaberite raspakovanu fasciklu.\n2. Otvorite spisak u Backoffice-u. Kliknite dodatak → **Ovaj tab je Backoffice**.\n3. U ovom ScoreGuard tabu kliknite dodatak → **Ovaj tab je ScoreGuard**. U dodatku kliknite **Pročitaj sada**.\n4. U levom meniju uključite **Primaj iz Chrome dodatka**. Proverite datum i prepoznate mečeve ispod, pa potvrdite prvi uvoz.\n5. Za automatiku uključite **Čitaj tabelu na svakih 5 minuta** u dodatku i **Automatski uvozi naredne promene ovog spiska** ispod."
    )
    st.caption(
        "Oba taba moraju ostati otvorena u istom Chrome profilu. Prenose se samo učitani redovi, bez prelistavanja stranica. Izmena filtera ili skupa mečeva pauzira automatski uvoz do novog pregleda. Prijava ostaje u ScoreGuard-u; dodatak ne traži lozinku."
    )
    base_date = st.date_input(
        "Datum prvog dana Chrome spiska",
        value=datetime.now(BELGRADE).date(),
        key="chrome_date",
        format="DD-MM-YYYY",
    )
    try:
        snapshot = api.monitor().get("monitor") or {}
    except ApiError as error:
        handle_error(error)
        return
    if snapshot.get("watch"):
        if snapshot.get("enabled"):
            st.caption(
                "Automatska provera Flashscore/Futbol24 rezultata je uključena."
                + (
                    " Svaki novi uvoz iz dodatka pokreće zajedničku proveru izabranih izvora."
                    if snapshot.get("syncWithImport")
                    else ""
                )
            )
        else:
            st.warning(
                "Provere izvora su trenutno pauzirane; zato rezultati mogu ostati „Nije provereno“. Uključite ih za proveru nakon uvoza."
            )
            if st.button("Uključi provere izvora na 5 minuta", key="chrome_enable_checks"):
                try:
                    api.configure(snapshot["watch"], True)
                    st.rerun()
                except ApiError as error:
                    handle_error(error)
    if st.session_state.get("chrome_notice"):
        st.info(st.session_state["chrome_notice"])
    if st.session_state.get("chrome_auto_settings"):
        st.success("Automatski uvoz promena potvrđenog spiska je uključen.")
        st.caption(
            "Redosled na svakih 5 minuta: dodatak čita interni spisak, aplikacija preuzima izabrane izvore, pa zajedno prikazuje rezultate. Ako nema novog uvoza, čeka se sledeće čitanje; Proveri sada ostaje dostupan."
        )
        st.caption(
            "Poslednje uspešno čitanje i uvoz: "
            + local_time(st.session_state.get("chrome_last_import"), True)
        )
        if st.button("Pauziraj automatski uvoz", key="chrome_pause"):
            st.session_state.pop("chrome_auto_settings", None)
            st.rerun()
    pending = st.session_state.get("chrome_pending")
    if not pending:
        st.caption(
            "Čekam nov spisak iz dodatka. Za ručno čitanje koristi dugme u levom meniju ili Pročitaj sada u dodatku."
        )
        return
    try:
        if pending["date"] != base_date.isoformat():
            pending["preview"] = api.preview(
                pending["packet"]["text"], base_date.isoformat(), "native"
            )
            pending["date"] = base_date.isoformat()
        result = pending["preview"]
        for error in result.get("errors", []):
            st.error(error)
        for warning in result.get("warnings", [])[:8]:
            st.warning(warning)
        rows = result.get("rows", [])
        if rows:
            st.dataframe(pd.DataFrame(preview_rows(result)), hide_index=True, width="stretch")
        st.caption(
            "Pročitano "
            + local_time(pending["packet"].get("capturedAt"), True)
            + " · ovo je kopija vidljivih podataka, ne potvrda svežine internog servera."
        )
        if not rows or result.get("errors"):
            return
        defaults = [
            SOURCE_NAMES[key]
            for key in snapshot.get("watch", {}).get("sources", ["flash"])
            if key in SOURCE_NAMES
        ]
        chosen = st.multiselect(
            "Izvori za Chrome spisak",
            list(SOURCE_NAMES.values()),
            default=defaults,
            key="chrome_sources",
        )
        enabled = st.checkbox(
            "Proveravaj rezultate izvora na svakih 5 minuta",
            value=snapshot.get("enabled", True),
            key="chrome_checks",
        )
        automatic = st.checkbox(
            "Automatski uvozi naredne promene ovog spiska", key="chrome_auto_requested"
        )
        st.info(
            "Potvrda zamenjuje samo vaš aktivni spisak. Prvi uvoz i svaki promenjen skup mečeva zahtevaju pregled."
        )
        if st.button(
            "Potvrdi povezivanje i uvezi",
            type="primary",
            disabled=not chosen or not st.session_state.get("chrome_receive"),
            key="chrome_confirm",
        ):
            validate_packet(
                pending["packet"],
                st.session_state["user"]["id"],
                st.session_state["chrome_channel"],
            )
            sources = [key for key, label in SOURCE_NAMES.items() if label in chosen]
            api.configure(
                {"date": base_date.isoformat(), "sources": sources, "matches": rows},
                enabled,
                imported=True,
                chrome_capture=capture_details(pending["packet"], automatic),
            )
            st.session_state["chrome_applied_fingerprint"] = result_fingerprint(rows)
            st.session_state["chrome_base_date"] = base_date.isoformat()
            st.session_state["chrome_last_import"] = pending["packet"]["capturedAt"]
            if automatic:
                st.session_state["chrome_auto_settings"] = {
                    "fixtures": fixture_signature(rows),
                    "date": base_date.isoformat(),
                }
            else:
                st.session_state.pop("chrome_auto_settings", None)
            st.session_state.pop("chrome_pending", None)
            st.session_state["chrome_notice"] = (
                "Spisak je uvezen. Provera izabranih izvora pokreće se automatski."
                if enabled
                else "Spisak je uvezen. Provere izvora su pauzirane; Proveri sada je dostupan."
            )
            st.success(st.session_state["chrome_notice"])
    except ValueError as error:
        st.error(str(error))
    except ApiError as error:
        handle_error(error)
