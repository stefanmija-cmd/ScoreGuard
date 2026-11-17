// This script runs only on the explicitly granted ScoreGuard origin.
(() => {
  if (
    !location.pathname.includes("/component/") ||
    !location.pathname.includes("scoreguard_chrome_bridge")
  )
    return;
  if (globalThis.__scoreguardRelay?.listener)
    window.removeEventListener("message", globalThis.__scoreguardRelay.listener);
  let busy = false;
  const listener = async (event) => {
    const value = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      value?.type !== "SG_CHROME_PULL" ||
      !/^[a-f0-9]{48}$/.test(value.channel || "") ||
      busy
    )
      return;
    busy = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "bridge-pull",
        channel: value.channel,
        operator: value.operator,
        refresh: value.refresh === true,
      });
      window.postMessage(
        {
          type: "SG_CHROME_DATA",
          relayVersion: "0.1.4",
          channel: value.channel,
          operator: value.operator,
          requestId: value.refresh === true ? value.requestId : "",
          ...response,
        },
        location.origin,
      );
    } catch {
      window.postMessage(
        {
          type: "SG_CHROME_DATA",
          relayVersion: "0.1.4",
          channel: value.channel,
          ok: false,
          error: "Ponovo povežite ScoreGuard tab u dodatku.",
        },
        location.origin,
      );
    } finally {
      busy = false;
    }
  };
  globalThis.__scoreguardRelay = { version: "0.1.4", listener };
  window.addEventListener("message", listener);
})();
