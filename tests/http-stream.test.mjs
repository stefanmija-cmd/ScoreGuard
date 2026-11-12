import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchText, SourceError } from "../scraper/http.mjs";
import { createCollector } from "../scraper/collector.mjs";

const encode = (text) => new TextEncoder().encode(text);

function interruptedResponse(error) {
  let chunks = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (chunks++ === 0) controller.enqueue(encode("partial source data"));
        else controller.error(error);
      },
    }),
  );
}

for (const [name, code] of [
  ["TimeoutError", "TIMEOUT"],
  ["AbortError", "TIMEOUT"],
  ["TypeError", "NETWORK"],
]) {
  test(`body stream ${name} becomes SourceError ${code} without returning partial data`, async () => {
    const response = interruptedResponse(Object.assign(new Error("stream interrupted"), { name }));
    await assert.rejects(
      fetchText("https://source.test", { fetcher: async () => response }),
      (error) => error instanceof SourceError && error.code === code,
    );
    assert.equal(response.body.locked, false);
  });
}

test("stream size limit remains TOO_LARGE even when canceling the connection fails", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encode("too much data"));
      },
      cancel() {
        return Promise.reject(new TypeError("connection closed"));
      },
    }),
  );
  await assert.rejects(
    fetchText("https://source.test", { maxBytes: 5, fetcher: async () => response }),
    (error) => error instanceof SourceError && error.code === "TOO_LARGE",
  );
  assert.equal(response.body.locked, false);
});

test("stream errors already classified as SourceError keep their original code", async () => {
  const original = new SourceError("TOO_LARGE", "already classified");
  const response = interruptedResponse(original);
  await assert.rejects(
    fetchText("https://source.test", { fetcher: async () => response }),
    (error) => error === original,
  );
});

test("a completed multichunk UTF-8 response retains content and cache age and releases the reader", async () => {
  const bytes = encode("Čukarički – Vitória"),
    chunks = [bytes.slice(0, 1), bytes.slice(1, 7), bytes.slice(7)];
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (chunks.length) controller.enqueue(chunks.shift());
        else controller.close();
      },
    }),
    { headers: { age: "42" } },
  );
  const result = await fetchText("https://source.test", { fetcher: async () => response });
  assert.equal(result.text, "Čukarički – Vitória");
  assert.equal(result.sourceAgeMs, 42000);
  assert.equal(response.body.locked, false);
});

test("collector reports stream failures as source errors while preserving a healthy second source", async () => {
  const event = {
    id: "fixture",
    home: "Colombe",
    away: "Victoria United",
    startTimestamp: Date.parse("2026-11-11T17:00:00Z") / 1000,
    state: "finished",
    phase: "finished",
    current: "1:0",
    halfTime: "0:0",
    regularTime: "1:0",
  };
  const collector = createCollector({
    clock: () => Date.parse("2026-11-11T20:00:00Z"),
    providers: {
      flash: async () => {
        await fetchText("https://source.test", {
          fetcher: async () => interruptedResponse(new TypeError("closed")),
        });
        return [event];
      },
      f24: async () => [event],
    },
  });
  const result = await collector.collect({
    date: "2026-11-11",
    sources: ["flash", "f24"],
    matches: [
      {
        id: "one",
        sport: "Fudbal",
        time: "18:00",
        match: "Colombe – Victoria United",
        league: "Liga",
        score: "1:0",
        ht: "0:0",
      },
    ],
  });
  assert.equal(result.health.flash.code, "NETWORK");
  assert.equal(result.results[0].refs.flash.state, "unverified");
  assert.equal(result.results[0].refs.f24.state, "verified");
});
