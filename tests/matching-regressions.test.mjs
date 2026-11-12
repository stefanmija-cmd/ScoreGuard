import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollector } from "../scraper/collector.mjs";
import { matchEvent } from "../scraper/model.mjs";
import { teamSimilarity } from "../scraper/team-matching.mjs";
import { compileTeamAliases } from "../scraper/team-aliases.mjs";

const date = "2026-11-11",
  now = Date.parse(date + "T20:00:00Z");
const event = {
  id: "fixture",
  home: "Colombe",
  away: "Victoria United",
  startTimestamp: Date.parse(date + "T17:00:00Z") / 1000,
  state: "finished",
  phase: "finished",
  current: "1:0",
  halfTime: "0:0",
  regularTime: "1:0",
};
const match = {
  id: "one",
  sport: "Fudbal",
  time: "18:00",
  match: "Colombe – Victoria Utd Limbe",
  league: "Kamerun 1",
  score: "1:0",
  ht: "0:0",
};

test("an isolated F initial does not classify a club as a womens team", () => {
  const internal = { ...match, match: "F. C. Porto – Benfica FC" },
    source = { ...event, home: "FC Porto", away: "Benfica" };
  assert.equal(teamSimilarity("F. C. Porto", "FC Porto"), 1);
  assert.equal(matchEvent(internal, [source], date).event.id, source.id);
  assert.equal(
    matchEvent(internal, [{ ...source, home: "FC Porto Women" }], date).event,
    undefined,
  );
});

test("a confirmed alias overrides category heuristics even when the opponent is only a fuzzy match", async () => {
  const internal = { ...match, match: "Colombe U19 – Victoria Utd Limbe" };
  const links = [
    { source: "flash", internalName: "Colombe U19", sourceName: "Colombe", confirmed: true },
  ];
  const collector = createCollector({
    clock: () => now,
    providers: { flash: async () => [event], f24: async () => [event] },
  });
  const result = await collector.collect(
    { date, sources: ["flash", "f24"], matches: [internal] },
    { teamAliases: links },
  );
  const refs = result.results[0].refs;
  assert.equal(refs.flash.state, "verified");
  assert.equal(refs.flash.matching.homeSimilarity, 1);
  assert.ok(refs.flash.matching.awaySimilarity >= 0.8);
  assert.equal(refs.f24.state, "unverified"); // A source-specific alias never leaks.
});

test("configured and transitive aliases are authoritative in either direction", () => {
  const aliases = compileTeamAliases({ flash: { teams: { colombe: "Colombe Youth" } } }, [
    { source: "flash", internalName: "Colombe Youth", sourceName: "Colombe U19" },
  ]).flash;
  assert.equal(teamSimilarity("Colombe U19", "Colombe", aliases), 1);
  assert.equal(teamSimilarity("Colombe", "Colombe U19", aliases), 1);
  assert.equal(
    matchEvent({ ...match, match: "Colombe U19 – Victoria Utd Limbe" }, [event], date, aliases)
      .event.id,
    event.id,
  );
});

test("fuzzy matching checks the category of canonical names after applying aliases", () => {
  const aliases = { teams: { colombeyouth: "Colombe Women" } };
  assert.ok(teamSimilarity("Colombe Youth", "Colombe Women FC", aliases) >= 0.8);
  const internal = { ...match, match: "Colombe Youth – Victoria United" };
  const source = { ...event, home: "Colombe Women FC" };
  assert.equal(matchEvent(internal, [source], date, aliases).event.id, source.id);
});

test("a canonical age marker prevents fuzzy matching to a senior variant", () => {
  const aliases = { teams: { colombe: "Colombe U19" } };
  assert.equal(teamSimilarity("Colombe", "Colombes", aliases), 0);
  assert.equal(teamSimilarity("Colombe", "Colombe U19", aliases), 1);
});

test("compiled aliases preserve readable targets for fuzzy category checks", () => {
  const variants = [
    compileTeamAliases({ flash: { teams: { colombeu19: "Different Youth Club" } } }).flash,
    compileTeamAliases({}, [
      { source: "flash", internalName: "Colombe U19", sourceName: "Different Youth Club" },
    ]).flash,
  ];
  for (const aliases of variants) {
    assert.ok(teamSimilarity("Colombe U19", "Colombe", aliases) < 0.55);
    assert.ok(teamSimilarity("Colombe U19", "Different Youth Club FC", aliases) >= 0.8);
    const found = matchEvent(
      { ...match, match: "Colombe U19 – Victoria Utd Limbe" },
      [{ ...event, home: "Different Youth Club FC" }],
      date,
      aliases,
    );
    assert.equal(found.event.id, event.id);
  }
});

test("unrelated explicit aliases do not bypass the category of another team or the kickoff", () => {
  const aliases = compileTeamAliases({}, [
    { source: "flash", internalName: "Colombe U19", sourceName: "Different Youth Club" },
  ]).flash;
  assert.equal(
    matchEvent({ ...match, match: "Colombe U19 – Victoria Utd Limbe" }, [event], date, aliases)
      .event,
    undefined,
  );
  const confirmed = compileTeamAliases({}, [
    { source: "flash", internalName: "Colombe U19", sourceName: "Colombe" },
  ]).flash;
  assert.equal(
    matchEvent(
      { ...match, match: "Colombe U19 – Victoria Utd Limbe" },
      [{ ...event, startTimestamp: event.startTimestamp + 60 }],
      date,
      confirmed,
    ).event,
    undefined,
  );
  assert.equal(
    matchEvent(
      { ...match, match: "Colombe U19 – Victoria Utd Limbe" },
      [{ ...event, away: "Victoria United Women" }],
      date,
      confirmed,
    ).event,
    undefined,
  );
});

test("home, away and slot candidates are combined without duplicates or missing rivals", async () => {
  const byHome = { ...event, id: "by-home" },
    byAway = { ...event, id: "by-away", home: "Colombes", away: "Victoria United Limbe" },
    slotOnly = { ...event, id: "slot-only", home: "Colombes" };
  const outside = { ...slotOnly, id: "wrong-time", startTimestamp: event.startTimestamp + 60 };
  const collector = createCollector({
    clock: () => now,
    providers: { flash: async () => [byHome, byAway, slotOnly, outside] },
  });
  const result = await collector.collect({ date, sources: ["flash"], matches: [match] });
  const ref = result.results[0].refs.flash;
  assert.equal(ref.state, "unverified");
  assert.match(ref.reason, /bliskih kandidata/);
  assert.deepEqual(
    new Set(ref.suggestions.map((s) => s.eventId)),
    new Set(["by-home", "by-away", "slot-only"]),
  );
  assert.equal(ref.suggestions.length, 3);
});

test("one event appearing in multiple indexes is not a false ambiguity", async () => {
  const internal = { ...match, match: "F. C. Porto – Benfica FC" },
    source = { ...event, home: "FC Porto", away: "Benfica" };
  const collector = createCollector({
    clock: () => now,
    providers: { flash: async () => [source] },
  });
  const result = await collector.collect({ date, sources: ["flash"], matches: [internal] });
  assert.equal(result.results[0].refs.flash.state, "verified");
  assert.equal(result.results[0].refs.flash.eventId, source.id);
});
