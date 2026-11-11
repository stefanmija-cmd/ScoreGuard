"""Community Cloud entrypoint: panel and services in one instance."""
from pathlib import Path
import runpy
import sys
import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from cloud_runtime.bootstrap import boot_cloud
from cloud_runtime.runtime import CloudRuntimeError

st.set_page_config(page_title="ScoreGuard · Cloud test", page_icon="⚽", layout="wide", initial_sidebar_state="expanded")
try:
    runtime = boot_cloud()
except CloudRuntimeError as error:
    st.title("ScoreGuard · Cloud test")
    st.error(str(error))
    st.link_button("Uputstvo i preuzimanje konfiguracije", "https://scoreguard-ops-monitor.appealingphlox8.chatgpt.site/downloads/cloud-uputstvo")
    st.stop()


@st.fragment(run_every="15s")
def cloud_status():
    status = runtime.status()
    st.warning("Testna Cloud verzija: provere rade dok je Streamlit instanca aktivna. Uspavljivanje zaustavlja proveru; pri ponovnom kreiranju instance spiskovi i istorija mogu biti izgubljeni.")
    if status["running"]:
        st.caption("Servis za proveru je aktivan · interval 5 minuta · ručna provera je dostupna")
    else:
        st.error(status["error"] or "Servis se ponovo pokreće. Sačekajte nekoliko sekundi.")


cloud_status()
# Execute on every Streamlit rerun; importing the panel would cache user UI state.
runpy.run_path(str(ROOT / "streamlit_panel/streamlit_app.py"), run_name="__main__")
