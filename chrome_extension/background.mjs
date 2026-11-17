import { captureSnapshot } from "./capture.mjs";

const ALARM = "scoreguard-passive-capture";
const CONFIG = "scoreguard-config";
const SNAPSHOT = "scoreguard-snapshot";
const READ_INTERVAL_MS = 300000;
const SESSION_KEYS = [SNAPSHOT, "lastError", "lastDiagnostics", "lastAttemptAt"];
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
async function ensureAlarm(settings, reset = false) {
  const alarm = await chrome.alarms.get(ALARM);
  if (!settings.automatic || !settings.source || !settings.app) {
    if (alarm) await chrome.alarms.clear(ALARM);
    return null;
  }
  if (reset || !alarm || alarm.periodInMinutes !== 5) {
    const session = await chrome.storage.session.get("lastAttemptAt");
    const attempted = Date.parse(session.lastAttemptAt);
    const now = Date.now();
    const due =
      Number.isFinite(attempted) && attempted <= now + 30000
        ? attempted + READ_INTERVAL_MS
        : now + READ_INTERVAL_MS;
    await chrome.alarms.create(ALARM, { when: Math.max(now + 1000, due), periodInMinutes: 5 });
    return chrome.alarms.get(ALARM);
  }
  return alarm;
}
async function readStatus(settings, session) {
  const alarm = await ensureAlarm(settings);
  return {
    automatic: settings.automatic === true,
    lastAttemptAt: session.lastAttemptAt || null,
    capturedAt: session[SNAPSHOT]?.capturedAt || null,
    nextReadAt: alarm?.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : null,
    error: session.lastError || "",
  };
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
async function capture(force = true) {
  if (captureRunning) return captureRunning;
  let attempted = false;
  captureRunning = (async () => {
    const settings = await config();
    if (!settings.source) throw Error("Prvo povežite Backoffice tab.");
    const session = await chrome.storage.session.get(SESSION_KEYS);
    const now = Date.now();
    const previousAttempt = Date.parse(session.lastAttemptAt);
    if (
      !force &&
      Number.isFinite(previousAttempt) &&
      now - previousAttempt >= -30000 &&
      now - previousAttempt < READ_INTERVAL_MS
    )
      return session[SNAPSHOT] || null;
    attempted = true;
    await chrome.storage.session.set({ lastAttemptAt: new Date(now).toISOString() });
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
      captureId: crypto.randomUUID(),
      text: value.text,
      count: value.count,
      capturedAt: new Date(Date.now()).toISOString(),
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
    if (attempted) await ensureAlarm(await config(), true);
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
    await ensureAlarm(settings);
    if (message.refresh === true || settings.automatic)
      await capture(message.refresh === true).catch(() => {});
    const session = await chrome.storage.session.get(SESSION_KEYS);
    const status = await readStatus(settings, session);
    return {
      snapshot: session.lastError ? null : session[SNAPSHOT] || null,
      error: session.lastError || "",
      status,
      channel: message.channel,
      operator: message.operator,
    };
  }
  if (sender.url !== chrome.runtime.getURL("popup.html"))
    throw Error("Komanda je dostupna samo iz dodatka.");
  if (message.type === "state") {
    const session = await chrome.storage.session.get(SESSION_KEYS);
    const latest = session[SNAPSHOT];
    return {
      settings,
      count: latest?.count,
      capturedAt: latest?.capturedAt,
      error: session.lastError,
      diagnostics: session.lastDiagnostics,
      status: await readStatus(settings, session),
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
      await chrome.storage.session.remove(SESSION_KEYS);
    }
    await chrome.storage.local.set({ [CONFIG]: settings });
    await ensureAlarm(settings);
    if (message.side === "app") await registerRelay(settings);
    return { ok: true };
  }
  if (message.type === "automatic") {
    if (!settings.source || !settings.app) throw Error("Povežite oba taba.");
    settings.automatic = message.enabled === true;
    await chrome.storage.local.set({ [CONFIG]: settings });
    await ensureAlarm(settings);
    if (settings.automatic) await capture();
    return { ok: true };
  }
  if (message.type === "capture") return { snapshot: await capture() };
  if (message.type === "disconnect") {
    await chrome.storage.local.remove(CONFIG);
    await chrome.storage.session.remove(SESSION_KEYS);
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
  if (alarm.name === ALARM && (await config()).automatic) await capture(false).catch(() => {});
});
chrome.runtime.onStartup.addListener(async () => {
  const settings = await config();
  await ensureAlarm(settings);
  await registerRelay(settings);
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await config();
  await ensureAlarm(settings);
  await registerRelay(settings);
});
