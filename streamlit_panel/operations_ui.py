from __future__ import annotations
import io
import json
import math
import struct
import wave
from functools import lru_cache
import pandas as pd
import streamlit as st
from streamlit_panel.api_client import ApiError
from streamlit_panel.presentation import SOURCE_NAMES, STATUS_NAMES, WORK_NAMES, input_age, local_time


def detect_alerts(matches, previous):
    current = {str(m.get("date", "")) + "|" + str(m.get("internalId") or m.get("match") or m["id"]) + "|" + m.get("time", ""): m.get("alertSignature")
               for m in matches if m.get("comparisonStatus") == "mismatch" and m.get("alertSignature")}
    changed = [] if previous is None else [key for key, signature in current.items() if previous.get(key) != signature]
    return current, changed


@lru_cache(maxsize=1)
def alarm_wav():
    data = io.BytesIO()
    with wave.open(data, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"".join(struct.pack("<h", int(7500 * math.sin(2 * math.pi * (880 if i < 3200 else 660) * i / 16000))) if i < 3200 or i > 4400 else b"\0\0" for i in range(7600)))
    return data.getvalue()


def render_sound(matches, context="monitor"):
    state_key = "seen-alerts-" + context
    current, changed = detect_alerts(matches, st.session_state.get(state_key))
    st.session_state[state_key] = current
    if changed:
        st.toast("Novo ili promenjeno neslaganje: " + str(len(changed)), icon="⚠️")
        if st.session_state.get("sound_enabled"):
            st.audio(alarm_wav(), format="audio/wav", autoplay=True)


def render_workflow(api, workflow, handle_error, context="detail"):
    if not workflow:
        return
    case_id = workflow["id"]
    status = workflow["workStatus"]
    user = st.session_state.get("user", {})
    st.subheader("Obrada slučaja")
    st.write(WORK_NAMES.get(status, status) + (" · " + workflow["ownerName"] if workflow.get("ownerName") else ""))
    st.caption("Status obrade beleži rad operatera. Provera rezultata ostaje nezavisna i neslaganje ostaje vidljivo dok postoji.")

    def submit(action, note=""):
        try:
            api.case_action(case_id, action, workflow["version"], note)
            st.session_state["operation_notice"] = "Obrada slučaja je sačuvana."
            st.rerun()
        except ApiError as error:
            handle_error(error)

    if status == "resolved":
        if st.button("Ponovo otvori slučaj", key=context + "-reopen-" + case_id):
            submit("reopen")
    elif not workflow.get("owner") or workflow.get("owner") == user.get("id"):
        if status == "new" and st.button("Preuzmi slučaj", key=context + "-claim-" + case_id, type="primary"):
            submit("claim")
        if workflow.get("owner") == user.get("id") and st.button("Oslobodi slučaj", key=context + "-release-" + case_id):
            submit("release")
    else:
        st.info("Ovaj slučaj već obrađuje " + str(workflow.get("ownerName") or "drugi operater") + ".")
    if status != "resolved" and (workflow.get("owner") == user.get("id") or user.get("role") == "admin"):
        with st.form(context + "-resolve-" + case_id):
            note = st.text_area("Šta je provereno i kako je slučaj rešen?", max_chars=1000, key=context + "-case-note-" + case_id)
            if st.form_submit_button("Zatvori slučaj"):
                submit("resolve", note)


def render_suggestions(api, match, sources, snapshot, handle_error):
    for source in sources:
        ref = match.get("refs", {}).get(source) or {}
        suggestions = ref.get("suggestions") or []
        if not suggestions or ref.get("stale"):
            continue
        st.subheader("Predlozi povezivanja · " + SOURCE_NAMES[source])
        st.write("Interno: **" + match["match"] + "**")
        key = match["id"] + "-" + source
        candidate = st.selectbox("Mogući meč na izvoru", suggestions,
                                 format_func=lambda item: item["home"] + " – " + item["away"] + " · " + item.get("league", ""), key="suggestion-" + key)
        st.caption("Potvrdi samo ako su domaćin i gost isti klubovi i iste selekcije. Predlog sam ne potvrđuje rezultat.")
        shared = st.checkbox("Poveži za sve operatere", key="suggestion-shared-" + key) if st.session_state.get("user", {}).get("role") == "admin" else False
        if st.button("Potvrdi ovaj par timova", key="suggestion-confirm-" + key):
            try:
                api.confirm_match(match["id"], source, candidate["eventId"], "shared" if shared else "own")
                if snapshot:
                    api.check(snapshot["watch"], snapshot["enabled"])
                st.session_state["operation_notice"] = "Povezivanje je sačuvano i pokrenuta je nova provera."
                st.rerun()
            except ApiError as error:
                handle_error(error)


def render_timeline(api, match_id, handle_error):
    try:
        events = api.history(match_id).get("events", [])
    except ApiError as error:
        handle_error(error)
        return
    st.subheader("Promene rezultata ovog meča")
    if not events:
        st.caption("Promene se beleže od naredne provere. Istovetna provera ne dodaje novi zapis.")
        return
    rows = []
    for event in events:
        row = {"Vreme": local_time(event.get("at"), True), "Interno": event.get("internal", {}).get("score") or "—",
               "Interno · poluvreme": event.get("internal", {}).get("ht") or "—", "Provera": STATUS_NAMES.get(event.get("comparisonStatus"), "Nije provereno")}
        for source, ref in event.get("refs", {}).items():
            row[SOURCE_NAMES.get(source, source)] = ref.get("score") or "—"
            row[SOURCE_NAMES.get(source, source) + " · poluvreme"] = ref.get("ht") or "—"
        row["Poreklo"] = "Vraćena rezervna kopija" if event.get("restoredAt") else "Provera aplikacije"
        rows.append(row)
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")


def render_cases(api, handle_error):
    st.title("Zajednička neslaganja")
    st.caption("Slučajeve vide svi prijavljeni operateri. Preuzmi slučaj da kolege znaju ko ga proverava.")
    left, middle, right = st.columns([1, 1, 2])
    with left:
        chosen = st.selectbox("Zaduženje", ["Svi", "Moji", "Slobodni"], key="case_owner_filter")
    with middle:
        resolved = st.checkbox("Prikaži i rešene", key="cases_resolved")
    with right:
        query = st.text_input("Pretraži zajednička neslaganja", max_chars=150, key="case_search")
    page = int(st.number_input("Strana", min_value=1, value=1, step=1, key="case_page"))
    try:
        data = api.cases((page - 1) * 100, resolved, {"Moji": "me", "Slobodni": "unassigned"}.get(chosen, ""), query)
    except ApiError as error:
        handle_error(error)
        return
    cases = data.get("cases", [])
    st.caption("Ukupno slučajeva za izabrane filtere: " + str(data.get("total", 0)) + " · do 100 po strani")
    if not cases:
        st.info("Nema slučajeva na ovoj strani. Ako si promenio filtere, vrati se na prvu stranu.")
        return
    rows = []
    for item in cases:
        evidence = item.get("evidence") or {}
        rows.append({"Datum": evidence.get("date", ""), "Utakmica": evidence.get("match", ""), "Prioritet": ["1 · Završeni meč", "2 · Live razlika", "3 · Proveri podatke"][item["priority"]],
                     "Interno": evidence.get("internal", {}).get("score") or "—", "Provera": STATUS_NAMES.get(item["comparisonStatus"], "Nije provereno"),
                     "Obrada": WORK_NAMES.get(item["workStatus"], "Novo"), "Operater": item.get("ownerName") or "—", "Spiskova": item.get("operatorCount", 1)})
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
    render_sound([{"id": c["id"], "match": c.get("evidence", {}).get("match", c["id"]), "date": c.get("evidence", {}).get("date", ""), "comparisonStatus": c["comparisonStatus"], "alertSignature": c.get("evidence", {}).get("signature")} for c in cases], "cases")
    with st.expander("Detalji zajedničkog slučaja i obrada", expanded=True):
        selected = st.selectbox("Izaberi slučaj", cases, format_func=lambda item: item.get("evidence", {}).get("match", item["id"]), key="selected_case")
        st.write(selected.get("comparisonReason") or "Nema pouzdanih podataka za poređenje.")
        evidence = selected.get("evidence") or {}
        st.caption("Interni snimak " + input_age(evidence.get("importedAt")) + " · proveru pokrenuo " + str(evidence.get("operator", "—")))
        for source, ref in evidence.get("refs", {}).items():
            st.write(SOURCE_NAMES.get(source, source) + ": " + (ref.get("score") or "—") + " · poluvreme " + (ref.get("ht") or "—"))
            st.caption("Preuzeto " + local_time(ref.get("checkedAt"), True))
        render_workflow(api, selected, handle_error, "board")
        if selected.get("events"):
            actions = {"opened": "Otvoreno", "reopened": "Ponovo otvoreno", "claim": "Preuzeto", "release": "Oslobođeno", "resolve": "Rešeno", "reopen": "Ponovo otvoreno"}
            st.dataframe(pd.DataFrame([{"Vreme": local_time(e.get("at"), True), "Operater": e.get("name") or e.get("operator"), "Radnja": actions.get(e["action"], e["action"]), "Napomena": e.get("note", "")} for e in selected["events"]]), hide_index=True, width="stretch")


def render_backup(api, storage, handle_error):
    st.subheader("Čuvanje podataka i rezervna kopija")
    if storage.get("durable"):
        st.success("Povezana je spoljna baza. Podaci se čuvaju i nakon ponovnog kreiranja Cloud instance.")
    else:
        st.warning("Podaci su lokalni u ovoj testnoj instanci i mogu biti izgubljeni. Preuzmi rezervnu kopiju pre važnih izmena ili ponovnog kreiranja aplikacije.")
    if storage.get("state") not in (None, "ready"):
        st.error("Zapisivanje podataka nije potvrđeno. Proveri status baze pre nastavka obrade.")
    if st.button("Pripremi rezervnu kopiju", key="prepare_backup"):
        try:
            st.session_state["backup_bytes"] = json.dumps(api.backup(), ensure_ascii=False, indent=2).encode("utf-8")
        except ApiError as error:
            handle_error(error)
    if st.session_state.get("backup_bytes"):
        st.download_button("Preuzmi rezervnu kopiju", st.session_state["backup_bytes"], "scoreguard-rezervna-kopija.json", "application/json")
    st.caption("Kopija sadrži tvoj spisak, povezivanja i istoriju promena. Administratorska kopija uključuje i zajednička povezivanja. Nalozi, lozinke i pristupni ključevi nisu uključeni.")
    with st.expander("Vrati rezervnu kopiju"):
        uploaded = st.file_uploader("Izaberi scoreguard-rezervna-kopija.json", type=["json"], key="backup_file")
        confirmed = st.checkbox("Razumem da će moj aktivni spisak biti zamenjen, a automatika pauzirana.", key="backup_confirmed")
        if st.button("Vrati kopiju", disabled=uploaded is None, key="restore_backup"):
            try:
                if not confirmed or uploaded.size > 12 * 1024 * 1024:
                    raise ValueError
                payload = json.loads(uploaded.getvalue())
                api.restore_backup(payload, confirmed)
                st.session_state["operation_notice"] = "Kopija je vraćena. Pokreni „Proveri sada“ i po potrebi uključi automatiku."
                st.rerun()
            except (ValueError, TypeError, UnicodeError):
                st.error("Potvrdi vraćanje i izaberi važeću JSON kopiju do 12 MB.")
            except ApiError as error:
                handle_error(error)
