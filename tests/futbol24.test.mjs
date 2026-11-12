import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseFutbol24, scrapeFutbol24, futbol24Midnight } from "../scraper/providers/futbol24.mjs";
import { eventReference, resultStatus, FRESH_MS } from "../scraper/model.mjs";
import { SourceError } from "../scraper/http.mjs";
import { createCollector } from "../scraper/collector.mjs";

const live = JSON.parse(
  fs.readFileSync(new URL("./fixtures/futbol24-live.json", import.meta.url), "utf8"),
);
const finished = JSON.parse(
  fs.readFileSync(new URL("./fixtures/futbol24-finished.json", import.meta.url), "utf8"),
);
const now = Date.parse(live.live.datetime),
  date = "2026-11-12",
  checkedAt = new Date(now).toISOString();
const clone = (value) => structuredClone(value);

test("recorded Futbol24 live feed distinguishes halves, half-time and normal completion", () => {
  const events = parseFutbol24(live, { date, now });
  for (const [id, phase] of [
    [2, "first_half"],
    [3, "half_time"],
    [4, "second_half"],
    [5, "finished"],
  ]) {
    const source = Object.entries(live.live.matches).find(([, m]) => m.status_id === id);
    const event = events.find((e) => e.id === source[0]);
    assert.equal(event.phase, phase);
    assert.ok(event.current);
    if (phase === "first_half") assert.equal(event.halfTime, null);
    else assert.ok(event.halfTime);
  }
  const first = events.find((e) => e.phase === "first_half");
  assert.equal(
    resultStatus(
      { score: first.current, ht: null, refs: { f24: eventReference(first, checkedAt) } },
      ["f24"],
      now,
    ),
    "match",
  );
});

test("the two recorded completed U19 examples preserve full-time and half-time scores", () => {
  const events = parseFutbol24(finished, { date: "2026-11-11", now });
  for (const [id, score, ht] of [
    ["3438777", "0:1", "0:0"],
    ["3438761", "6:0", "3:0"],
  ]) {
    const e = events.find((event) => event.id === id);
    assert.equal(e.current, score);
    assert.equal(e.halfTime, ht);
    assert.equal(e.state, "finished");
    const internal = {
      score,
      ht,
      expectedStatus: "second_half",
      native: { market: "FT", phase: "2nd half" },
      refs: { f24: eventReference(e, checkedAt) },
    };
    assert.equal(resultStatus(internal, ["f24"], now), "match");
    assert.match(e.url, /^https:\/\/www\.futbol24\.com\/match\//);
  }
});

test("AET uses the explicit second pair as 90 minutes and never adds shootout scores", () => {
  const data = clone(finished),
    aet = data.live.matches["3379356"];
  aet.score1 = "2-1";
  aet.score2 = "0-0, 1-1";
  const events = parseFutbol24(data, { date: "2026-11-11", now }),
    e = events.find((row) => row.id === "3379356");
  assert.equal(e.phase, "finished_extra_time");
  assert.equal(e.current, "2:1");
  assert.equal(e.regularTime, "1:1");
  assert.equal(e.halfTime, "0:0");
  assert.equal(eventReference(e, checkedAt).score, "1:1");
  for (const p of events.filter((event) => event.phase === "finished_penalties")) {
    assert.equal(p.regularTime, null);
    assert.equal(p.halfTime, null);
    assert.equal(eventReference(p, checkedAt).state, "unverified");
  }
  aet.score2 = "1-1";
  assert.equal(
    eventReference(
      parseFutbol24(data, { date: "2026-11-11", now }).find((row) => row.id === "3379356"),
      checkedAt,
    ).state,
    "unverified",
  );
});

test("unsupported periods, walkovers, postponements and missing scores cannot confirm results", () => {
  const events = [
    ...parseFutbol24(live, { date, now }),
    ...parseFutbol24(finished, { date: "2026-11-11", now }),
  ];
  for (const phase of ["awarded", "postponed", "cancelled", "unknown"]) {
    const event = events.find((e) => e.phase === phase);
    assert.ok(event, phase);
    assert.equal(eventReference(event, checkedAt).state, "unverified");
  }
  const data = clone(finished),
    m = data.live.matches["3438761"];
  delete m.score1;
  assert.equal(
    eventReference(
      parseFutbol24(data, { date: "2026-11-11", now }).find((e) => e.id === "3438761"),
      checkedAt,
    ).state,
    "unverified",
  );
});

test("half-time can use the current HT score but an absent finished half-time remains incomplete", () => {
  const data = clone(live),
    ht = Object.values(data.live.matches).find((m) => m.status_id === 3);
  delete ht.score2;
  const event = parseFutbol24(data, { date, now }).find((e) => e.phase === "half_time");
  assert.equal(event.halfTime, event.current);
  const complete = clone(finished);
  delete complete.live.matches["3438761"].score2;
  const missing = parseFutbol24(complete, { date: "2026-11-11", now }).find(
    (e) => e.id === "3438761",
  );
  assert.equal(
    resultStatus(
      { score: "6:0", ht: "3:0", refs: { f24: eventReference(missing, checkedAt) } },
      ["f24"],
      now,
    ),
    "unverified",
  );
});

test("live timestamps, HTTP age and date ranges are validated rather than refreshed by parsing", () => {
  assert.throws(
    () => parseFutbol24(live, { date, now: now + FRESH_MS + 1 }),
    (e) => e.code === "STALE_SOURCE",
  );
  assert.throws(
    () => parseFutbol24(live, { date, now: now - 30001 }),
    (e) => e.code === "INVALID_SOURCE_TIME",
  );
  assert.throws(
    () => parseFutbol24(finished, { date, now }),
    (e) => e.code === "DATE_MISMATCH",
  );
  assert.throws(
    () => parseFutbol24(finished, { date: "2026-11-11", now, sourceAgeMs: FRESH_MS + 1 }),
    (e) => e.code === "STALE_SOURCE",
  );
  const malformed = clone(live);
  Object.values(malformed.live.matches)[0].date = "2026-11-12T18:00:00";
  assert.throws(
    () => parseFutbol24(malformed, { date, now }),
    (e) => e.code === "FORMAT_CHANGED",
  );
  assert.throws(
    () => parseFutbol24({ live: { matches: [] } }, { date, now }),
    (e) => e.code === "FORMAT_CHANGED",
  );
});

test("calendar requests use Belgrade midnight offsets including both DST changes", () => {
  assert.equal(futbol24Midnight("2026-01-15"), "2026-01-15T00:00:00+01:00");
  assert.equal(futbol24Midnight("2026-07-15"), "2026-07-15T00:00:00+02:00");
  assert.equal(futbol24Midnight("2026-03-29"), "2026-03-29T00:00:00+01:00");
  assert.equal(futbol24Midnight("2026-10-25"), "2026-10-25T00:00:00+02:00");
  assert.throws(() => futbol24Midnight("2026-02-31"));
});

test("public requests follow website parameter order and use current, yesterday and dated views", async () => {
  const urls = [];
  const fake = async (url) => {
    urls.push(new URL(url));
    return {
      text: JSON.stringify(url.includes("/yesterday") ? finished : live),
      sourceAgeMs: 1000,
    };
  };
  await scrapeFutbol24({ date, now, fetchTextImpl: fake });
  await scrapeFutbol24({ date: "2026-11-11", now, fetchTextImpl: fake });
  assert.equal(urls[0].pathname, "/api/live");
  assert.deepEqual([...urls[0].searchParams.keys()], ["_", "lang", "sort", "tz"]);
  assert.equal(urls[0].searchParams.get("_"), "0");
  assert.equal(urls[0].searchParams.get("tz"), "+01:00");
  assert.equal(urls[1].pathname, "/api/live/yesterday");
  await scrapeFutbol24({
    date: "2026-11-11",
    now: now + 3 * 86400000,
    fetchTextImpl: async (url) => {
      urls.push(new URL(url));
      return { text: JSON.stringify(finished) };
    },
  });
  assert.equal(urls[2].pathname, "/api/live/matches");
  assert.deepEqual([...urls[2].searchParams.keys()], ["_", "date", "lang", "sort"]);
  assert.equal(urls[2].searchParams.get("date"), "2026-11-11T00:00:00+01:00");
});

test("only a wrong calendar view triggers a dated retry; access challenges and malformed data do not", async () => {
  let calls = 0;
  const events = await scrapeFutbol24({
    date,
    now,
    fetchTextImpl: async (url) => {
      calls++;
      return { text: JSON.stringify(calls === 1 ? finished : live) };
    },
  });
  assert.ok(events.length);
  assert.equal(calls, 2);
  for (const code of ["BLOCKED", "RATE_LIMIT", "STALE_SOURCE"]) {
    calls = 0;
    await assert.rejects(
      scrapeFutbol24({
        date,
        now,
        fetchTextImpl: async () => {
          calls++;
          throw new SourceError(code, "Unavailable");
        },
      }),
      (e) => e.code === code,
    );
    assert.equal(calls, 1);
  }
  calls = 0;
  await assert.rejects(
    scrapeFutbol24({
      date,
      now,
      fetchTextImpl: async () => {
        calls++;
        return { text: "<html>unexpected</html>" };
      },
    }),
    (e) => e.code === "FORMAT_CHANGED",
  );
  assert.equal(calls, 1);
});

test("the real Futbol24 schema flows through shared collection and exposes genuine score differences", async () => {
  const watch = {
    date: "2026-11-11",
    sources: ["f24"],
    matches: [
      {
        id: "one",
        sport: "Fudbal",
        time: "18:00",
        league: "Srpski naziv lige",
        match: "France U19 – Norway U19",
        score: "6:0",
        ht: "3:0",
        expectedStatus: "second_half",
        native: { market: "FT", phase: "2nd half" },
      },
    ],
  };
  const fetcher = async () =>
    new Response(JSON.stringify(finished), { headers: { "Content-Type": "application/json" } });
  const collector = createCollector({ clock: () => now, fetcher });
  const first = await collector.collect(watch),
    ref = first.results[0].refs.f24;
  assert.equal(first.health.f24.state, "available");
  assert.equal(ref.state, "verified");
  assert.equal(ref.score, "6:0");
  assert.equal(
    resultStatus({ ...watch.matches[0], refs: { f24: ref } }, watch.sources, now),
    "match",
  );
  assert.equal(
    resultStatus({ ...watch.matches[0], score: "5:0", refs: { f24: ref } }, watch.sources, now),
    "mismatch",
  );
});
