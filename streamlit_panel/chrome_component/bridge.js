(() => {
  let channel, operator, lastRead;
  let currentRelay = false;
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
  const time = (value) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleTimeString("sr-Latn-RS")
      : "—";
  window.addEventListener("message", (event) => {
    if (
      event.source === window.parent &&
      event.origin === parentOrigin &&
      event.data?.type === "streamlit:render"
    ) {
      const args = event.data.args;
      if (args.channel !== channel) lastRead = null;
      channel = args.channel;
      operator = args.operator;
      pull();
      return;
    }
    const value = event.data;
    if (
      !channel ||
      event.source !== window ||
      event.origin !== location.origin ||
      value?.type !== "SG_CHROME_DATA" ||
      value.channel !== channel ||
      (value.operator && value.operator !== operator)
    )
      return;
    if (value.relayVersion === "0.1.6") currentRelay = true;
    else if (currentRelay) return;
    const clock = value.status;
    const timing = clock
      ? "\nPoslednje čitanje: " +
        time(clock.capturedAt) +
        "\nSledeće čitanje: " +
        (clock.automatic ? time(clock.nextReadAt) : "ručni režim")
      : "";
    if (!value.ok || value.error) {
      status.textContent = (value.error || "Prenos nije dostupan.") + timing;
      return;
    }
    const snapshot = value.snapshot;
    if (!snapshot) {
      status.textContent = "U dodatku povežite oba taba i kliknite Pročitaj sada." + timing;
      return;
    }
    if (
      value.operator !== operator ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      Date.now() - Date.parse(snapshot.capturedAt) > 330000 ||
      Date.now() - Date.parse(snapshot.capturedAt) < -30000
    ) {
      status.textContent = "Potrebno je novo čitanje Backoffice tabele." + timing;
      return;
    }
    status.textContent =
      snapshot.count +
      " vidljivih mečeva · " +
      snapshot.sourceOrigin +
      (timing || "\nPročitano: " + time(snapshot.capturedAt));
    const read = snapshot.id + ":" + (snapshot.captureId || snapshot.capturedAt);
    if (read !== lastRead || value.requestId) {
      lastRead = read;
      streamlit("streamlit:setComponentValue", {
        value: {
          ...snapshot,
          channel,
          operator,
          requestId: value.requestId || "",
          extensionStatus: clock || null,
        },
        dataType: "json",
      });
    }
  });
  document.getElementById("refresh").addEventListener("click", () => pull(true));
  setInterval(() => pull(), 3000);
  streamlit("streamlit:componentReady", { apiVersion: 1 });
  streamlit("streamlit:setFrameHeight", { height: 155 });
})();
