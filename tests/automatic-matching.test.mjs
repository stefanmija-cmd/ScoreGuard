import { test } from "node:test";
import assert from "node:assert/strict";
import { teamSimilarity, AUTO_MATCH_THRESHOLD } from "../scraper/team-matching.mjs";
import { matchEvent, resultStatus } from "../scraper/model.mjs";
import { createCollector } from "../scraper/collector.mjs";

const date = "2026-11-11",
  now = Date.parse("2026-11-11T20:00:00Z");
const match = {
  id: "one",
  sport: "Fudbal",
  time: "18:00",
  match: "Colombe – Victoria Utd Limbe",
  league: "Kamerun 1",
  score: "1:0",
  ht: "0:0",
};
const event = {
  id: "fixture",
  home: "Colombe",
  away: "Victoria United",
  league: "Elite One",
  startTimestamp: Date.parse("2026-11-11T17:00:00Z") / 1000,
  state: "finished",
  phase: "finished",
  current: "1:0",
  halfTime: "0:0",
  regularTime: "1:0",
};
const watch = { date, sources: ["flash", "f24"], matches: [match] };

test("the Victoria example auto-links both providers without a saved alias", async () => {
  const collector = createCollector({
    clock: () => now,
    providers: { flash: async () => [event], f24: async () => [{ ...event, id: "f24-fixture" }] },
  });
  const result = await collector.collect(watch);
  for (const source of watch.sources) {
    const ref = result.results[0].refs[source];
    assert.equal(ref.state, "verified");
    assert.equal(ref.matching.method, "similarity");
    assert.equal(ref.matching.homeSimilarity, 1);
    assert.equal(ref.matching.awaySimilarity, 26 / 31);
    assert.equal(ref.matching.threshold, 0.8);
    assert.equal(ref.sourceAway, "Victoria United");
  }
  assert.equal(
    resultStatus({ ...match, refs: result.results[0].refs }, watch.sources, now),
    "match",
  );
});

test("80 percent is inclusive and must be reached separately by each club", () => {
  const m = { ...match, match: "abcdef – mnopqr" },
    e = { ...event, home: "abcdeg", away: "mnopqs" };
  assert.equal(teamSimilarity("abcdef", "abcdeg"), AUTO_MATCH_THRESHOLD);
  assert.equal(matchEvent(m, [e], date).matching.homeSimilarity, 0.8);
  assert.equal(matchEvent(m, [e], date).matching.awaySimilarity, 0.8);
  const weak = { ...event, home: "Exact Home", away: "abcdf" },
    internal = { ...match, match: "Exact Home – abcde" };
  assert.equal(teamSimilarity("abcde", "abcdf"), 0.75);
  assert.equal(matchEvent(internal, [weak], date).event, undefined); // Average 87.5% is insufficient.
});

test("close candidates and duplicate source records require manual confirmation", () => {
  for (const other of [
    { ...event, id: "duplicate" },
    { ...event, id: "close", away: "Victoria Uniteds" },
  ]) {
    const found = matchEvent(match, [event, other], date);
    assert.equal(found.event, undefined);
    assert.match(found.reason, /bliskih kandidata/);
  }
  const exact = { ...match, match: "Colombe – Victoria United" };
  assert.match(
    matchEvent(exact, [event, { ...event, id: "duplicate" }], date).reason,
    /Više mogućih mečeva/,
  );
});

test("a close runner below 80 percent still prevents an ambiguous automatic choice", () => {
  const m = { ...match, match: "Colombe – abcdef" },
    best = { ...event, away: "abcdeg" },
    runner = { ...event, id: "runner", away: "abcd" };
  assert.equal(teamSimilarity("abcdef", "abcd"), 0.75);
  assert.equal(matchEvent(m, [best], date).event.id, event.id);
  const found = matchEvent(m, [best, runner], date);
  assert.equal(found.event, undefined);
  assert.match(found.reason, /5 procentnih poena/);
});

test("a sufficiently separated candidate wins independently of source ordering or score", () => {
  const other = { ...event, id: "weaker", away: "Victoria Limbe", current: "1:0" },
    best = { ...event, current: "3:0" };
  for (const events of [
    [other, best],
    [best, other],
  ])
    assert.equal(matchEvent(match, events, date).event.current, "3:0");
});

test("exact club pairs and explicit confirmed aliases take priority over fuzzy alternatives", () => {
  const exact = { ...match, match: "Colombe – Victoria United" };
  assert.equal(
    matchEvent(exact, [{ ...event, id: "near", away: "Victoria Uniteds" }, event], date).matching
      .method,
    "exact",
  );
  const aliases = { teams: { viktorijajunajted: "Victoria United" } };
  assert.equal(
    matchEvent({ ...match, match: "Colombe – Viktorija Junajted" }, [event], date, aliases).matching
      .method,
    "exact",
  );
});

test("automatic matching preserves date, exact kickoff time and home-away order", () => {
  for (const e of [
    { ...event, startTimestamp: event.startTimestamp + 60 },
    { ...event, startTimestamp: event.startTimestamp + 86400 },
    { ...event, home: event.away, away: event.home },
  ])
    assert.equal(matchEvent(match, [e], date).event, undefined);
});

test("similar names cannot bridge different age groups, women, reserves or third teams", () => {
  for (const suffix of ["U19", "U21", "Women", "W", "Žene", "B", "II", "Reserves", "III", "C"]) {
    assert.equal(
      matchEvent(match, [{ ...event, home: event.home + " " + suffix }], date).event,
      undefined,
    );
    assert.equal(
      matchEvent(match, [{ ...event, away: event.away + " " + suffix }], date).event,
      undefined,
    );
  }
  for (const [a, b] of [
    ["U19", "U21"],
    ["B", "III"],
    ["II", "C"],
  ])
    assert.equal(
      matchEvent(
        { ...match, match: "Colombe " + a + " – Victoria Utd Limbe" },
        [{ ...event, home: "Colombe " + b }],
        date,
      ).event,
      undefined,
    );
});

test("collector checks the full kickoff slot instead of hiding a rival behind an exact home index", async () => {
  const other = { ...event, id: "rival", home: "Colombes", away: "Victoria United Limbe" };
  const collector = createCollector({
    clock: () => now,
    providers: { flash: async () => [event, other] },
  });
  const result = await collector.collect({ ...watch, sources: ["flash"] });
  const ref = result.results[0].refs.flash;
  assert.equal(ref.state, "unverified");
  assert.match(ref.reason, /bliskih kandidata/);
  assert.equal(ref.suggestions.length, 2);
});

test("automatic identity matching never suppresses score differences or missing source data", async () => {
  for (const [extra, status] of [
    [{ current: "2:0" }, "mismatch"],
    [{ current: null }, "unverified"],
    [{ state: "scheduled", phase: "scheduled" }, "unverified"],
    [{ halfTime: null }, "unverified"],
  ]) {
    const collector = createCollector({
      clock: () => now,
      providers: { flash: async () => [{ ...event, ...extra }] },
    });
    const result = await collector.collect({ ...watch, sources: ["flash"] });
    assert.equal(result.results[0].refs.flash.matching.method, "similarity");
    assert.equal(resultStatus({ ...match, refs: result.results[0].refs }, ["flash"], now), status);
  }
  const collector = createCollector({
    clock: () => now,
    providers: { flash: async () => Object.assign([event], { sourceAgeMs: 331000 }) },
  });
  const stale = await collector.collect({ ...watch, sources: ["flash"] });
  assert.equal(
    resultStatus({ ...match, refs: stale.results[0].refs }, ["flash"], now),
    "unverified",
  );
});
