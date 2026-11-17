import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { captureSnapshot } from "../chrome_extension/capture.mjs";
import { parseNativeClipboard, mapNativeClipboard } from "../scraper/native-import.mjs";

const fields = [
  "F",
  "Venecuela Kup",
  "72499",
  "Zamora",
  "Atletico Barinas",
  "sre 21:30",
  "FT",
  "0",
  "0",
  "0:0",
  "",
  "2nd half",
  "private-action",
];
function table(rows = [fields]) {
  return {
    tagName: "TABLE",
    querySelectorAll: () =>
      rows.map((values) => ({
        getClientRects: () => [{}],
        querySelectorAll: () => values.map((innerText) => ({ innerText })),
      })),
  };
}
function capture(tables, selector = "", reportErrors = false) {
  const document = { querySelectorAll: () => tables };
  return vm.runInNewContext(
    "(" + captureSnapshot.toString() + ")(" + JSON.stringify(selector) + "," + reportErrors + ")",
    { document },
  );
}
function slottedCell(value, index, extra = {}) {
  const content = {
    tagName: "VAADIN-GRID-CELL-CONTENT",
    childNodes: typeof value === "string" ? [{ nodeType: 3, nodeValue: value }] : value,
  };
  const slot = { tagName: "SLOT", assignedNodes: () => [content] };
  return {
    innerText: "",
    style: { order: String(index) },
    childNodes: [slot],
    querySelectorAll: () => [slot],
    ...extra,
  };
}
function cellGrid(cells, display = "flex") {
  return {
    tagName: "TABLE",
    querySelectorAll: () => [
      {
        style: { display },
        getClientRects: () => [{}],
        querySelectorAll: () => cells,
      },
    ],
  };
}
test("passive capture serializes only documented football cells and never loads another page", () => {
  const result = capture([table([fields, ["B", "Basketball", "1"]])]);
  assert.equal(result.count, 1);
  assert.equal(result.text, fields.slice(0, 12).join("\t"));
  assert.doesNotMatch(result.text, /private-action/);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.rows[0].internalId, "72499");
  assert.equal(imported.rows[0].score, "0:0");
  assert.equal(imported.rows[0].ht, "0:0");
  assert.equal(imported.rows[0].expectedStatus, "second_half");
});
test("passive capture refuses ambiguous tables, broken football rows and whole-page selectors", () => {
  assert.throws(
    () => capture([table(), table([[...fields.slice(0, 2), "99999", ...fields.slice(3)]])]),
    /više tabela/,
  );
  assert.throws(
    () => capture([table([["F", "Liga", "bad-id", "A", "B", "sre 20:00"]])]),
    /očekivane kolone/,
  );
  assert.throws(() => capture([table()], "body"), /celu stranicu/);
  assert.throws(() => capture([]), /Nema prepoznatih/);
});
test("passive capture refuses oversized lists instead of silently truncating", () => {
  assert.throws(() => capture([table(Array(1001).fill(fields))]), /1.000/);
});

let serial = 0;
async function worker(settings = {}, injectedResult) {
  const local = { "scoreguard-config": settings },
    session = {},
    events = {};
  let reads = 0;
  const alarms = [];
  const activeAlarms = new Map();
  function store(data) {
    return {
      get: async (keys) =>
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys])
            .filter((key) => key in data)
            .map((key) => [key, data[key]]),
        ),
      set: async (values) => Object.assign(data, values),
      remove: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      },
    };
  }
  const chrome = {
    runtime: {
      id: "scoreguard-test",
      getURL: (path) => "chrome-extension://scoreguard-test/" + path,
      onMessage: { addListener: (fn) => (events.message = fn) },
      onStartup: { addListener: (fn) => (events.start = fn) },
      onInstalled: { addListener: (fn) => (events.installed = fn) },
    },
    storage: { local: store(local), session: store(session) },
    tabs: {
      get: async (id) => ({
        id,
        url:
          id === 7
            ? "https://backoffice.test/matches?token=do-not-store"
            : "https://panel.streamlit.app/",
      }),
    },
    permissions: { contains: async () => true },
    alarms: {
      get: async (name) => activeAlarms.get(name),
      clear: async (name) => activeAlarms.delete(name),
      create: async (name, options) => {
        const alarm = {
          name,
          ...options,
          scheduledTime: options.when || Date.now() + options.periodInMinutes * 60000,
        };
        alarms.push(alarm);
        activeAlarms.set(name, alarm);
      },
      onAlarm: { addListener: (fn) => (events.alarm = fn) },
    },
    scripting: {
      unregisterContentScripts: async () => {},
      registerContentScripts: async () => {},
      executeScript: async (args) => {
        if (args.func) {
          reads++;
          assert.equal(args.args[1], true);
          return [{ result: injectedResult === undefined ? capture([table()]) : injectedResult }];
        }
        return [];
      },
    },
  };
  globalThis.chrome = chrome;
  const module = await import("../chrome_extension/background.mjs?test=" + serial++);
  return {
    handle: module.handleMessage,
    local,
    session,
    events,
    alarms,
    activeAlarms,
    reads: () => reads,
  };
}
const settings = () => ({
  source: { origin: "https://backoffice.test", pathname: "/matches", tabId: 7 },
  app: { origin: "https://panel.streamlit.app", pathname: "/", tabId: 8 },
});
const popup = { id: "scoreguard-test", url: "chrome-extension://scoreguard-test/popup.html" };
const bridge = {
  id: "scoreguard-test",
  url: "https://panel.streamlit.app/component/streamlit_panel.chrome_import.scoreguard_chrome_bridge/index.html",
  tab: { id: 8 },
  frameId: 3,
};
const pull = { type: "bridge-pull", channel: "a".repeat(48), operator: "operator-test" };
test("extension rejects unbound tabs, other origins and top-frame senders before reading data", async () => {
  const runtime = await worker(settings());
  for (const sender of [
    { ...bridge, tab: { id: 9 } },
    { ...bridge, url: "https://other.test/component/scoreguard_chrome_bridge/index.html" },
    { ...bridge, frameId: 0 },
    { ...bridge, id: "other-extension" },
  ])
    await assert.rejects(runtime.handle({ ...pull, refresh: true }, sender));
  assert.equal(runtime.reads(), 0);
  await assert.rejects(
    runtime.handle({ type: "capture" }, { ...bridge, url: "https://backoffice.test/matches" }),
  );
});
test("manual browser bridge captures once and polling reuses the same snapshot", async () => {
  const runtime = await worker(settings());
  const first = await runtime.handle({ ...pull, refresh: true }, bridge);
  assert.equal(first.snapshot.count, 1);
  assert.match(first.snapshot.id, /^[a-f0-9]{64}$/);
  assert.equal(first.operator, "operator-test");
  const second = await runtime.handle(pull, bridge);
  assert.equal(first.snapshot.id, second.snapshot.id);
  assert.equal(runtime.reads(), 1);
  assert.doesNotMatch(JSON.stringify(first), /token=|password|Cookie/);
});
test("five-minute automatic capture and disconnect preserve explicit control", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const runtime = await worker(settings());
  await runtime.handle({ type: "automatic", enabled: true }, popup);
  assert.equal(runtime.alarms.at(-1).periodInMinutes, 5);
  now += 300000;
  await runtime.events.alarm({ name: "scoreguard-passive-capture" });
  assert.equal(runtime.reads(), 2);
  await runtime.handle({ type: "disconnect" }, popup);
  assert.deepEqual(runtime.session, {});
  assert.deepEqual(runtime.local, {});
});
test("rebinding Backoffice clears previous data, pauses automation and stores no URL parameters", async () => {
  const runtime = await worker({ ...settings(), automatic: true });
  await runtime.handle({ ...pull, refresh: true }, bridge);
  await runtime.handle({ type: "bind", side: "source", tabId: 7, selector: "#matches" }, popup);
  const saved = runtime.local["scoreguard-config"];
  assert.equal(saved.automatic, false);
  assert.equal(saved.source.pathname, "/matches");
  assert.doesNotMatch(JSON.stringify(saved), /do-not-store|token/);
  assert.deepEqual(runtime.session, {});
});
test("extension manifest uses optional site grants and no cookie or network interception permissions", () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../chrome_extension/manifest.json", import.meta.url)),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage", "alarms"]);
  for (const file of ["background.mjs", "capture.mjs", "relay.js", "popup.mjs"])
    assert.doesNotMatch(
      fs.readFileSync(new URL("../chrome_extension/" + file, import.meta.url), "utf8"),
      /\bfetch\s*\(|XMLHttpRequest|webRequest|location\.reload/,
    );
});

test("Streamlit bridge rejects other sessions, deduplicates delivery and forwards fresh unchanged reads", () => {
  const sent = [],
    callbacks = {},
    parent = { postMessage: (value) => sent.push(value) },
    status = { textContent: "" };
  const window = {
    parent,
    postMessage() {},
    addEventListener: (type, fn) => (callbacks[type] = fn),
  };
  const context = {
    window,
    document: {
      referrer: "https://panel.streamlit.app/",
      getElementById: (id) => (id === "status" ? status : { addEventListener() {} }),
    },
    location: { origin: "https://panel.streamlit.app", href: bridge.url },
    URL,
    Date,
    crypto: globalThis.crypto,
    setInterval() {},
  };
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../streamlit_panel/chrome_component/bridge.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  callbacks.message({
    source: parent,
    origin: "https://panel.streamlit.app",
    data: { type: "streamlit:render", args: { channel: pull.channel, operator: pull.operator } },
  });
  const value = {
    type: "SG_CHROME_DATA",
    channel: pull.channel,
    operator: pull.operator,
    ok: true,
    snapshot: {
      id: "fixture",
      count: 1,
      capturedAt: new Date().toISOString(),
      sourceOrigin: "https://backoffice.test",
    },
  };
  for (const data of [
    { ...value, channel: "wrong" },
    { ...value, operator: "other" },
  ])
    callbacks.message({ source: window, origin: context.location.origin, data });
  callbacks.message({ source: window, origin: "https://evil.test", data: value });
  assert.equal(sent.filter((entry) => entry.type === "streamlit:setComponentValue").length, 0);
  for (let i = 0; i < 2; i++)
    callbacks.message({ source: window, origin: context.location.origin, data: value });
  assert.equal(sent.filter((entry) => entry.type === "streamlit:setComponentValue").length, 1);
  callbacks.message({
    source: window,
    origin: context.location.origin,
    data: { ...value, requestId: "manual-refresh" },
  });
  assert.equal(sent.filter((entry) => entry.type === "streamlit:setComponentValue").length, 2);
  const fresh = {
    ...value,
    snapshot: {
      ...value.snapshot,
      captureId: "another-read",
      capturedAt: new Date(Date.now() + 1).toISOString(),
    },
  };
  callbacks.message({ source: window, origin: context.location.origin, data: fresh });
  callbacks.message({ source: window, origin: context.location.origin, data: fresh });
  assert.equal(sent.filter((entry) => entry.type === "streamlit:setComponentValue").length, 3);
});

test("navigating away from the bound Backoffice page blocks capture and hides cached data", async () => {
  const configured = settings();
  configured.source.pathname = "/another-screen";
  const runtime = await worker(configured);
  runtime.session["scoreguard-snapshot"] = { text: "previous-data" };
  const failed = await runtime.handle({ ...pull, refresh: true }, bridge);
  assert.match(failed.error, /tab je promenjen/);
  assert.equal(failed.snapshot, null);
  assert.match((await runtime.handle(pull, bridge)).error, /tab je promenjen/);
  assert.equal(runtime.reads(), 0);
});

test("nested copies and subset tables identify one complete match list", () => {
  const second = [...fields];
  second[2] = "72500";
  const result = capture([table([fields, second]), table(), table([fields, second])]);
  assert.equal(result.count, 2);
  assert.equal(result.diagnostics.candidates, 2);
});
test("visible copies with conflicting scores remain ambiguous", () => {
  const conflicting = [...fields];
  conflicting[8] = "1";
  assert.throws(() => capture([table(), table([conflicting])]), /više tabela/);
});
test("grid components and a leading selection column preserve the documented format", () => {
  const grid = table([["", ...fields]]);
  grid.tagName = "DIV";
  const result = capture([grid]);
  assert.equal(result.diagnostics.grids, 1);
  assert.equal(result.text, fields.slice(0, 12).join("\t"));
});
test("ARIA grid cells are restored to column order", () => {
  const cells = fields
    .map((innerText, index) => ({
      innerText,
      getAttribute: () => String(index + 1),
    }))
    .reverse();
  const grid = {
    tagName: "DIV",
    querySelectorAll: () => [
      {
        getClientRects: () => [{}],
        querySelectorAll: () => cells,
      },
    ],
  };
  assert.equal(capture([grid]).text, fields.slice(0, 12).join("\t"));
});
test("same-origin loaded frames and open shadow roots need no additional requests", () => {
  const gridDocument = {
    querySelectorAll: (selector) =>
      selector === "*" || selector === "iframe, frame" ? [] : [table()],
  };
  for (const useFrame of [true, false]) {
    const document = {
      querySelectorAll: (selector) =>
        selector === "iframe, frame"
          ? useFrame
            ? [{ tagName: "IFRAME", contentDocument: gridDocument }]
            : []
          : selector === "*"
            ? useFrame
              ? []
              : [{ shadowRoot: gridDocument }]
            : [],
    };
    const result = vm.runInNewContext("(" + captureSnapshot.toString() + ")()", { document });
    assert.equal(result.count, 1);
    assert.equal(result.diagnostics.documents, useFrame ? 2 : 1);
    assert.equal(result.diagnostics.shadowRoots, useFrame ? 0 : 1);
  }
});
test("unavailable frames produce a structured error with counts only", () => {
  const document = {
    querySelectorAll: (selector) =>
      selector === "iframe, frame"
        ? [
            {
              tagName: "IFRAME",
              get contentDocument() {
                throw Error("cross-origin");
              },
            },
          ]
        : [],
  };
  const result = vm.runInNewContext("(" + captureSnapshot.toString() + ")('',true)", { document });
  assert.match(result.error, /okvir/);
  assert.equal(result.diagnostics.inaccessibleFrames, 1);
  assert.equal(result.text, undefined);
});
test("injected extraction failures survive Chrome serialization", async () => {
  const failure = capture(
    [table([["F", "private league", "bad-id", "private home", "private away", "sre 20:00"]])],
    "",
    true,
  );
  assert.match(failure.error, /očekivane kolone/);
  assert.equal(failure.text, undefined);
  assert.doesNotMatch(JSON.stringify(failure), /private (league|home|away)/);
  const runtime = await worker(settings(), failure);
  await assert.rejects(runtime.handle({ type: "capture" }, popup), /očekivane kolone/);
  const state = await runtime.handle({ type: "state" }, popup);
  assert.equal(state.error, failure.error);
  assert.equal(state.diagnostics.footballRows, 1);
  assert.equal(runtime.session["scoreguard-snapshot"], undefined);
});
test("extraction errors do not return a previously cached snapshot", async () => {
  const runtime = await worker(settings(), capture([], "", true));
  runtime.session["scoreguard-snapshot"] = { text: "old data" };
  const failed = await runtime.handle({ ...pull, refresh: true }, bridge);
  assert.match(failed.error, /Nema prepoznatih/);
  assert.equal(failed.snapshot, null);
  assert.match((await runtime.handle(pull, bridge)).error, /Nema prepoznatih/);
});

function loadedGridPage(toolbarCount = 80) {
  const visited = [];
  const empty = () => ({
    querySelectorAll: () => {
      visited.push("toolbar");
      return [];
    },
  });
  const toolbar = Array.from({ length: toolbarCount }, () => ({ shadowRoot: empty() }));
  const gridDocument = {
    querySelectorAll: (selector) => {
      visited.push("grid");
      return selector === "*" || selector === "iframe, frame" || selector === "#matches"
        ? []
        : [table()];
    },
  };
  const grid = { tagName: "VAADIN-GRID", shadowRoot: gridDocument, querySelectorAll: () => [] };
  const document = {
    querySelectorAll: (selector) =>
      selector === "*" ? [...toolbar, grid] : selector === "iframe, frame" ? [] : [grid],
  };
  return { document, visited };
}
test("a grid remains readable after more than twenty unrelated shadow components", () => {
  const { document, visited } = loadedGridPage();
  const result = vm.runInNewContext("(" + captureSnapshot.toString() + ")()", { document });
  assert.equal(result.count, 1);
  assert.equal(result.diagnostics.documents, 1);
  assert.equal(result.diagnostics.shadowRoots, 81);
  assert.equal(result.diagnostics.traversalLimited, false);
  assert.ok(visited.indexOf("grid") < visited.indexOf("toolbar"));
});
test("a selected grid host reads its internal table and skips unrelated shadow components", () => {
  const { document } = loadedGridPage(2100);
  const result = vm.runInNewContext("(" + captureSnapshot.toString() + ")('#matches')", {
    document,
  });
  assert.equal(result.count, 1);
  assert.equal(result.diagnostics.shadowRoots, 1);
  assert.equal(result.diagnostics.traversalLimited, false);
});
test("reaching the traversal limit returns an error instead of an incomplete list", () => {
  const { document } = loadedGridPage(2100);
  const result = vm.runInNewContext("(" + captureSnapshot.toString() + ")('',true)", { document });
  assert.equal(result.text, undefined);
  assert.equal(result.diagnostics.traversalLimited, true);
  assert.match(result.error, /potpun pregled/);
});
test("slotted football cells produce the native import format without reading form values", () => {
  const cells = fields.map((value) => {
    const privateInput = {
      tagName: "INPUT",
      get value() {
        throw Error("form value must not be read");
      },
      textContent: "secret-form-value",
    };
    const content = {
      tagName: "VAADIN-GRID-CELL-CONTENT",
      childNodes: [{ nodeType: 3, nodeValue: value }, privateInput],
    };
    const slot = { tagName: "SLOT", assignedNodes: () => [content] };
    return { innerText: "", childNodes: [slot], querySelectorAll: () => [slot] };
  });
  const grid = {
    tagName: "DIV",
    querySelectorAll: () => [{ getClientRects: () => [{}], querySelectorAll: () => cells }],
  };
  const result = capture([grid]);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.rows[0].internalId, "72499");
  assert.equal(imported.rows[0].score, "0:0");
  assert.ok(result.diagnostics.slottedCells >= 12);
  assert.doesNotMatch(result.text, /secret-form-value/);
});

test("seventeen virtualized Vaadin rows use displayed CSS column order instead of recycled DOM order", () => {
  const order = [0, 6, 7, 8, 1, 3, 2, 5, 4, 9, 10, 11, 12];
  const rows = Array.from({ length: 17 }, (_, index) => {
    const values = [...fields];
    values[2] = String(72499 + index);
    const cells = values.map((value, column) => slottedCell(value, column));
    return cellGrid(order.map((index) => cells[index])).querySelectorAll()[0];
  });
  const grid = { tagName: "TABLE", querySelectorAll: () => rows };
  const result = capture([grid]);
  assert.equal(result.count, 17);
  assert.equal(result.diagnostics.footballRows, 17);
  assert.equal(result.diagnostics.cssOrderedRows, 17);
  assert.equal(result.diagnostics.malformedRows, 0);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.rows[0].internalId, "72499");
  assert.equal(imported.rows[16].internalId, "72515");
  assert.equal(imported.rows[16].match, "Zamora – Atletico Barinas");
  assert.equal(imported.rows[16].time, "21:30");
  assert.equal(imported.rows[16].score, "0:0");
});

test("a flex grid's displayed CSS order takes precedence over stale ARIA indexes", () => {
  const order = [0, 6, 7, 8, 1, 3, 2, 5, 4, 9, 10, 11, 12];
  const cells = fields.map((value, index) => slottedCell(value, index));
  const recycled = order.map((index, position) => ({
    ...cells[index],
    getAttribute: () => String(position + 1),
  }));
  assert.equal(capture([cellGrid(recycled)]).text, fields.slice(0, 12).join("\t"));
});

test("slotted inline fragments preserve codes, scores and clock digits without invented spaces", () => {
  const cells = fields.map((value, index) => slottedCell(value, index));
  const span = (text) => ({ tagName: "SPAN", childNodes: [{ nodeType: 3, nodeValue: text }] });
  cells[2] = slottedCell([span("72"), span("499")], 2);
  cells[5] = slottedCell([span("sre"), span("21"), span(":"), span("30")], 5);
  cells[7] = slottedCell([span("1"), span("0")], 7);
  const result = capture([cellGrid(cells)]);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.rows[0].internalId, "72499");
  assert.equal(imported.rows[0].time, "21:30");
  assert.equal(imported.rows[0].score, "10:0");
});

test("rendered slotted text preserves the actual visible clock instead of hidden renderer markup", () => {
  const cells = fields.map((value, index) => slottedCell(value, index));
  cells[5] = slottedCell("private-renderer-markup", 5, { innerText: "sre 21:30" });
  const result = capture([cellGrid(cells)]);
  assert.equal(result.text, fields.slice(0, 12).join("\t"));
  assert.doesNotMatch(result.text, /private-renderer/);
});

test("hidden helper columns and blank prefix cells do not shift or fill missing score columns", () => {
  const values = [fields[0], "", ...fields.slice(1)];
  values[9] = ""; // The away score is absent and must remain absent.
  const cells = values.map((value, index) => slottedCell(value, index));
  cells.splice(
    3,
    0,
    slottedCell("private-helper", -1, { style: { order: "-1", display: "none" } }),
  );
  const result = capture([cellGrid(cells)]);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.rows[0].internalId, "72499");
  assert.equal(imported.rows[0].score, null);
  assert.equal(imported.rows[0].ht, "0:0");
  assert.equal(result.diagnostics.hiddenCells, 1);
  assert.doesNotMatch(result.text, /private-helper/);
});

test("an invalid row blocks the whole capture and diagnostics reveal only numeric failure counts", () => {
  const values = Array.from({ length: 17 }, (_, index) => [
    ...fields.slice(0, 2),
    String(72499 + index),
    ...fields.slice(3),
  ]);
  values[10][2] = "private-broken-code";
  const result = capture([table(values)], "", true);
  assert.match(result.error, /očekivane kolone/);
  assert.equal(result.text, undefined);
  assert.equal(result.diagnostics.footballRows, 17);
  assert.equal(result.diagnostics.malformedRows, 1);
  assert.equal(result.diagnostics.invalidCode, 1);
  assert.equal(result.diagnostics.invalidTime, 0);
  assert.doesNotMatch(JSON.stringify(result), /private-broken-code|Zamora|Barinas|Venecuela/);
});

test("a real table row ignores ineffective CSS order and uses complete ARIA column indexes", () => {
  const cells = fields
    .map((value, index) =>
      slottedCell(value, fields.length - index, {
        getAttribute: () => String(index + 1),
      }),
    )
    .reverse();
  const result = capture([cellGrid(cells, "table-row")]);
  assert.equal(result.text, fields.slice(0, 12).join("\t"));
  assert.equal(result.diagnostics.cssOrderedRows, 0);
  assert.equal(result.diagnostics.ariaOrderedRows, 1);
});

test("a missing or invalid kickoff cannot be replaced by a halftime score that looks like a clock", () => {
  for (const time of ["", "25:00"]) {
    const values = [...fields];
    values[5] = time;
    values[7] = "12";
    values[9] = "12:00";
    const result = capture([table([values])], "", true);
    assert.equal(result.text, undefined);
    assert.equal(result.diagnostics.invalidTime, 1);
  }
});

test("extension version, relay and Streamlit component cache identifiers are released together", () => {
  const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const version = JSON.parse(read("chrome_extension/manifest.json")).version;
  assert.ok(read("chrome_extension/popup.html").includes("v" + version));
  assert.ok(read("chrome_extension/popup.mjs").includes("Verzija: " + version));
  assert.ok(read("chrome_extension/relay.js").includes('relayVersion: "' + version + '"'));
  assert.ok(
    read("streamlit_panel/chrome_component/bridge.js").includes(
      'relayVersion === "' + version + '"',
    ),
  );
  assert.ok(read("streamlit_panel/chrome_component/index.html").includes("bridge.js?v=" + version));
  const component = read("streamlit_panel/chrome_import.py"),
    suffix = version.replaceAll(".", "");
  assert.ok(component.includes("scoreguard_chrome_bridge_v" + suffix));
  assert.ok(component.includes("scoreguard_chrome_receiver_v" + suffix));
});

test("Score 2 header imports all thirteen supplied halftime examples from split rendered scores", () => {
  const samples = [
    ["2:1", "2:1", "Pause", ""],
    ["2:1", "2:0", "2nd half", "74'"],
    ["1:2", "1:2", "2nd half", "37'"],
    ["1:0", "1:0", "2nd half", "19'"],
    ["0:1", "0:1", "2nd half", "32'"],
    ["0:2", "0:2", "2nd half", "28'"],
    ["0:6", "0:5", "2nd half", "46'"],
    ["1:1", "1:1", "2nd half", "45'"],
    ["0:0", "0:0", "2nd half", ""],
    ["0:0", "0:0", "2nd half", ""],
    ["1:2", "1:2", "Pause", "32'"],
    ["1:4", "1:4", "Pause", "43'"],
    ["0:1", "0:1", "Pause", "41'"],
  ];
  const labels = [
    "Sport",
    "League",
    "Code",
    "Home",
    "Away",
    "Time",
    "Score",
    "Home",
    "Away",
    "",
    "",
    "Score 2",
    "Min",
    "Phase",
    ...Array(8).fill(""),
  ];
  const header = cellGrid(
    labels.map((label, index) => slottedCell(label, index, { tagName: "TH" })),
  ).querySelectorAll()[0];
  const rows = samples.map(([current, halftime, phase, minute], index) => {
    const values = [
      ...fields.slice(0, 9),
      "private-auxiliary",
      "",
      halftime,
      minute,
      phase,
      ...Array(8).fill(""),
    ];
    values[2] = String(72499 + index);
    [values[7], values[8]] = current.split(":");
    const cells = values.map((value, column) => slottedCell(value, column));
    const parts = halftime
      .split(":")
      .map((text) => ({ tagName: "SPAN", childNodes: [{ nodeType: 3, nodeValue: text }] }));
    parts.splice(1, 0, { tagName: "SPAN", childNodes: [] }); // CSS paints the colon.
    cells[11] = slottedCell(parts, 11, { innerText: halftime.replace(":", "") });
    return cellGrid([...cells].reverse()).querySelectorAll()[0];
  });
  const result = capture([{ tagName: "TABLE", querySelectorAll: () => [header, ...rows] }]);
  assert.equal(result.count, 13);
  assert.equal(result.diagnostics.halftimeRead, 13);
  assert.equal(result.diagnostics.halftimeUnreadable, 0);
  assert.equal(result.diagnostics.score2Headers, 1);
  assert.doesNotMatch(result.text, /private-auxiliary/);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  for (const [index, [current, halftime, phase, minute]] of samples.entries()) {
    assert.equal(imported.rows[index].score, current);
    assert.equal(imported.rows[index].ht, halftime);
    assert.equal(
      imported.rows[index].expectedStatus,
      phase === "Pause" ? "half_time" : "second_half",
    );
    assert.equal(imported.rows[index].native.minute, minute);
  }
});

test("Score 2 supports explicit separators and two spaced values without changing current scores", () => {
  for (const [text, halftime] of [
    ["2:0", "2:0"],
    ["2 0", "2:0"],
    ["2\n0", "2:0"],
    ["2∶0", "2:0"],
    ["2：0", "2:0"],
    ["0:0", "0:0"],
    ["10 - 5", "10:5"],
  ]) {
    const values = [...fields];
    values[7] = "12";
    values[8] = "12";
    values[9] = text;
    const result = capture([table([values])]);
    const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
      baseDate: "2026-11-11",
    });
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.rows[0].score, "12:12");
    assert.equal(imported.rows[0].ht, halftime);
  }
});

test("empty Score 2 cannot take a score from Min or another neighboring column", () => {
  const values = [...fields];
  values[9] = "";
  values[10] = "1:1";
  const result = capture([table([values])]);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.rows[0].ht, null);
  assert.equal(result.diagnostics.halftimeMissing, 1);
});

test("unseparated Score 2 digits are not guessed and controls are never read as score values", () => {
  const cells = fields.map((value, index) => slottedCell(value, index));
  cells[9] = slottedCell("05", 9);
  let result = capture([cellGrid(cells)]);
  assert.equal(parseNativeClipboard(result.text).rows[0].colonScore, null);
  assert.equal(result.diagnostics.halftimeUnreadable, 1);
  const span = (value) => ({ tagName: "SPAN", childNodes: [{ nodeType: 3, nodeValue: value }] });
  const input = {
    tagName: "INPUT",
    textContent: "private-value",
    get value() {
      throw Error("input value accessed");
    },
  };
  cells[9] = slottedCell([span("0"), input, span("5")], 9, { innerText: "05" });
  result = capture([cellGrid(cells)]);
  assert.equal(parseNativeClipboard(result.text).rows[0].colonScore, "0:5");
  assert.doesNotMatch(result.text, /private-value/);
});

test("default header CSS order cannot point Score 2 at the sport column of a flex body", () => {
  const labels = fields.map((_, index) => (index === 9 ? "Score 2" : ""));
  const header = cellGrid(
    labels.map((label) => slottedCell(label, 0, { tagName: "TH" })),
    "table-row",
  ).querySelectorAll()[0];
  const values = [...fields];
  values[7] = "2";
  values[8] = "1";
  values[9] = "2:0";
  const body = cellGrid(
    values.map((value, index) => slottedCell(value, index)),
  ).querySelectorAll()[0];
  const result = capture([{ tagName: "TABLE", querySelectorAll: () => [header, body] }]);
  assert.equal(parseNativeClipboard(result.text).rows[0].colonScore, "2:0");
  assert.equal(result.diagnostics.halftimeRead, 1);
});

test("conflicting Score 2 headers leave halftime unknown instead of selecting a different column", () => {
  const labels = fields.map((_, index) => ([9, 10].includes(index) ? "Score 2" : ""));
  const header = cellGrid(
    labels.map((label, index) => slottedCell(label, index, { tagName: "TH" })),
  ).querySelectorAll()[0];
  const values = [...fields];
  values[9] = "0:0";
  values[10] = "0:1";
  const body = cellGrid(
    values.map((value, index) => slottedCell(value, index)),
  ).querySelectorAll()[0];
  const result = capture([{ tagName: "TABLE", querySelectorAll: () => [header, body] }]);
  assert.equal(parseNativeClipboard(result.text).rows[0].colonScore, null);
  assert.equal(result.diagnostics.halftimeUnreadable, 1);
});

test("the supplied Lit Score 2 cell ignores comment markers and imports every displayed halftime", () => {
  const comment = (text) => ({ nodeType: 8, nodeValue: text, textContent: text });
  const text = (value) => ({ nodeType: 3, nodeValue: value, textContent: value });
  const marker = "?lit$705630163$";
  const samples = [
    ["2", "1"],
    ["0", "5"],
    ["0", "0"],
    ["10", "2"],
  ];
  const labels = fields.map((_, index) => (index === 9 ? "Score 2" : ""));
  const header = cellGrid(
    labels.map((label, index) => slottedCell(label, index, { tagName: "TH" })),
  ).querySelectorAll()[0];
  const rows = Array.from({ length: 12 }, (_, index) => {
    const [home, away] = samples[index % samples.length];
    const values = [...fields];
    values[2] = String(72499 + index);
    values[7] = "10";
    values[8] = "6";
    const cells = values.map((value, column) => slottedCell(value, column));
    // Exact children of the supplied vaadin-grid-cell-content, including Lit comments.
    cells[9] = slottedCell(
      [
        comment(""),
        {
          nodeType: 1,
          tagName: "SPAN",
          style: { fontWeight: "bold" },
          childNodes: [comment(marker), text(home)],
        },
        text(":"),
        {
          nodeType: 1,
          tagName: "SPAN",
          style: { fontWeight: "normal" },
          childNodes: [comment(marker), text(away)],
        },
      ],
      9,
    );
    return cellGrid(cells).querySelectorAll()[0];
  });
  const result = capture([{ tagName: "TABLE", querySelectorAll: () => [header, ...rows] }]);
  assert.equal(result.diagnostics.score2Headers, 1);
  assert.equal(result.diagnostics.halftimeRead, 12);
  assert.equal(result.diagnostics.halftimeUnreadable, 0);
  assert.doesNotMatch(result.text, /lit\$705630163/);
  const imported = mapNativeClipboard(parseNativeClipboard(result.text), {
    baseDate: "2026-11-11",
  });
  assert.deepEqual(imported.errors, []);
  for (const [index, match] of imported.rows.entries())
    assert.equal(match.ht, samples[index % samples.length].join(":"));
});

test("an invisible comment containing a score cannot supply a missing halftime", () => {
  const cells = fields.map((value, index) => slottedCell(value, index));
  cells[9] = slottedCell([{ nodeType: 8, nodeValue: "0:0", textContent: "0:0" }], 9);
  const result = capture([cellGrid(cells)]);
  assert.equal(result.diagnostics.halftimeMissing, 1);
  assert.equal(parseNativeClipboard(result.text).rows[0].colonScore, null);
});

test("opening status restores a missing alarm without postponing an existing deadline", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const runtime = await worker({ ...settings(), automatic: true });
  await runtime.handle({ type: "capture" }, popup);
  const due = runtime.alarms.at(-1).scheduledTime;
  runtime.activeAlarms.clear();
  now += 60000;
  const recovered = await runtime.handle({ type: "state" }, popup);
  assert.equal(Date.parse(recovered.status.nextReadAt), due);
  const created = runtime.alarms.length;
  for (let i = 0; i < 6; i++) {
    now += 30000;
    await runtime.handle(pull, bridge);
  }
  assert.equal(runtime.alarms.length, created);
  assert.equal(runtime.reads(), 1);
  assert.equal(runtime.alarms.at(-1).scheduledTime, due);
});
test("bridge polling recovers a missed timer once and gives identical content a new capture ID", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const runtime = await worker({ ...settings(), automatic: true });
  const first = await runtime.handle(pull, bridge);
  now += 299999;
  await runtime.handle(pull, bridge);
  assert.equal(runtime.reads(), 1);
  now += 1;
  const second = await runtime.handle(pull, bridge);
  assert.equal(runtime.reads(), 2);
  assert.equal(second.snapshot.id, first.snapshot.id);
  assert.notEqual(second.snapshot.captureId, first.snapshot.captureId);
  assert.notEqual(second.snapshot.capturedAt, first.snapshot.capturedAt);
  await runtime.events.alarm({ name: "scoreguard-passive-capture" });
  assert.equal(runtime.reads(), 2);
  assert.equal(Date.parse(second.status.nextReadAt), now + 300000);
});
test("a failed scheduled read is reported and does not retry on every bridge poll", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const runtime = await worker({ ...settings(), automatic: true }, capture([], "", true));
  const failed = await runtime.handle(pull, bridge);
  assert.match(failed.error, /Nema prepoznatih/);
  assert.equal(failed.snapshot, null);
  now += 3000;
  await runtime.handle(pull, bridge);
  assert.equal(runtime.reads(), 1);
  now += 297000;
  await runtime.handle(pull, bridge);
  assert.equal(runtime.reads(), 2);
});
test("installing or restarting the extension repairs scheduling without resetting its settings", async () => {
  const runtime = await worker({ ...settings(), automatic: true });
  await runtime.events.installed();
  assert.equal(runtime.activeAlarms.size, 1);
  const due = runtime.alarms.at(-1).scheduledTime;
  await runtime.events.start();
  assert.equal(runtime.alarms.at(-1).scheduledTime, due);
  assert.equal(runtime.local["scoreguard-config"].automatic, true);
});
test("rebinding replaces an existing relay listener instead of retaining an invalidated context", () => {
  const listeners = new Set();
  const window = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const context = vm.createContext({
    window,
    location: { pathname: "/component/scoreguard_chrome_bridge_v013/index.html" },
  });
  const code = fs.readFileSync(new URL("../chrome_extension/relay.js", import.meta.url), "utf8");
  vm.runInContext(code, context);
  vm.runInContext(code, context);
  assert.equal(listeners.size, 1);
});
