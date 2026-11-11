from __future__ import annotations
from datetime import datetime
from pathlib import Path
import os
import pandas as pd
import streamlit as st
from streamlit_panel.api_client import ApiClient, ApiError
from streamlit_panel.presentation import BELGRADE, SOURCE_NAMES, STATUS_NAMES, local_time, preview_fingerprint, preview_rows, row_style, table_rows
from streamlit_panel.team_aliases_ui import render_team_aliases

CLOUD_MODE = os.environ.get("SCOREGUARD_CLOUD") == "1"
if not CLOUD_MODE:
    st.set_page_config(page_title="ScoreGuard · Streamlit", page_icon="⚽", layout="wide", initial_sidebar_state="expanded")
st.markdown("""<style>.block-container{padding-top:2rem;max-width:1600px}div[data-testid="stMetric"]{background:#f5f9f3;border:1px solid #e1eadb;border-radius:9px;padding:14px}h1{letter-spacing:-1px}.stApp{background:#fbfcfa}</style>""", unsafe_allow_html=True)


def client():
    return ApiClient(st.session_state.get("auth_cookie"), st.session_state.get("user", {}).get("id"))


def handle_error(error):
    if error.status == 401 or error.code == "ACCOUNT_CHANGED":
        st.session_state.clear()
        st.session_state["notice"] = "Sesija je istekla ili je nalog promenjen. Prijavite se ponovo."
        st.rerun()
    st.error(str(error))


def login_page():
    _, center, _ = st.columns([1, 1.4, 1])
    with center:
        st.title("ScoreGuard")
        st.subheader("Prijava operatera")
        st.caption("Fudbal · live i završeni mečevi · provera na 5 minuta")
        if st.session_state.get("notice"):
            st.info(st.session_state.pop("notice"))
        with st.form("operator-login", clear_on_submit=True):
            username = st.text_input("Korisničko ime", key="login_username")
            password = st.text_input("Lozinka", type="password", key="login_password")
            submitted = st.form_submit_button("Prijavi se", type="primary", use_container_width=True)
        if submitted:
            if not username.strip() or not password:
                st.error("Unesite korisničko ime i lozinku.")
            else:
                try:
                    cookie, user = ApiClient().login(username, password)
                    st.session_state.clear()
                    st.session_state["auth_cookie"] = cookie
                    st.session_state["user"] = user
                    st.rerun()
                except ApiError as error:
                    st.error(str(error))
        st.caption("Posle osvežavanja stranice može biti potrebna nova prijava. Sačuvani spisak i serverske provere ostaju dostupni.")


if not st.session_state.get("auth_cookie"):
    login_page()
    st.stop()

try:
    identity = client().me()
    if not identity.get("authenticated"):
        st.session_state.clear()
        st.rerun()
except ApiError as error:
    handle_error(error)
    st.stop()

st.session_state["user"] = identity
with st.sidebar:
    st.title("ScoreGuard")
    st.caption("Streamlit · Operaterski panel")
    st.write("Prijavljen: **" + identity["name"] + "**")
    page = st.radio("Radni prostor", ["Pregled mečeva", "Uvoz mečeva", "Poveži nazive klubova", "Istorija aktivnosti", "Podešavanja", "Pomoć"], key="page")
    st.divider()
    st.caption("Europe/Belgrade · Fudbal")
    if st.button("Odjavi se", use_container_width=True):
        try:
            client().logout()
            st.session_state.clear()
            st.rerun()
        except ApiError as error:
            handle_error(error)


def load_snapshot():
    try:
        return client().monitor()
    except ApiError as error:
        handle_error(error)
        st.stop()


def open_team_aliases(match):
    st.session_state["alias_context_match"] = match["match"]
    st.session_state["page"] = "Poveži nazive klubova"


def render_match_details(matches, sources):
    if not matches:
        return
    with st.expander("Detalji meča i obrada neslaganja"):
        match_by_id = {m["id"]: m for m in matches}
        selected = st.selectbox("Izaberite utakmicu", list(match_by_id), format_func=lambda key: match_by_id[key]["match"], key="detail_match")
        match = match_by_id[selected]
        reason = match.get("comparisonReason")
        if reason:
            show_reason = {"mismatch": st.error, "unverified": st.warning, "match": st.success}.get(match.get("comparisonStatus"), st.info)
            show_reason(reason)
        st.write("**Interni rezultat:** " + (match.get("score") or "—") + " · **Poluvreme:** " + (match.get("ht") or "—"))
        st.caption("Interna šifra: " + str(match.get("internalId", "—")) + " · Datum: " + str(match.get("date", "—")))
        native = match.get("native") or {}
        if native:
            st.caption("Period: " + str(native.get("phase") or "—") + " · Oznaka: " + str(native.get("market") or "—") + " · Minut gola: " + str(native.get("minute") or "—") + " (ne proverava se)")
        for source in sources:
            reference = match.get("refs", {}).get(source) or {}
            st.write("**" + SOURCE_NAMES[source] + ":** " + (reference.get("score") or "—") + " · poluvreme " + (reference.get("ht") or "—"))
            st.caption(str(reference.get("phaseLabel") or "Nije provereno") + " · preuzeto " + local_time(reference.get("checkedAt"), True))
            if reference.get("sourceHome") and reference.get("sourceAway"):
                st.caption("Uparen meč: " + reference["sourceHome"] + " – " + reference["sourceAway"] + " · Takmičenje izvora: " + (reference.get("sourceLeague") or "—"))
            if reference.get("reason"):
                st.info(reference["reason"])
            if reference.get("stale"):
                st.warning("Podaci ovog izvora su zastareli i ne potvrđuju rezultat.")
            if reference.get("url"):
                st.link_button("Otvori " + SOURCE_NAMES[source], reference["url"])
        if st.button("Poveži nazive klubova", key="link-clubs-" + selected, on_click=open_team_aliases, args=(match,)):
            st.rerun(scope="app")
        ack = match.get("ack")
        if ack:
            st.success("Obradu zabeležio " + str(ack.get("name") or ack.get("operator")) + " · " + local_time(ack.get("at"), True))
            st.write(ack.get("note", ""))
        with st.form("review-" + selected):
            note = st.text_area("Napomena operatera", value=ack.get("note", "") if ack else "", max_chars=1000, key="note-" + selected)
            if st.form_submit_button("Sačuvaj obradu"):
                try:
                    client().review(selected, note)
                    st.success("Obrada je sačuvana na serveru. Neslaganje ostaje vidljivo.")
                    st.rerun()
                except ApiError as error:
                    handle_error(error)


@st.fragment(run_every="15s")
def monitor_page():
    data = load_snapshot()
    snapshot = data.get("monitor")
    st.title("Svaki rezultat. Pod kontrolom.")
    st.caption("Povezivanje po klubovima, datumu i vremenu početka. Provera na 5 minuta; prikaz se osvežava na 15 sekundi.")
    if not snapshot:
        st.info("Još nema unetih mečeva. Otvorite „Uvoz mečeva“ u levom meniju.")
        return
    view = data.get("view") or {"counts": {}, "matches": []}
    counts = view["counts"]
    for column, (key, label) in zip(st.columns(4), [("all", "Ukupno mečeva"), ("mismatch", "Neslaganja"), ("match", "Usaglašeno"), ("unverified", "Nije provereno")]):
        column.metric(label, counts.get(key, 0))
    left, right = st.columns([3, 1])
    with left:
        last = snapshot.get("lastResult") or {}
        st.caption("Poslednja provera: " + local_time(last.get("checkedAt"), True))
        if snapshot.get("running"):
            st.info("Serverska provera je u toku.")
        elif snapshot.get("enabled"):
            st.caption("Automatika uključena · sledeća provera: " + local_time(snapshot.get("nextCheckAt")))
        else:
            st.warning("Automatske provere su pauzirane. Ručna provera je dostupna.")
    with right:
        if st.button("Proveri sada", type="primary", use_container_width=True):
            try:
                with st.spinner("Proveravam izabrane izvore…"):
                    client().check(snapshot["watch"], snapshot["enabled"])
                st.rerun()
            except ApiError as error:
                handle_error(error)
    for source, health in (last.get("health") or {}).items():
        if health.get("state") in {"unavailable", "partial"}:
            st.warning(health.get("message", SOURCE_NAMES[source] + " nije dostupan."))
    filters, search = st.columns([2, 1])
    with filters:
        selected_filter = st.radio("Prikaži", ["Svi mečevi", "Neslaganja", "Nije provereno", "Usaglašeno"], horizontal=True, key="result_filter")
    with search:
        query = st.text_input("Pretraži tim, ligu ili šifru", key="search")
    wanted = {"Neslaganja": "mismatch", "Nije provereno": "unverified", "Usaglašeno": "match"}.get(selected_filter)
    matches = [m for m in view["matches"] if (not wanted or m["comparisonStatus"] == wanted) and (not query or query.casefold() in (m["match"] + " " + m["league"] + " " + str(m.get("internalId", ""))).casefold())]
    sources = snapshot["watch"]["sources"]
    rows = table_rows(matches, sources)
    if rows:
        st.dataframe(pd.DataFrame(rows).style.apply(row_style, axis=1), hide_index=True, use_container_width=True,
                     column_config={"Razlog": st.column_config.TextColumn("Razlog", width="large")})
        render_match_details(matches, sources)
    else:
        st.info("Nema mečeva za izabrane filtere.")
    st.caption("Crveno: neslaganje · zeleno: potpuno poklapanje · žuto: nedostaju pouzdani podaci. Oznaka obrade ne menja rezultat.")


def import_page():
    data = load_snapshot()
    snapshot = data.get("monitor") or {}
    watch = snapshot.get("watch") or {}
    st.title("Uvoz iz internog programa")
    st.write("Kopirajte ceo spisak i nalepite ga ispod. Format prepoznajemo automatski.")
    c1, c2 = st.columns(2)
    with c1:
        base_date = st.date_input("Datum prvog dana spiska", value=datetime.now(BELGRADE).date(), key="import_date")
    with c2:
        format_label = st.selectbox("Format", ["Automatski prepoznaj", "Interni program", "Standardni format"], key="import_format")
    format_name = {"Automatski prepoznaj": "auto", "Interni program": "native", "Standardni format": "standard"}[format_label]
    text = st.text_area("Nalepite kopirane podatke", height=260, key="import_text", placeholder="F\nVenecuela Kup\n72499\nZamora\nAtletico Barinas\nsre 21:30\nFT\n0\n0\n0:0\n2nd half")
    st.caption("Dva broja = trenutni rezultat · zapis sa dvotačkom = poluvreme · FT/HT = drugo/prvo poluvreme · minut gola se ne proverava.")
    fingerprint = preview_fingerprint(text, base_date.isoformat(), format_name)
    if st.button("Pregledaj unos", type="primary"):
        try:
            st.session_state["preview"] = client().preview(text, base_date.isoformat(), format_name)
            st.session_state["preview_fingerprint"] = fingerprint
        except ApiError as error:
            handle_error(error)
    result = st.session_state.get("preview") if st.session_state.get("preview_fingerprint") == fingerprint else None
    if result:
        for error in result.get("errors", []):
            st.error(error)
        for warning in result.get("warnings", [])[:8]:
            st.warning(warning)
        rows = preview_rows(result)
        if rows:
            st.subheader("Prepoznati mečevi")
            st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
        if result.get("rows") and not result.get("errors"):
            dates = sorted({row.get("date", base_date.isoformat()) for row in result["rows"]})
            st.caption("Uvoz: " + str(len(result["rows"])) + " mečeva · datumi: " + ", ".join(dates))
            options = [SOURCE_NAMES[source] for source in watch.get("sources", ["flash", "sofa"])]
            chosen = st.multiselect("Izvori za poređenje", list(SOURCE_NAMES.values()), default=options, key="import_sources")
            enabled = st.checkbox("Proveravaj automatski na svakih 5 minuta", value=snapshot.get("enabled", True), key="import_enabled")
            st.info("Novi uvoz zamenjuje vaš aktivni spisak. Spisak drugog operatera se ne menja.")
            if st.button("Uvezi mečeve", disabled=not chosen, type="primary"):
                sources = [key for key, label in SOURCE_NAMES.items() if label in chosen]
                try:
                    client().configure({"date": base_date.isoformat(), "sources": sources, "matches": result["rows"]}, enabled)
                    st.session_state.pop("preview", None)
                    st.success("Mečevi su sačuvani. Otvorite „Pregled mečeva“ u levom meniju.")
                except ApiError as error:
                    handle_error(error)
    elif text:
        st.caption("Kliknite „Pregledaj unos“. Posle izmene teksta ili datuma potrebno je ponovo pregledati unos.")


def history_page():
    snapshot = load_snapshot().get("monitor")
    st.title("Istorija aktivnosti")
    if not snapshot:
        st.info("Istorija će se pojaviti nakon prvog uvoza i provere.")
        return
    checks = [{"Vreme": local_time(check.get("at"), True), "Operater": check["operator"], "Vrsta": "Automatska provera" if check["trigger"] == "scheduled" else "Ručna provera", "Izvori": " · ".join(h.get("message", "") for h in check.get("health", {}).values())} for check in snapshot.get("checks", [])]
    st.subheader("Poslednjih 50 provera")
    if checks:
        frame = pd.DataFrame(checks)
        st.dataframe(frame, hide_index=True, use_container_width=True)
        st.download_button("Preuzmi istoriju provera (CSV)", frame.to_csv(index=False).encode("utf-8-sig"), "scoreguard-provere.csv", "text/csv")
    else:
        st.info("Provera još nije izvršena.")
    reviews = [{"Vreme": local_time(event["at"], True), "Operater": event.get("name") or event["operator"], "Meč": event.get("match") or event["matchId"], "Napomena": event["note"]} for event in snapshot.get("reviewEvents", [])]
    st.subheader("Evidencija obrade")
    if reviews:
        st.dataframe(pd.DataFrame(reviews), hide_index=True, use_container_width=True)
    else:
        st.caption("Još nema napomena o obradi.")


def settings_page():
    snapshot = load_snapshot().get("monitor")
    st.title("Podešavanja provera")
    if snapshot:
        watch = snapshot["watch"]
        with st.form("watch-settings"):
            chosen = st.multiselect("Izvori", list(SOURCE_NAMES.values()), default=[SOURCE_NAMES[source] for source in watch["sources"]])
            enabled = st.checkbox("Automatska provera svakih 5 minuta", value=snapshot["enabled"])
            if st.form_submit_button("Sačuvaj podešavanja"):
                if not chosen:
                    st.error("Izaberite najmanje jedan izvor.")
                else:
                    try:
                        client().configure({**watch, "sources": [key for key, label in SOURCE_NAMES.items() if label in chosen]}, enabled)
                        st.success("Podešavanja su sačuvana na serveru.")
                    except ApiError as error:
                        handle_error(error)
    else:
        st.info("Prvo uvezite mečeve. Izvore i automatiku možete izabrati tokom uvoza.")
    st.info("Zatvaranje kartice i odjava ne pauziraju uključen nadzor dok je Cloud instanca aktivna. Uspavljivanje ili gašenje instance prekida provere." if CLOUD_MODE else "Zatvaranje kartice i odjava ne pauziraju uključen serverski nadzor. Isključite automatiku ovde ako želite da zaustavite provere.")
    st.warning("Sofascore je tokom razvoja vraćao HTTP 403. Streamlit ne uklanja zaštitu izvora; nedostupni rezultati ostaju neprovereni.")
    if identity.get("role") == "admin" and not CLOUD_MODE:
        st.divider()
        st.subheader("Paket za postavljanje")
        if st.button("Pripremi Streamlit paket za server"):
            try:
                st.session_state["deployment_zip"] = client().package()
            except ApiError as error:
                handle_error(error)
        if st.session_state.get("deployment_zip"):
            st.download_button("Preuzmi Streamlit ZIP", st.session_state["deployment_zip"], "ScoreGuard-streamlit-v0.6.zip", "application/zip")


if page == "Pregled mečeva":
    monitor_page()
elif page == "Uvoz mečeva":
    import_page()
elif page == "Poveži nazive klubova":
    render_team_aliases(client(), load_snapshot().get("monitor"), CLOUD_MODE, handle_error)
elif page == "Istorija aktivnosti":
    history_page()
elif page == "Podešavanja":
    settings_page()
else:
    st.title("Pomoć za operatera")
    guide = Path(__file__).with_name("OPERATER.md")
    st.markdown(guide.read_text(encoding="utf-8") if guide.exists() else "Uputstvo za operatera trenutno nije dostupno.")
    if CLOUD_MODE:
        st.info("U ovoj testnoj verziji provere prestaju kada se aplikacija uspava ili ugasi. Posle ponovnog pokretanja proveri da li je tvoj spisak sačuvan i po potrebi ga ponovo uvezi.")
