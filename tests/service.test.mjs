import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Monitor, FileStore } from "../service/monitor.mjs";
import { createService, REQUEST_TIMEOUT_MS } from "../service/server.mjs";
const watch = {
  date: "2026-11-09",
  sources: ["flash"],
  matches: [
    {
      id: "1",
      sport: "Fudbal",
      time: "20:00",
      league: "League",
      match: "A – B",
      ht: "0:0",
      score: "1:0",
    },
  ],
};
function setup() {
  let now = 1000000,
    calls = 0;
  const store = {
    data: {},
    async load() {
      return structuredClone(this.data);
    },
    async save(data) {
      this.data = structuredClone(data);
    },
  };
  const collector = {
    async collect() {
      calls++;
      return { checkedAt: new Date(now).toISOString(), results: [], health: {} };
    },
  };
  const monitor = new Monitor({ collector, store, clock: () => now });
  return {
    monitor,
    collector,
    store,
    advance: (n) => (now += n),
    calls: () => calls,
    capture: (id, automatic = true) => ({ id, capturedAt: new Date(now).toISOString(), automatic }),
  };
}
test("five-minute scheduler, immediate manual checks and pause", async () => {
  const { monitor, advance, calls } = setup();
  await monitor.init();
  await monitor.configure("operator1", watch);
  await monitor.tick();
  assert.equal(calls(), 1);
  advance(299999);
  await monitor.tick();
  assert.equal(calls(), 1);
  advance(1);
  await monitor.tick();
  assert.equal(calls(), 2);
  await monitor.check("operator1");
  assert.equal(calls(), 3);
  await monitor.pause("operator1");
  advance(600000);
  await monitor.tick();
  assert.equal(calls(), 3);
});
test("overlapping timer/manual checks use one in-flight collection", async () => {
  const { monitor, collector } = setup();
  let resolve,
    calls = 0;
  collector.collect = () => {
    calls++;
    return new Promise((r) => (resolve = r));
  };
  await monitor.init();
  await monitor.configure("op", watch);
  const a = monitor.check("op"),
    b = monitor.check("op");
  assert.equal(a, b);
  assert.equal(calls, 1);
  resolve({ results: [], health: {} });
  await Promise.all([a, b]);
  assert.equal(monitor.snapshot("op").running, false);
});
test("replacing a watch discards the previous in-flight result", async () => {
  const { monitor, collector } = setup();
  let resolve;
  collector.collect = () => new Promise((r) => (resolve = r));
  await monitor.init();
  await monitor.configure("op", watch);
  const pending = monitor.check("op");
  await monitor.configure("op", { ...watch, matches: [{ ...watch.matches[0], score: "2:0" }] });
  resolve({ results: [{ id: "1", refs: { flash: { score: "1:0" } } }], health: {} });
  assert.equal((await pending).discarded, true);
  assert.equal(monitor.snapshot("op").lastResult, null);
});
test("file persistence restores the list and next scheduled run after restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sg-test-"));
  try {
    let now = 1000000;
    const store = new FileStore(dir);
    const collector = {
      async collect() {
        return { results: [], health: {}, checkedAt: new Date(now).toISOString() };
      },
    };
    const a = new Monitor({ store, collector, clock: () => now });
    await a.init();
    await a.configure("op", watch);
    await a.check("op");
    const b = new Monitor({ store: new FileStore(dir), collector, clock: () => now });
    await b.init();
    assert.equal(b.snapshot("op").watch.matches.length, 1);
    assert.equal(b.snapshot("op").running, false);
    now += 300000;
    await b.tick();
    assert.equal(b.snapshot("op").checks.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("HTTP service rejects missing token and isolates operator lists", async () => {
  const { monitor } = setup();
  await monitor.init();
  const token = "test-token-only-not-a-real-secret-000000";
  const server = createService({ monitor, token });
  assert.equal(REQUEST_TIMEOUT_MS, 90000);
  assert.equal(server.requestTimeout, 90000);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(base + "/v1/state?operator=op")).status, 401);
    const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const saved = await fetch(base + "/v1/watch?operator=op1", {
      method: "PUT",
      headers,
      body: JSON.stringify(watch),
    });
    assert.equal(saved.status, 200);
    const other = await fetch(base + "/v1/state?operator=op2", { headers });
    assert.equal((await other.json()).monitor, null);
    const manual = await fetch(base + "/v1/check?operator=op1", { method: "POST", headers });
    assert.equal(manual.status, 200);
    assert.equal((await manual.json()).operator, "op1");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("refreshing an unchanged imported list preserves references and the scheduled source check", async () => {
  const { monitor, advance, collector } = setup();
  collector.collect = async () => ({
    checkedAt: new Date(1000000).toISOString(),
    results: [
      {
        id: "1",
        refs: {
          flash: {
            state: "verified",
            score: "1:0",
            ht: "0:0",
            checkedAt: new Date(1000000).toISOString(),
          },
        },
      },
    ],
    health: {},
  });
  await monitor.init();
  await monitor.configure("op", watch, { imported: true });
  await monitor.check("op");
  const before = monitor.snapshot("op"),
    generation = monitor.watches.op.generation;
  advance(300000);
  const after = await monitor.configure("op", before.watch, { enabled: true, imported: true });
  assert.notEqual(after.importedAt, before.importedAt);
  assert.deepEqual(after.lastResult, before.lastResult);
  assert.equal(after.lastResult.results[0].refs.flash.score, "1:0");
  assert.equal(
    after.lastResult.results[0].refs.flash.checkedAt,
    before.lastResult.results[0].refs.flash.checkedAt,
  );
  assert.equal(after.nextCheckAt, before.nextCheckAt);
  assert.equal(after.revision, before.revision);
  assert.equal(monitor.watches.op.generation, generation);
});
test("an unchanged imported refresh does not discard a source check already in flight", async () => {
  const { monitor, collector, advance } = setup();
  let release;
  collector.collect = () => new Promise((resolve) => (release = resolve));
  await monitor.init();
  await monitor.configure("op", watch, { imported: true });
  const pending = monitor.check("op");
  const before = monitor.snapshot("op");
  advance(1000);
  const refreshed = await monitor.configure("op", before.watch, { enabled: true, imported: true });
  assert.equal(refreshed.running, true);
  const result = {
    checkedAt: new Date().toISOString(),
    results: [{ id: "1", refs: { flash: { state: "verified", score: "1:0", ht: "0:0" } } }],
    health: {},
  };
  release(result);
  const completed = await pending;
  assert.notEqual(completed.discarded, true);
  assert.deepEqual(monitor.snapshot("op").lastResult.results, result.results);
  assert.equal(monitor.snapshot("op").lastResult.operator, "op");
  assert.equal(monitor.snapshot("op").importedAt, refreshed.importedAt);
});

test("Chrome reads drive source checks even for unchanged scores without a second timer", async () => {
  const { monitor, capture, advance, calls } = setup();
  await monitor.init();
  await monitor.configure("op", watch, { imported: true, chromeCapture: capture("first") });
  assert.equal(monitor.snapshot("op").syncWithImport, true);
  await monitor.tick();
  assert.equal(calls(), 1);
  assert.equal(monitor.snapshot("op").lastResult.trigger, "import");
  assert.equal(monitor.snapshot("op").nextCheckAt, null);
  advance(300000);
  await monitor.tick();
  assert.equal(calls(), 1, "sources wait for the new internal snapshot");
  const read = capture("second");
  await monitor.configure("op", watch, { imported: true, chromeCapture: read });
  assert.equal(monitor.snapshot("op").lastResult, null);
  assert.equal(monitor.snapshot("op").importedAt, read.capturedAt);
  await monitor.tick();
  assert.equal(calls(), 2);
  const before = monitor.snapshot("op");
  await monitor.configure("op", watch, {
    imported: true,
    chromeCapture: { ...read, capturedAt: read.capturedAt.replace("Z", "+00:00") },
  });
  await monitor.tick();
  assert.equal(calls(), 2, "a retried delivery does not repeat the source check");
  assert.deepEqual(monitor.snapshot("op"), before);
  await monitor.check("op");
  assert.equal(calls(), 3, "manual checks remain available between imports");
  assert.equal(monitor.snapshot("op").nextCheckAt, null);
});

test("a newer Chrome read discards an earlier check even when the scores have not changed", async () => {
  const { monitor, collector, capture, advance } = setup();
  const releases = [];
  collector.collect = () => new Promise((resolve) => releases.push(resolve));
  await monitor.init();
  await monitor.configure("op", watch, { imported: true, chromeCapture: capture("first") });
  const previous = monitor.check("op", { trigger: "import" });
  advance(1000);
  await monitor.configure("op", watch, { imported: true, chromeCapture: capture("second") });
  await monitor.tick();
  assert.equal(releases.length, 1, "only one collection runs per operator");
  releases[0]({ results: [{ id: "old" }], health: {} });
  assert.equal((await previous).discarded, true);
  assert.equal(monitor.snapshot("op").lastResult, null);
  const current = monitor.tick();
  assert.equal(releases.length, 2);
  releases[1]({ results: [{ id: "new" }], health: {} });
  await current;
  assert.equal(monitor.snapshot("op").lastResult.results[0].id, "new");
  assert.equal(monitor.snapshot("op").lastResult.trigger, "import");
  await monitor.tick();
  assert.equal(releases.length, 2);
});

test("Chrome imports preserve a paused monitor and a pasted import restores interval checks", async () => {
  const { monitor, capture, calls, advance } = setup();
  await monitor.init();
  await monitor.configure("op", watch, {
    enabled: false,
    imported: true,
    chromeCapture: capture("paused"),
  });
  await monitor.tick();
  assert.equal(calls(), 0);
  assert.equal(monitor.snapshot("op").enabled, false);
  await monitor.check("op");
  assert.equal(calls(), 1);
  assert.equal(monitor.snapshot("op").nextCheckAt, null);
  await monitor.configure("op", watch, { enabled: true });
  assert.equal(monitor.snapshot("op").syncWithImport, true);
  await monitor.tick();
  assert.equal(calls(), 2);
  await monitor.configure("op", watch, { imported: true });
  assert.equal(monitor.snapshot("op").syncWithImport, false);
  await monitor.tick();
  advance(300000);
  await monitor.tick();
  assert.equal(calls(), 4);
});

test("invalid and older Chrome captures cannot replace the current watch", async () => {
  const { monitor, capture, advance } = setup();
  await monitor.init();
  const first = capture("first");
  advance(1000);
  await monitor.configure("op", watch, { imported: true, chromeCapture: capture("current") });
  const before = monitor.snapshot("op");
  for (const chromeCapture of [
    first,
    { ...capture("bad"), id: "" },
    { ...capture("bad"), automatic: "yes" },
    { ...capture("bad"), capturedAt: "invalid" },
    { ...capture("bad"), capturedAt: new Date(advance(0) - 331000).toISOString() },
    { ...capture("bad"), capturedAt: new Date(advance(0) + 31000).toISOString() },
  ]) {
    await assert.rejects(
      monitor.configure(
        "op",
        {
          ...watch,
          matches: [{ ...watch.matches[0], score: "9:0" }],
        },
        { imported: true, chromeCapture },
      ),
    );
    assert.deepEqual(monitor.snapshot("op"), before);
  }
  await assert.rejects(monitor.configure("op", watch, { chromeCapture: capture("not-imported") }));
});

test("the import-driven schedule survives a service restart", async () => {
  const { monitor, store, collector, capture, advance, calls } = setup();
  await monitor.init();
  await monitor.configure("op", watch, {
    imported: true,
    chromeCapture: capture("before-restart"),
  });
  await monitor.tick();
  const restored = new Monitor({ store, collector, clock: () => advance(0) });
  await restored.init();
  advance(300000);
  await restored.tick();
  assert.equal(calls(), 1);
  assert.equal(restored.snapshot("op").syncWithImport, true);
  await restored.configure("op", watch, {
    imported: true,
    chromeCapture: capture("after-restart"),
  });
  await restored.tick();
  assert.equal(calls(), 2);
});
