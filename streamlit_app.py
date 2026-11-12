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
from streamlit_panel.layout import page_styles

st.set_page_config(
    page_title="ScoreGuard · Cloud test",
    page_icon="⚽",
    layout="wide",
    initial_sidebar_state="expanded",
)
# Apply spacing before the Cloud notice, including before login or a startup error.
st.markdown(page_styles(cloud_mode=True), unsafe_allow_html=True)
try:
    runtime = boot_cloud()
except CloudRuntimeError as error:
    st.title("ScoreGuard · Cloud test")
    st.error(str(error))
    st.link_button(
        "Uputstvo za postavljanje",
        "https://github.com/stefanmija-cmd/ScoreGuard/blob/main/CLOUD-START.md",
    )
    st.stop()


@st.fragment(run_every="15s")
def cloud_status():
    status = runtime.status()
    if status.get("durableStorage"):
        st.info(
            "Cloud test sa spoljnom bazom: podaci se čuvaju u bazi. Provere rade dok je Streamlit instanca aktivna; uspavljivanje zaustavlja proveru."
        )
    else:
        st.warning(
            "Testna Cloud verzija: provere rade dok je Streamlit instanca aktivna. Uspavljivanje zaustavlja proveru; pri ponovnom kreiranju instance spiskovi, povezivanja klubova i istorija mogu biti izgubljeni. U Podešavanjima preuzmi rezervnu kopiju."
        )
    if status["running"]:
        st.caption("Servis za proveru je aktivan · interval 5 minuta · ručna provera je dostupna")
    else:
        st.error(status["error"] or "Servis se ponovo pokreće. Sačekajte nekoliko sekundi.")


cloud_status()
# Execute on every Streamlit rerun; importing the panel would cache user UI state.
runpy.run_path(str(ROOT / "streamlit_panel/streamlit_app.py"), run_name="__main__")
