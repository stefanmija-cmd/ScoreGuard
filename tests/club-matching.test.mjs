import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { matchEvent, eventReference, resultStatus, dateKey, timeKey } from "../scraper/model.mjs";
import { createCollector } from "../scraper/collector.mjs";
import { parseFlashscore } from "../scraper/providers/flashscore.mjs";
const date = "2026-11-11",
  now = Date.parse("2026-11-11T22:00:00Z");
const internal = () => ({
  id: "72499",
  sport: "Fudbal",
  league: "Venecuela Kup",
  match: "Zamora – Atletico Barinas",
  time: "21:30",
  score: "1:0",
  ht: "0:0",
  expectedStatus: "second_half",
});
const event = (extra = {}) => ({
  id: "fixture-event",
  home: "Zamora",
  away: "Atletico Barinas",
  league: "Copa Venezuela",
  fullLeague: "VENEZUELA: Copa Venezuela",
  startTimestamp: Date.parse("2026-11-11T20:30:00Z") / 1000,
  state: "live",
  phase: "second_half",
  current: "1:0",
  halfTime: "0:0",
  regularTime: "1:0",
  ...extra,
});
test("Serbian competition name no longer blocks the same club pair", () => {
  assert.equal(matchEvent(internal(), [event()], date).event.id, "fixture-event");
});
test("competition can be missing or completely different without creating a mismatch", () => {
  for (const league of [undefined, "Premier League", "Prijateljska utakmica"]) {
    const e = event({ league, fullLeague: null });
    const found = matchEvent(internal(), [e], date);
    assert.ok(found.event);
    const ref = eventReference(found.event, new Date(now).toISOString());
    assert.equal(resultStatus({ ...internal(), refs: { flash: ref } }, ["flash"], now), "match");
  }
});
test("home and away order, full kickoff date and time remain mandatory", () => {
  for (const e of [
    event({ home: "Atletico Barinas", away: "Zamora" }),
    event({ startTimestamp: Date.parse("2026-11-12T20:30:00Z") / 1000 }),
    event({ startTimestamp: Date.parse("2026-11-11T20:45:00Z") / 1000 }),
  ])
    assert.ok(matchEvent(internal(), [e], date).reason);
});
test("competition cannot break ties between otherwise identical candidates", () => {
  const found = matchEvent(
    internal(),
    [event({ id: "one", league: "Venecuela Kup" }), event({ id: "two", league: "Copa Venezuela" })],
    date,
  );
  assert.equal(found.event, undefined);
  assert.match(found.reason, /Više mogućih mečeva/);
});
test("club aliases and diacritics still work across different competition names", () => {
  const m = { ...internal(), match: "Crvena Zvezda – Čukarički" };
  const e = event({ home: "Red Star Belgrade", away: "Cukaricki", league: "Serbian Cup" });
  const aliases = { teams: { redstarbelgrade: "Crvena Zvezda" } };
  assert.ok(matchEvent(m, [e], date, aliases).event);
});
test("youth, reserve and womens club suffixes do not collapse into the senior club", () => {
  for (const name of ["Zamora U19", "Zamora B", "Zamora II", "Zamora W"])
    assert.ok(matchEvent(internal(), [event({ home: name })], date).reason);
});
test("league aliases cannot accidentally change club identity", () => {
  assert.ok(
    matchEvent({ ...internal(), match: "Different Club – Atletico Barinas" }, [event()], date, {
      leagues: { differentclub: "Zamora" },
    }).reason,
  );
});
test("successful references retain the source club names and competition for review", () => {
  const ref = eventReference(event(), new Date(now).toISOString());
  assert.equal(ref.sourceHome, "Zamora");
  assert.equal(ref.sourceAway, "Atletico Barinas");
  assert.equal(ref.sourceLeague, "VENEZUELA: Copa Venezuela");
});
test("both collectors link by clubs and still report real score differences", async () => {
  const c = createCollector({
    clock: () => now,
    providers: {
      flash: async () => [event({ current: "2:0" })],
      f24: async () => [
        event({ id: "f24-one", league: "Venezuelan Cup", fullLeague: null, current: "2:0" }),
      ],
    },
  });
  const result = await c.collect({ date, sources: ["flash", "f24"], matches: [internal()] });
  const refs = result.results[0].refs;
  assert.equal(refs.flash.state, "verified");
  assert.equal(refs.f24.state, "verified");
  assert.equal(resultStatus({ ...internal(), refs }, ["flash", "f24"], now), "mismatch");
});
test("actual public Flashscore record links despite an internal Serbian competition label", async () => {
  const parsed = parseFlashscore(
    fs.readFileSync(new URL("./fixtures/flashscore-public.txt", import.meta.url), "utf8"),
  );
  const sample = parsed.find((e) => e.id === "l8QZKzV1");
  const day = dateKey(sample.startTimestamp * 1000);
  const m = {
    id: "real-fixture",
    sport: "Fudbal",
    match: sample.home + " – " + sample.away,
    league: "Brazil Prvenstvo",
    time: timeKey(sample.startTimestamp * 1000),
    score: sample.current,
    ht: sample.halfTime,
  };
  const c = createCollector({
    clock: () => sample.startTimestamp * 1000 + 3600000,
    providers: { flash: async () => parsed },
  });
  const r = await c.collect({ date: day, sources: ["flash"], matches: [m] });
  assert.equal(r.results[0].refs.flash.state, "verified");
  assert.equal(r.results[0].refs.flash.eventId, sample.id);
});
