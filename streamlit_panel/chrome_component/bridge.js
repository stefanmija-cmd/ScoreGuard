(() => {
  let channel, operator, lastId;
  const status = document.getElementById("status");
  const parentOrigin = new URL(document.referrer || location.href).origin;
  function streamlit(type, fields = {}) {
    window.parent.postMessage({ isStreamlitMessage: true, type, ...fields }, parentOrigin);
  }
  function pull(refresh = false) {
    if (channel)
      window.postMessage(
        {
          type: "SG_CHROME_PULL",
          channel,
          operator,
          refresh,
          requestId: refresh ? crypto.randomUUID() : "",
        },
        location.origin,
      );
  }
  window.addEventListener("message", (event) => {
    if (
      event.source === window.parent &&
      event.origin === parentOrigin &&
      event.data?.type === "streamlit:render"
    ) {
      const args = event.data.args;
      if (args.channel !== channel) lastId = null;
      channel = args.channel;
      operator = args.operator;
      pull();
      return;
    }
    const value = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      value?.type !== "SG_CHROME_DATA" ||
      value.channel !== channel
    )
      return;
    if (!value.ok) {
      status.textContent = value.error || "Prenos nije dostupan.";
      return;
    }
    const snapshot = value.snapshot;
    if (!snapshot) {
      status.textContent = "U dodatku povežite oba taba i kliknite Pročitaj sada.";
      return;
    }
    if (
      value.operator !== operator ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      Date.now() - Date.parse(snapshot.capturedAt) > 330000 ||
      Date.now() - Date.parse(snapshot.capturedAt) < -30000
    ) {
      status.textContent = "Potrebno je novo čitanje Backoffice tabele.";
      return;
    }
    status.textContent =
      snapshot.count +
      " vidljivih mečeva · " +
      new Date(snapshot.capturedAt).toLocaleTimeString("sr-Latn-RS") +
      " · " +
      snapshot.sourceOrigin;
    if (snapshot.id !== lastId || value.requestId) {
      lastId = snapshot.id;
      streamlit("streamlit:setComponentValue", {
        value: { ...snapshot, channel, operator, requestId: value.requestId || "" },
        dataType: "json",
      });
    }
  });
  document.getElementById("refresh").addEventListener("click", () => pull(true));
  setInterval(() => pull(), 3000);
  streamlit("streamlit:componentReady", { apiVersion: 1 });
  streamlit("streamlit:setFrameHeight", { height: 110 });
})();
