import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TeamAliasStore } from "../service/team-aliases.mjs";
import { normalizeTeamLink, compileTeamAliases } from "../scraper/team-aliases.mjs";
import { matchEvent, dateKey, timeKey } from "../scraper/model.mjs";
import { Monitor } from "../service/monitor.mjs";

const link = {
  source: "flash",
  internalName: "Victoria Utd Limbe",
  sourceName: "Victoria United",
  confirmed: true,
};
const stamp = Date.parse("2026-11-11T12:00:00Z") / 1000;
const match = {
  id: "one",
  sport: "Fudbal",
  match: "Colombe – Victoria Utd Limbe",
  league: "Kamerun 1",
  time: timeKey(stamp * 1000),
  ht: "0:0",
  score: "1:0",
};
const event = {
  id: "flash-event",
  home: "Colombe",
  away: "Victoria United",
  league: "Cameroon Elite One",
  startTimestamp: stamp,
};
const watch = { date: dateKey(stamp * 1000), sources: ["flash"], matches: [match] };
const memory = () => ({
  data: {},
  async load() {
    return structuredClone(this.data);
  },
  async save(data) {
    this.data = structuredClone(data);
  },
});

test("explicit club equivalences resolve the Cameroon example, support variants and preserve kickoff and order", () => {
  const links = [
    normalizeTeamLink(link),
    normalizeTeamLink({ ...link, internalName: "Victoria Utd", source: "all" }),
  ];
  const compiled = compileTeamAliases({}, links);
  assert.equal(matchEvent(match, [event], watch.date, compiled.flash).event.id, event.id);
  assert.equal(
    matchEvent({ ...match, match: "Colombe – Victoria Utd" }, [event], watch.date, compiled.flash)
      .event.id,
    event.id,
  );
  assert.ok(
    matchEvent(match, [{ ...event, startTimestamp: stamp + 60 }], watch.date, compiled.flash)
      .reason,
  );
  assert.ok(
    matchEvent(
      match,
      [{ ...event, home: event.away, away: event.home }],
      watch.date,
      compiled.flash,
    ).reason,
  );
  assert.ok(
    matchEvent(match, [{ ...event, home: "Colombe U19" }], watch.date, compiled.flash).reason,
  );
  const untranslated = { ...match, match: "Colombe – Viktorija Junajted" };
  const privateLink = compileTeamAliases({}, [
    normalizeTeamLink({ ...link, internalName: "Viktorija Junajted" }),
  ]);
  assert.equal(matchEvent(untranslated, [event], watch.date, privateLink.flash).event.id, event.id);
  assert.ok(matchEvent(untranslated, [event], watch.date, privateLink.f24).reason);
  assert.equal(
    matchEvent({ ...match, match: "Colombe – Victoria Utd" }, [event], watch.date, compiled.f24)
      .event.id,
    event.id,
  );
});
test("explicit links compose with preconfigured aliases without losing either name or collapsing both opponents", () => {
  const compiled = compileTeamAliases(
    { flash: { teams: { victoriaunited: "Victoria Utd Limbe" } } },
    [{ ...link, internalName: "Victoria Utd", source: "flash" }],
  );
  assert.ok(
    matchEvent({ ...match, match: "Colombe – Victoria Utd" }, [event], watch.date, compiled.flash)
      .event,
  );
  const bad = compileTeamAliases({}, [
    { source: "flash", internalName: "Colombe", sourceName: "Victoria Utd Limbe" },
  ]);
  assert.match(matchEvent(match, [event], watch.date, bad.flash).reason, /Oba tima/);
  assert.ok(matchEvent(match, [event, event], watch.date, compiled.flash).reason);
});
test("pair validation requires an explicit confirmation and rejects malformed, redundant or different youth teams", () => {
  for (const raw of [
    { ...link, confirmed: false },
    { ...link, source: "unknown" },
    { ...link, sourceName: "" },
    { ...link, internalName: "Victoria United" },
    { ...link, sourceName: "x\ny" },
    { ...link, sourceName: "x".repeat(151) },
    { ...link, internalName: "Team U19", sourceName: "Team U21" },
  ])
    assert.throws(() => normalizeTeamLink(raw));
  assert.equal(
    normalizeTeamLink({ ...link, internalName: " Victoria Utd Limbe " }).internalName,
    link.internalName,
  );
});
test("alias storage persists, deduplicates reversed pairs and isolates operator ownership and history", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-alias-store-"));
  try {
    const store = new TeamAliasStore(directory);
    await store.init();
    const first = await store.add("operator-stefan", link, "Stefan");
    assert.equal(first.changed, true);
    const revision = store.revision("operator-stefan");
    const duplicate = await store.add(
      "operator-stefan",
      { ...link, internalName: link.sourceName, sourceName: link.internalName },
      "Stefan",
    );
    assert.equal(duplicate.changed, false);
    assert.equal(store.revision("operator-stefan"), revision);
    assert.deepEqual(store.list("operator-milos"), []);
    await assert.rejects(
      store.remove("operator-milos", first.saved[0].id, "Milos"),
      /vašem nalogu/,
    );
    const restored = new TeamAliasStore(directory);
    await restored.init();
    assert.equal(restored.list("operator-stefan")[0].sourceName, "Victoria United");
    assert.equal((await fs.stat(path.join(directory, "team-aliases.json"))).mode & 0o777, 0o600);
    await restored.remove("operator-stefan", first.saved[0].id, "Stefan");
    assert.deepEqual(restored.list("operator-stefan"), []);
    assert.equal(restored.history("operator-stefan")[0].action, "removed");
    assert.equal(restored.history("operator-stefan")[0].operator, "operator-stefan");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("imports are atomic and concurrent writes do not overwrite another operator", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-alias-import-"));
  try {
    const store = new TeamAliasStore(directory, { limit: 2 });
    await store.init();
    await Promise.all([
      store.add("operator-stefan", link, "Stefan"),
      store.add("operator-milos", link, "Milos"),
    ]);
    assert.equal(store.list("operator-stefan").length, 1);
    assert.equal(store.list("operator-milos").length, 1);
    const second = { ...link, internalName: "Red Star", sourceName: "Crvena Zvezda" },
      third = { ...link, internalName: "United", sourceName: "Utd" };
    await assert.rejects(store.addMany("operator-stefan", [second, third], "Stefan"), /Maksimalno/);
    assert.equal(store.list("operator-stefan").length, 1);
    assert.throws(() =>
      store.addMany("operator-stefan", [second, { ...third, confirmed: false }], "Stefan"),
    );
    assert.equal(store.list("operator-stefan").length, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("changing a mapping discards old in-flight references and a following manual check uses the new links", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-alias-inflight-"));
  try {
    const aliases = new TeamAliasStore(directory);
    await aliases.init();
    let finish,
      callCount = 0;
    const collector = {
      collect(config, options) {
        callCount++;
        if (callCount === 1) return new Promise((resolve) => (finish = resolve));
        assert.equal(options.teamAliases[0].sourceName, "Victoria United");
        return Promise.resolve({ results: [], health: {} });
      },
    };
    const monitor = new Monitor({ collector, teamAliases: aliases, store: memory() });
    await monitor.init();
    await monitor.configure("operator-stefan", watch, { enabled: false });
    const old = monitor.check("operator-stefan");
    await aliases.add("operator-stefan", link, "Stefan");
    await monitor.matchingChanged("operator-stefan");
    const fresh = monitor.check("operator-stefan");
    finish({
      results: [{ id: "one", refs: { flash: { state: "verified", score: "9:9" } } }],
      health: {},
    });
    assert.equal((await old).discarded, true);
    await fresh;
    assert.equal(callCount, 2);
    assert.deepEqual(monitor.snapshot("operator-stefan").lastResult.results, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("restoring monitoring after offline alias changes invalidates saved results", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sg-alias-restart-"));
  try {
    const aliases = new TeamAliasStore(directory);
    await aliases.init();
    const store = memory(),
      collector = {
        async collect() {
          return { results: [], health: {} };
        },
      };
    const old = new Monitor({ collector, teamAliases: aliases, store });
    await old.init();
    await old.configure("operator-stefan", watch, { enabled: false });
    await old.check("operator-stefan");
    assert.ok(old.snapshot("operator-stefan").lastResult);
    await aliases.add("operator-stefan", link, "Stefan");
    const restored = new Monitor({ collector, teamAliases: aliases, store });
    await restored.init();
    assert.equal(restored.snapshot("operator-stefan").lastResult, null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
