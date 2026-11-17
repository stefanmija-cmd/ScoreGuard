import { captureSnapshot } from "./capture.mjs";

const ALARM = "scoreguard-passive-capture";
const CONFIG = "scoreguard-config";
const SNAPSHOT = "scoreguard-snapshot";
let captureRunning;
const config = async () => (await chrome.storage.local.get(CONFIG))[CONFIG] || {};
function locationKey(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw Error("Potreban je otvoren web tab.");
  return { origin: url.origin, pathname: url.pathname };
}
function samePage(value, binding) {
  try {
    const page = locationKey(value);
    return page.origin === binding.origin && page.pathname === binding.pathname;
  } catch {
    return false;
  }
}
async function schedule(settings) {
  await chrome.alarms.clear(ALARM);
  if (settings.automatic) await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
}
async function registerRelay(settings) {
  await chrome.scripting.unregisterContentScripts({ ids: ["scoreguard-relay"] }).catch(() => {});
  if (!settings.app) return;
  await chrome.scripting.registerContentScripts([
    {
      id: "scoreguard-relay",
      matches: [settings.app.origin + "/*"],
      js: ["relay.js"],
      allFrames: true,
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
  await chrome.scripting
    .executeScript({ target: { tabId: settings.app.tabId, allFrames: true }, files: ["relay.js"] })
    .catch(() => {});
}
async function capture() {
  if (captureRunning) return captureRunning;
  captureRunning = (async () => {
    const settings = await config();
    if (!settings.source) throw Error("Prvo povežite Backoffice tab.");
    const tab = await chrome.tabs.get(settings.source.tabId);
    if (!samePage(tab.url, settings.source))
      throw Error("Backoffice tab je promenjen. Ponovo povežite tačan spisak.");
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureSnapshot,
      args: [settings.selector || "", true],
    });
    const value = results[0]?.result;
    await chrome.storage.session.set({ lastDiagnostics: value?.diagnostics || null });
    if (value?.error) throw Error(value.error);
    if (!value?.text)
      throw Error(
        "Chrome nije vratio podatke tabele. Ponovo učitajte dodatak i povežite Backoffice tab.",
      );
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.text));
    const id = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const snapshot = {
      version: 1,
      id,
      text: value.text,
      count: value.count,
      capturedAt: new Date().toISOString(),
      sourceOrigin: settings.source.origin,
    };
    await chrome.storage.session.set({ [SNAPSHOT]: snapshot, lastError: "" });
    return snapshot;
  })();
  try {
    return await captureRunning;
  } catch (error) {
    await chrome.storage.session.set({ lastError: error.message });
    throw error;
  } finally {
    captureRunning = null;
  }
}
export async function handleMessage(message, sender) {
  if (sender.id !== chrome.runtime.id) throw Error("Nepoznat pošiljalac.");
  const settings = await config();
  if (message.type === "bridge-pull") {
    const page = locationKey(sender.url);
    if (
      !settings.app ||
      sender.tab?.id !== settings.app.tabId ||
      page.origin !== settings.app.origin ||
      !page.pathname.includes("/component/") ||
      !page.pathname.includes("scoreguard_chrome_bridge") ||
      !sender.frameId
    )
      throw Error("Ovaj tab nije povezan kao ScoreGuard.");
    if (
      !/^[a-f0-9]{48}$/.test(message.channel || "") ||
      typeof message.operator !== "string" ||
      message.operator.length > 100
    )
      throw Error("Neispravan kanal prijavljenog operatera.");
    if (message.refresh === true) await capture();
    const session = await chrome.storage.session.get([SNAPSHOT, "lastError", "lastDiagnostics"]);
    if (session.lastError) throw Error(session.lastError);
    return {
      snapshot: session[SNAPSHOT] || null,
      channel: message.channel,
      operator: message.operator,
    };
  }
  if (sender.url !== chrome.runtime.getURL("popup.html"))
    throw Error("Komanda je dostupna samo iz dodatka.");
  if (message.type === "state") {
    const session = await chrome.storage.session.get([SNAPSHOT, "lastError", "lastDiagnostics"]);
    const latest = session[SNAPSHOT];
    return {
      settings,
      count: latest?.count,
      capturedAt: latest?.capturedAt,
      error: session.lastError,
      diagnostics: session.lastDiagnostics,
    };
  }
  if (message.type === "bind") {
    if (!["source", "app"].includes(message.side)) throw Error("Nepoznat tab.");
    const tab = await chrome.tabs.get(message.tabId);
    const binding = { ...locationKey(tab.url), tabId: tab.id };
    if (!(await chrome.permissions.contains({ origins: [binding.origin + "/*"] })))
      throw Error("Pristup tom sajtu nije odobren.");
    settings[message.side] = binding;
    if (message.side === "source") {
      settings.selector = String(message.selector || "")
        .trim()
        .slice(0, 300);
      settings.automatic = false;
      await chrome.storage.session.remove([SNAPSHOT, "lastError", "lastDiagnostics"]);
    }
    await chrome.storage.local.set({ [CONFIG]: settings });
    await schedule(settings);
    if (message.side === "app") await registerRelay(settings);
    return { ok: true };
  }
  if (message.type === "automatic") {
    if (!settings.source || !settings.app) throw Error("Povežite oba taba.");
    settings.automatic = message.enabled === true;
    await chrome.storage.local.set({ [CONFIG]: settings });
    await schedule(settings);
    if (settings.automatic) await capture();
    return { ok: true };
  }
  if (message.type === "capture") return { snapshot: await capture() };
  if (message.type === "disconnect") {
    await chrome.storage.local.remove(CONFIG);
    await chrome.storage.session.remove([SNAPSHOT, "lastError", "lastDiagnostics"]);
    await chrome.alarms.clear(ALARM);
    await chrome.scripting.unregisterContentScripts({ ids: ["scoreguard-relay"] }).catch(() => {});
    return { ok: true };
  }
  throw Error("Nepoznata komanda.");
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handleMessage(message, sender)
    .then((value) => reply({ ok: true, ...value }))
    .catch((error) => reply({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM && (await config()).automatic) await capture().catch(() => {});
});
chrome.runtime.onStartup.addListener(async () => {
  const settings = await config();
  await schedule(settings);
  await registerRelay(settings);
});
