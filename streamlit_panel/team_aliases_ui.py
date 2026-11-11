from __future__ import annotations
import json
import re
import streamlit as st
import pandas as pd
from streamlit_panel.api_client import ApiError
from streamlit_panel.presentation import local_time

ALIAS_SOURCE_NAMES = {"flash": "Flashscore", "sofa": "Sofascore", "all": "Oba izvora"}


def render_team_aliases(api, snapshot, cloud_mode, handle_error):
    st.title("Poveži nazive klubova")
    st.caption("Sačuvaj različite nazive za isti klub i istu selekciju. Povezivanja važe za tvoj nalog i koriste se u narednim proverama.")
    try:
        data = api.team_aliases()
    except ApiError as error:
        handle_error(error)
        return
    if st.session_state.get("alias_notice"):
        st.success(st.session_state.pop("alias_notice"))
    if data.get("configuredCount"):
        st.caption("Aktivna su i ranije podešena povezivanja klubova. Uklanjanje veze sa ovog spiska ne uklanja ta ranija pravila.")
    if st.session_state.pop("alias_reset_form", False):
        st.session_state["alias_confirmed"] = False
        st.session_state["alias_source_name"] = ""
        st.session_state["alias_import_confirmed"] = False

    matches = (snapshot or {}).get("watch", {}).get("matches", [])
    names = sorted({name for match in matches for name in re.split(r"\s+[–—-]\s+", match["match"])})
    context = st.session_state.get("alias_context_match")
    if context and any(match["match"] == context for match in matches):
        st.info("Izabrani meč: " + context)
        preferred = re.split(r"\s+[–—-]\s+", context)
        names = preferred + [name for name in names if name not in preferred]
    options = [""] + names
    if st.session_state.get("alias_internal_pick", "") not in options:
        st.session_state["alias_internal_pick"] = ""
    selected = st.selectbox("Popuni naziv iz internog spiska (opciono)", options,
                            format_func=lambda value: value or "Unesi naziv ručno", key="alias_internal_pick")
    if selected != st.session_state.get("alias_last_pick", ""):
        st.session_state["alias_internal_name"] = selected
        st.session_state["alias_last_pick"] = selected

    st.caption("Primer: interno „Victoria Utd Limbe“, na Flashscore-u „Victoria United“.")
    with st.form("team-alias-form"):
        source = st.selectbox("Izvor za ovo povezivanje", list(ALIAS_SOURCE_NAMES), format_func=ALIAS_SOURCE_NAMES.get, key="alias_source")
        left, right = st.columns(2)
        with left:
            internal_name = st.text_input("Naziv u internom programu", max_chars=150, placeholder="Victoria Utd Limbe", key="alias_internal_name")
        with right:
            source_name = st.text_input("Naziv na izabranom izvoru", max_chars=150, placeholder="Victoria United", key="alias_source_name")
        confirmed = st.checkbox("Potvrđujem da oba naziva označavaju isti klub i istu selekciju.", key="alias_confirmed")
        if st.form_submit_button("Sačuvaj povezivanje", type="primary"):
            if not confirmed:
                st.error("Potvrdi da oba naziva označavaju isti klub i istu selekciju.")
            else:
                try:
                    result = api.save_team_alias(source, internal_name, source_name, confirmed)
                    st.session_state["alias_notice"] = "Povezivanje je sačuvano. U pregledu klikni „Proveri sada“ ili sačekaj uključenu automatsku proveru." if result.get("changed") else "Ovo povezivanje je već sačuvano."
                    st.session_state["alias_reset_form"] = True
                    st.rerun()
                except ApiError as error:
                    handle_error(error)

    links = data.get("aliases", [])
    st.subheader("Sačuvana povezivanja (" + str(len(links)) + ")")
    if links:
        rows = [{"Interni naziv": link["internalName"], "Naziv na izvoru": link["sourceName"], "Izvor": ALIAS_SOURCE_NAMES[link["source"]], "Sačuvao": link.get("createdName", ""), "Vreme": local_time(link.get("createdAt"), True)} for link in links]
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        st.download_button("Preuzmi povezivanja (JSON)", json.dumps({"version": 1, "aliases": [{key: link[key] for key in ("source", "internalName", "sourceName")} for link in links]}, ensure_ascii=False, indent=2).encode("utf-8"), "scoreguard-povezivanja.json", "application/json")
        with st.form("remove-team-alias"):
            chosen = st.selectbox("Povezivanje koje želiš da ukloniš", links, format_func=lambda link: link["internalName"] + " ↔ " + link["sourceName"] + " · " + ALIAS_SOURCE_NAMES[link["source"]], key="alias_remove_pick")
            if st.form_submit_button("Ukloni povezivanje"):
                try:
                    api.remove_team_alias(chosen["id"])
                    st.session_state["alias_notice"] = "Povezivanje je uklonjeno. Rezultati će se ponovo proveriti."
                    st.rerun()
                except ApiError as error:
                    handle_error(error)
    else:
        st.info("Još nema sačuvanih povezivanja. Dodaj dva različita naziva istog kluba u obrazac iznad.")

    with st.expander("Vrati prethodno preuzeta povezivanja"):
        uploaded = st.file_uploader("Izaberi scoreguard-povezivanja.json", type=["json"], key="alias_import_file")
        with st.form("import-team-aliases"):
            import_confirmed = st.checkbox("Potvrđujem da su povezivanja iz ove datoteke proverena.", key="alias_import_confirmed")
            if st.form_submit_button("Uvezi povezivanja", disabled=uploaded is None):
                try:
                    if not import_confirmed:
                        raise ValueError("Potvrdi da su povezivanja proverena.")
                    if uploaded.size > 1000000:
                        raise ValueError("Datoteka je prevelika; podržano je najviše 500 povezivanja.")
                    payload = json.loads(uploaded.getvalue())
                    if not isinstance(payload, dict) or payload.get("version") != 1 or not isinstance(payload.get("aliases"), list):
                        raise ValueError("Izaberi prethodno preuzetu datoteku povezivanja.")
                    api.import_team_aliases(payload["aliases"], import_confirmed)
                    st.session_state["alias_notice"] = "Povezivanja su uvezena na tvoj nalog. Ponovo proveri mečeve."
                    st.session_state["alias_reset_form"] = True
                    st.rerun()
                except (ValueError, UnicodeError):
                    st.error("Proveri potvrdu i izaberi važeću JSON datoteku prethodno preuzetih povezivanja (najviše 500).")
                except ApiError as error:
                    handle_error(error)
    if cloud_mode:
        st.caption("U testnoj verziji povezivanja mogu nestati pri ponovnom kreiranju aplikacije. Preuzmi JSON kopiju i po potrebi je vrati kroz ovaj ekran.")
    if data.get("events"):
        with st.expander("Poslednje izmene povezivanja"):
            st.dataframe(pd.DataFrame([{"Vreme": local_time(event["at"], True), "Operater": event.get("name", ""), "Izmena": "Dodato" if event["action"] == "added" else "Uklonjeno", "Interni naziv": event["internalName"], "Naziv na izvoru": event["sourceName"], "Izvor": ALIAS_SOURCE_NAMES[event["source"]]} for event in data["events"]]), hide_index=True, width="stretch")
