import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("collector searches the complete candidate pool when exact lookup returns only a reason", () => {
  // Isolate Node's ESM mock in a child process; production needs no test-only hooks.
  const modelUrl = new URL("../scraper/model.mjs", import.meta.url).href;
  const collectorUrl = new URL("../scraper/collector.mjs", import.meta.url).href;
  const script = `
    import { mock } from "node:test";
    import assert from "node:assert/strict";
    const model = await import(${JSON.stringify(modelUrl)});
    const calls = [];
    mock.module(${JSON.stringify(modelUrl)}, {
      namedExports: {
        ...model,
        matchEvent(...args) {
          calls.push(args[1].map(event => event.id));
          if (calls.length === 1) return { reason: "Exact lookup did not resolve an event" };
          return model.matchEvent(...args);
        }
      }
    });
    const { createCollector } = await import(${JSON.stringify(collectorUrl)});
    const event = { id: "exact", home: "Colombe", away: "Victoria United", startTimestamp: Date.parse("2026-11-11T17:00:00Z") / 1000, state: "finished", phase: "finished", current: "1:0", halfTime: "0:0", regularTime: "1:0" };
    const collector = createCollector({
      clock: () => Date.parse("2026-11-11T20:00:00Z"),
      providers: { flash: async () => [event, { ...event, id: "other", home: "Colombes" }] }
    });
    const result = await collector.collect({ date: "2026-11-11", sources: ["flash"], matches: [{ id: "one", sport: "Fudbal", time: "18:00", match: "Colombe – Victoria United", league: "Liga", score: "1:0", ht: "0:0" }] });
    assert.equal(calls.length, 2, "A reason-only lookup must not suppress the candidate search");
    assert.deepEqual(calls[0], ["exact"]);
    assert.deepEqual(new Set(calls[1]), new Set(["exact", "other"]));
    assert.equal(result.results[0].refs.flash.state, "verified");
    assert.equal(result.results[0].refs.flash.eventId, "exact");
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--no-warnings", "--input-type=module", "-"],
    { input: script, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
