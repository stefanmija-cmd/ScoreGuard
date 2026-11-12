import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAccount } from "../auth/core.mjs";
import { createCollector } from "../scraper/collector.mjs";
import { startCloudService } from "../cloud_runtime/server.mjs";

test("operator API migrates source selection, archives old club links and compares newly fetched Futbol24 data", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-f24-api-")),
    at = new Date().toISOString(),
    password = "Futbol24-API-test-only-password-123!";
  let runtime;
  try {
    const accounts = {
      version: 1,
      accounts: [
        await createAccount({ username: "stefan", name: "Stefan", role: "admin", password }),
      ],
    };
    const match = {
      id: "one",
      internalId: "79672",
      sport: "Fudbal",
      time: "18:00",
      league: "Liga",
      match: "France U19 – Norway U19",
      score: "5:0",
      ht: "3:0",
    };
    const watch = { date: "2026-11-11", sources: ["sofa"], matches: [match] },
      ref = {
        state: "verified",
        score: "5:0",
        ht: "3:0",
        phase: "finished",
        eventState: "finished",
        checkedAt: at,
      };
    await fs.writeFile(
      path.join(directory, "monitor.json"),
      JSON.stringify({
        version: 1,
        watches: {
          "operator-stefan": {
            watch,
            revision: "legacy",
            enabled: false,
            nextCheckAt: null,
            checks: [],
            importedAt: at,
            lastResult: { checkedAt: at, results: [{ id: "one", refs: { sofa: ref } }] },
          },
        },
      }),
    );
    const link = {
      id: "old-source-link",
      source: "sofa",
      internalName: "France U19",
      sourceName: "France Youth",
    };
    await fs.writeFile(
      path.join(directory, "team-aliases.json"),
      JSON.stringify({
        version: 1,
        operators: { "operator-stefan": { links: [link], events: [] } },
      }),
    );
    const fixture = await fs.readFile(
      new URL("./fixtures/futbol24-finished.json", import.meta.url),
      "utf8",
    );
    const collector = createCollector({
      fetcher: async () =>
        new Response(fixture, { headers: { "Content-Type": "application/json" } }),
    });
    runtime = await startCloudService({ directory, accounts, collector });
    const call = (route, { cookie, body, method = body ? "POST" : "GET" } = {}) =>
      fetch(runtime.baseUrl + route, {
        method,
        headers: {
          Origin: runtime.origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const login = await call("/api/auth/login", { body: { username: "Stefan", password } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const initial = await (await call("/api/monitor", { cookie })).json();
    assert.deepEqual(initial.monitor.watch.sources, ["f24"]);
    assert.equal(initial.monitor.lastResult, null);
    assert.equal(initial.view.matches[0].comparisonStatus, "unverified");
    const aliases = await (await call("/api/team-aliases", { cookie })).json();
    assert.deepEqual(aliases.aliases, []);
    assert.equal(aliases.legacyAliasCount, 1);
    const compared = await call("/api/compare", { cookie, body: { ...watch, enabled: false } });
    assert.equal(compared.status, 200);
    const data = await compared.json();
    assert.equal(data.results[0].refs.f24.score, "6:0");
    assert.equal(data.results[0].refs.sofa, undefined);
    assert.equal(
      (await (await call("/api/monitor", { cookie })).json()).view.matches[0].comparisonStatus,
      "mismatch",
    );
    assert.equal(
      (await call("/api/team-aliases", { cookie, body: { ...link, confirmed: true } })).status,
      400,
    );
    assert.equal(
      (
        await call("/api/team-aliases", {
          cookie,
          body: {
            source: "f24",
            internalName: "Victoria Utd Limbe",
            sourceName: "Victoria United",
            confirmed: true,
          },
        })
      ).status,
      200,
    );
    const backup = await (await call("/api/backup", { cookie })).json();
    backup.watch.sources = ["sofa"];
    const restore = await call("/api/backup/restore", {
      cookie,
      body: { backup, confirmed: true },
    });
    assert.equal(restore.status, 200, await restore.text());
    const restored = await (await call("/api/monitor", { cookie })).json();
    assert.deepEqual(restored.monitor.watch.sources, ["f24"]);
    assert.equal(restored.monitor.lastResult, null);
    assert.equal(restored.view.matches[0].comparisonStatus, "unverified");
    assert.equal((await (await call("/api/team-aliases", { cookie })).json()).legacyAliasCount, 1);
    assert.equal(
      (await (await call("/api/team-aliases", { cookie })).json()).aliases[0].source,
      "f24",
    );
    const shared = await call("/api/team-aliases", {
      cookie,
      body: {
        source: "all",
        scope: "shared",
        internalName: "Shared Internal",
        sourceName: "Shared Source",
        confirmed: true,
      },
    });
    assert.equal(shared.status, 200);
    const sharedId = (await shared.json()).saved[0].id;
    const deleteShared = await call("/api/team-aliases", {
      cookie,
      method: "DELETE",
      body: { id: sharedId, scope: "shared" },
    });
    assert.equal(deleteShared.status, 200);
    const sharedReply = await deleteShared.json();
    assert.equal(sharedReply.aliases.length, 1);
    assert.ok(sharedReply.aliases.every((item) => item.source !== "sofa"));
    const active = (await (await call("/api/team-aliases", { cookie })).json()).aliases[0];
    const removed = await call("/api/team-aliases", {
      cookie,
      method: "DELETE",
      body: { id: active.id },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).aliases, []);
    assert.equal(
      runtime.teamAliases.list("operator-stefan").filter((item) => item.source === "sofa").length,
      1,
    );
  } finally {
    if (runtime) await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
