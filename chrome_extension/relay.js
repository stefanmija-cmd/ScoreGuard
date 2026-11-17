// This script runs only on the explicitly granted ScoreGuard origin.
(() => {
  if (
    globalThis.__scoreguardRelay ||
    !location.pathname.includes("/component/") ||
    !location.pathname.includes("scoreguard_chrome_bridge")
  )
    return;
  globalThis.__scoreguardRelay = true;
  let busy = false;
  window.addEventListener("message", async (event) => {
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
          channel: value.channel,
          ok: false,
          error: "Ponovo povežite ScoreGuard tab u dodatku.",
        },
        location.origin,
      );
    } finally {
      busy = false;
    }
  });
})();
