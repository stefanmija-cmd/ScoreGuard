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
  return { monitor, collector, store, advance: (n) => (now += n), calls: () => calls };
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
