const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) throw Error(result.error);
  return result;
}
async function show() {
  const state = await send({ type: "state" });
  $("selector").value = state.settings.selector || "";
  $("automatic").checked = state.settings.automatic === true;
  $("bindings").textContent =
    "Backoffice: " +
    (state.settings.source?.origin || "nije povezan") +
    "\nScoreGuard: " +
    (state.settings.app?.origin || "nije povezan");
  $("status").textContent =
    state.error ||
    (state.capturedAt
      ? state.count +
        " vidljivih mečeva · pročitano " +
        new Date(state.capturedAt).toLocaleTimeString("sr-Latn-RS")
      : "Povežite oba taba, pa pročitajte tabelu.");

  $("reading-details").hidden = !state.diagnostics;
  if (state.diagnostics) {
    const d = state.diagnostics;
    $("diagnostics").textContent =
      "Verzija: 0.1.2\nDokumenti: " +
      d.documents +
      "\nShadow delovi: " +
      (d.shadowRoots || 0) +
      "\nĆelije kroz slotove: " +
      (d.slottedCells || 0) +
      "\nPretraga ograničena: " +
      (d.traversalLimited ? "da" : "ne") +
      "\nTabele: " +
      d.tables +
      "\nGrid komponente: " +
      d.grids +
      "\nRedovi sa F: " +
      d.footballRows +
      "\nKandidati: " +
      d.candidates +
      "\nOkviri: " +
      d.frames +
      "\nNedostupni okviri: " +
      d.inaccessibleFrames;
  }
}
function action(id, task) {
  $(id).addEventListener("click", async () => {
    try {
      await task();
      await show();
    } catch (error) {
      await show().catch(() => {});
      $("status").textContent = error.message;
    }
  });
}
for (const side of ["source", "app"])
  action(side, async () => {
    const url = new URL(tab.url);
    if (!["https:", "http:"].includes(url.protocol))
      throw Error("Otvorite odgovarajuću web aplikaciju.");
    if (!(await chrome.permissions.request({ origins: [url.origin + "/*"] })))
      throw Error("Pristup izabranom sajtu nije odobren.");
    await send({ type: "bind", side, tabId: tab.id, selector: $("selector").value });
  });
action("capture", () => send({ type: "capture" }));
action("disconnect", () => send({ type: "disconnect" }));
$("automatic").addEventListener("change", async () => {
  try {
    await send({ type: "automatic", enabled: $("automatic").checked });
    await show();
  } catch (error) {
    $("status").textContent = error.message;
    $("automatic").checked = false;
  }
});
await show();
