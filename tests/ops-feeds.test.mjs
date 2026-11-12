import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollector } from "../scraper/collector.mjs";
import { candidateMatches } from "../scraper/team-matching.mjs";
import {
  eventReference,
  matchEvent,
  resultStatus,
  FRESH_MS,
  validateWatch,
} from "../scraper/model.mjs";
import { parseApiFootball, createApiFootballProvider } from "../scraper/providers/api-football.mjs";

const now = Date.parse("2026-11-11T20:00:00Z"),
  stamp = Date.parse("2026-11-11T17:00:00Z") / 1000;
const match = {
  id: "one",
  sport: "Fudbal",
  date: "2026-11-11",
  time: "18:00",
  match: "Colombe – Victoria Utd Limbe",
  league: "Kamerun 1",
  score: "1:0",
  ht: "0:0",
};
const event = {
  id: "source-one",
  home: "Colombe",
  away: "Victoria United",
  league: "Elite One",
  startTimestamp: stamp,
  state: "finished",
  phase: "finished",
  current: "1:0",
  regularTime: "1:0",
  halfTime: "0:0",
};
const watch = { date: "2026-11-11", sources: ["flash"], matches: [match] };

test("abbreviations and unique club variants above 80 percent auto-link with category safeguards", () => {
  assert.equal(
    matchEvent({ ...match, match: "Colombe – Victoria Utd" }, [event], watch.date).event.id,
    event.id,
  );
  assert.equal(matchEvent(match, [event], watch.date).event.id, event.id);
  const suggestions = candidateMatches(match, [event], watch.date);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].away, "Victoria United");
  for (const extra of [
    { home: "Colombe U19" },
    { away: "Victoria United Women" },
    { away: "Victoria United II" },
    { startTimestamp: stamp + 3600 },
    { home: "Victoria United", away: "Colombe" },
  ])
    assert.equal(candidateMatches(match, [{ ...event, ...extra }], watch.date).length, 0);
  assert.equal(
    matchEvent(
      { ...match, match: "Colombe U19 – Victoria Utd U19" },
      [{ ...event, home: "Colombe U19", away: "Victoria United U19" }],
      watch.date,
    ).event.id,
    event.id,
  );
});

test("twelve concurrent operators share each feed request and cache does not advance source time", async () => {
  let time = now,
    calls = 0,
    release;
  const pending = new Promise((resolve) => (release = resolve));
  const collector = createCollector({
    clock: () => time,
    providers: {
      flash: async () => {
        calls++;
        await pending;
        return [event];
      },
    },
  });
  const all = Array.from({ length: 12 }, () =>
    collector.collect({ ...watch, matches: [{ ...match, match: "Colombe – Victoria Utd" }] }),
  );
  release();
  const results = await Promise.all(all);
  assert.equal(calls, 1);
  assert.equal(collector.stats.joinedRequests, 11);
  const checked = results[0].results[0].refs.flash.checkedAt;
  time += 120000;
  const cached = await collector.collect({
    ...watch,
    matches: [{ ...match, match: "Colombe – Victoria Utd" }],
  });
  assert.equal(calls, 1);
  assert.equal(cached.results[0].refs.flash.checkedAt, checked);
  time += 180001;
  await collector.collect(watch);
  assert.equal(calls, 2);
});

test("manual checks coalesce for fifteen seconds then fetch new results", async () => {
  let time = now,
    score = "1:0",
    calls = 0;
  const collector = createCollector({
    clock: () => time,
    providers: {
      flash: async () => {
        calls++;
        return [{ ...event, current: score }];
      },
    },
  });
  const exact = { ...watch, matches: [{ ...match, match: "Colombe – Victoria United" }] };
  await collector.collect(exact, { trigger: "manual" });
  score = "2:0";
  time += 14000;
  const shared = await collector.collect(exact, { trigger: "manual" });
  assert.equal(shared.results[0].refs.flash.score, "1:0");
  assert.equal(calls, 1);
  time += 1001;
  const fresh = await collector.collect(exact, { trigger: "manual" });
  assert.equal(fresh.results[0].refs.flash.score, "2:0");
  assert.equal(calls, 2);
});

test("upstream cache age and reuse cannot keep an old result green", async () => {
  let time = now,
    calls = 0;
  const events = Object.defineProperty([{ ...event }], "sourceAgeMs", { value: 240000 });
  const collector = createCollector({
    clock: () => time,
    providers: {
      flash: async () => {
        calls++;
        return events;
      },
    },
  });
  const exact = { ...watch, matches: [{ ...match, match: "Colombe – Victoria United" }] };
  const first = await collector.collect(exact);
  const ref = first.results[0].refs.flash;
  assert.equal(Date.parse(ref.checkedAt), now - 240000);
  assert.equal(
    resultStatus({ ...exact.matches[0], refs: { flash: ref } }, ["flash"], now),
    "match",
  );
  assert.equal(
    resultStatus({ ...exact.matches[0], refs: { flash: ref } }, ["flash"], now + 90001),
    "unverified",
  );
  time += 90001;
  await collector.collect(exact);
  assert.equal(calls, 2);
});

test("API-Football maps live and finished phases and preserves the 90-minute score", () => {
  const fixture = {
    fixture: { id: 12, timestamp: stamp, status: { short: "AET" } },
    teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } },
    league: { name: "Cup", country: "Country" },
    goals: { home: 2, away: 1 },
    score: { halftime: { home: 0, away: 0 }, fulltime: { home: 1, away: 1 } },
  };
  const parsed = parseApiFootball({ response: [fixture], errors: [] })[0];
  assert.equal(parsed.phase, "finished_extra_time");
  assert.equal(eventReference(parsed, new Date(now).toISOString()).score, "1:1");
  for (const [status, phase] of [
    ["1H", "first_half"],
    ["HT", "half_time"],
    ["2H", "second_half"],
    ["FT", "finished"],
    ["PEN", "finished_penalties"],
  ])
    assert.equal(
      parseApiFootball({
        response: [{ ...fixture, fixture: { ...fixture.fixture, status: { short: status } } }],
        errors: [],
      })[0].phase,
      phase,
    );
  assert.throws(
    () => parseApiFootball({ response: [], errors: { token: "not valid" } }),
    /odbio zahtev/,
  );
});

test("API-Football uses a server header, blocks redirects, honors its daily budget and fails visibly without a key", async () => {
  let calls = 0;
  const key = "unit-test-key-not-a-real-credential";
  const provider = createApiFootballProvider({ key, dailyLimit: 1, clock: () => now });
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.headers["x-apisports-key"], key);
    assert.equal(options.redirect, "error");
    assert.ok(!url.includes(key));
    return new Response(JSON.stringify({ response: [], errors: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  await provider({ date: watch.date, fetcher });
  await assert.rejects(provider({ date: watch.date, fetcher }), (e) => e.code === "RATE_LIMIT");
  assert.equal(calls, 1);
  await assert.rejects(
    createApiFootballProvider()({ date: watch.date, fetcher }),
    (e) => e.code === "NOT_CONFIGURED",
  );
  assert.equal(calls, 1);
  assert.deepEqual(validateWatch({ ...watch, sources: ["flash", "f24", "api"] }).sources, [
    "flash",
    "f24",
    "api",
  ]);
});
