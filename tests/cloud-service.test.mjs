import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAccount } from "../auth/core.mjs";
import { startCloudService } from "../cloud_runtime/server.mjs";

const password = "Cloud-service-test-password-only-123!";
const accounts = {
  version: 1,
  accounts: [
    await createAccount({ username: "stefan", name: "Stefan", role: "admin", password }),
    await createAccount({ username: "milos", name: "Milos", password }),
  ],
};
const watch = {
  date: "2026-11-11",
  sources: ["flash"],
  enabled: false,
  matches: [
    {
      id: "one",
      sport: "Fudbal",
      time: "21:30",
      league: "Venecuela Kup",
      match: "Zamora – Atletico Barinas",
      ht: "0:0",
      score: "1:0",
    },
  ],
};
const collector = {
  async collect(config) {
    return {
      results: config.matches.map((m) => ({
        id: m.id,
        refs: {
          flash: {
            state: "verified",
            score: "1:0",
            ht: "0:0",
            checkedAt: new Date().toISOString(),
          },
        },
      })),
      health: { flash: { state: "available", message: "Controlled test source" } },
      checkedAt: new Date().toISOString(),
    };
  },
};
function api(runtime) {
  return (route, { cookie, body, method = body ? "POST" : "GET", origin = runtime.origin } = {}) =>
    fetch(runtime.baseUrl + route, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
}
async function signIn(call, username) {
  const r = await call("/api/auth/login", { body: { username, password } });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}

test("Cloud service binds loopback, compares manually, isolates operators and restores same-instance data", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-cloud-service-"));
  let runtime;
  try {
    runtime = await startCloudService({ directory, accounts, collector });
    const call = api(runtime);
    assert.equal(runtime.server.address().address, "127.0.0.1");
    assert.equal((await (await call("/healthz")).json()).intervalSeconds, 300);
    assert.equal((await call("/api/monitor")).status, 401);
    const stefan = await signIn(call, "Stefan"),
      milos = await signIn(call, "milos");
    assert.equal(
      (
        await call("/api/auth/login", {
          origin: "https://foreign.test",
          body: { username: "stefan", password },
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/watch", { cookie: stefan, method: "PUT", body: watch })).status,
      200,
    );
    const result = await (await call("/api/compare", { cookie: stefan, body: watch })).json();
    assert.equal(result.trigger, "manual");
    assert.equal(result.results[0].refs.flash.state, "verified");
    assert.equal((await (await call("/api/monitor", { cookie: milos })).json()).monitor, null);
    assert.equal(
      (
        await call("/api/review", {
          cookie: stefan,
          body: { matchId: "one", note: "Cloud test review" },
        })
      ).status,
      200,
    );
    assert.equal(
      (await call("/downloads/ScoreGuard-streamlit-v0.6.zip", { cookie: stefan })).status,
      404,
    );
    await runtime.close();
    runtime = await startCloudService({ directory, accounts, collector });
    const restored = await (await api(runtime)("/api/monitor", { cookie: stefan })).json();
    assert.equal(restored.monitor.watch.matches[0].match, "Zamora – Atletico Barinas");
    assert.equal(restored.monitor.reviews.one.note, "Cloud test review");
    assert.equal(restored.monitor.lastResult.trigger, "manual");
  } finally {
    if (runtime) await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Cloud scheduler runs without panel requests and keeps the five-minute interval", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-cloud-schedule-"));
  let runtime;
  try {
    runtime = await startCloudService({ directory, accounts, collector });
    let now = Date.now();
    runtime.monitor.clock = () => now;
    await runtime.monitor.configure("operator-stefan", watch, { enabled: true });
    const until = async (predicate) => {
      const deadline = Date.now() + 3500;
      while (!predicate() && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 40));
      assert.ok(predicate());
    };
    await until(() => runtime.monitor.snapshot("operator-stefan").checks.length === 1);
    assert.equal(runtime.monitor.snapshot("operator-stefan").lastResult.trigger, "scheduled");
    assert.equal(Date.parse(runtime.monitor.snapshot("operator-stefan").nextCheckAt) - now, 300000);
    now += 300000;
    await until(() => runtime.monitor.snapshot("operator-stefan").checks.length === 2);
  } finally {
    if (runtime) await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Cloud comparisons use a 90-second request budget and leave other API requests responsive", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-cloud-request-budget-"));
  let runtime, pending, release, notify;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (notify = resolve));
  const slowCollector = {
    async collect(config) {
      notify();
      await gate;
      return collector.collect(config);
    },
  };
  try {
    runtime = await startCloudService({ directory, accounts, collector: slowCollector });
    assert.equal(runtime.server.requestTimeout, 90000);
    assert.equal(runtime.server.headersTimeout, 10000);
    const call = api(runtime),
      cookie = await signIn(call, "Stefan");
    pending = call("/api/compare", { cookie, body: watch });
    await started;
    assert.equal((await call("/healthz")).status, 200);
    assert.equal((await call("/api/monitor", { cookie })).status, 200);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).results[0].refs.flash.state, "verified");
  } finally {
    release();
    if (pending) await pending;
    if (runtime) await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
