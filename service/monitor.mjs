import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { INTERVAL_MS, validateWatch } from "../scraper/model.mjs";
import { StateDocument } from "./persistence.mjs";
import { fixtureKey } from "./operations.mjs";
export function watchRevision(watch) {
  return createHash("sha256").update(JSON.stringify(watch)).digest("hex");
}
export class FileStore {
  constructor(directory) {
    this.directory = directory;
    this.document = new StateDocument(directory, "monitor");
    this.filename = this.document.filename;
    this.documents = new Map();
    this.saved = new Map();
    this.index = "";
    this.queue = Promise.resolve();
  }
  get status() {
    const problem = [this.document, ...this.documents.values()]
      .map((d) => d.status)
      .find((s) => !["ready", "starting"].includes(s.state));
    return problem || this.document.status;
  }
  async operatorDocument(operator) {
    if (!/^[a-zA-Z0-9_.:@-]{1,200}$/.test(operator))
      throw Error("Neispravan identitet u sačuvanim podacima.");
    if (!this.documents.has(operator)) {
      const doc = new StateDocument(this.directory, "watch-" + operator);
      doc.initialValue = await doc.load();
      this.documents.set(operator, doc);
    }
    return this.documents.get(operator);
  }
  async load() {
    const data = await this.document.load();
    if (!data) return {};
    if (data.version === 1 && data.watches && typeof data.watches === "object") return data.watches;
    if (data.version !== 2 || !Array.isArray(data.operators) || data.operators.length > 100)
      throw Error("Neispravan format sačuvanih podataka.");
    this.index = JSON.stringify(data.operators);
    const watches = Object.create(null);
    await Promise.all(
      data.operators.map(async (operator) => {
        const doc = await this.operatorDocument(operator),
          record = doc.initialValue;
        delete doc.initialValue;
        if (!record) throw Error("Nedostaje sačuvani spisak operatera.");
        watches[operator] = record;
        this.saved.set(operator, JSON.stringify(record));
      }),
    );
    return watches;
  }
  save(watches) {
    const snapshot = JSON.stringify(watches);
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        const values = JSON.parse(snapshot),
          operators = Object.keys(values).sort();
        for (const operator of operators) {
          const text = JSON.stringify(values[operator]);
          if (this.saved.get(operator) !== text) {
            const doc = await this.operatorDocument(operator);
            delete doc.initialValue;
            await doc.save(values[operator]);
            this.saved.set(operator, text);
          }
        }
        const index = JSON.stringify(operators);
        if (index !== this.index) {
          await this.document.save({ version: 2, operators });
          this.index = index;
        }
      });
    this.queue = job;
    return job;
  }
}
export class Monitor {
  constructor({
    collector,
    store,
    teamAliases = null,
    operations = null,
    clock = () => Date.now(),
    intervalMs = INTERVAL_MS,
    maxOperators = 100,
  }) {
    this.collector = collector;
    this.store = store;
    this.teamAliases = teamAliases;
    this.operations = operations;
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.maxOperators = maxOperators;
    this.watches = {};
    this.inflight = new Map();
    this.inflightGenerations = new Map();
    this.generation = 0;
    this.timer = null;
    this.ticking = false;
  }
  async init() {
    this.watches = await this.store.load();
    let migrated = false;
    for (const [operator, record] of Object.entries(this.watches)) {
      const validated = validateWatch(record.watch),
        legacy = record.watch.sources.includes("sofa");
      if (legacy) {
        record.watch = validated;
        record.revision = watchRevision(validated);
        record.lastResult = null;
        record.nextCheckAt = record.enabled ? this.clock() : null;
        record.sourceMigration = "sofa-to-f24";
        migrated = true;
      }
      record.running = false;
      record.generation = ++this.generation;
      if (this.teamAliases && record.aliasRevision !== this.teamAliases.revision(operator)) {
        record.lastResult = null;
        record.aliasRevision = this.teamAliases.revision(operator);
        record.nextCheckAt = record.enabled ? this.clock() : null;
      }
    }
    if (migrated) await this.store.save(this.watches);
  }
  async configure(operator, config, { enabled = true, imported = false } = {}) {
    const watch = validateWatch(config),
      revision = watchRevision(watch),
      old = this.watches[operator];
    if (!old && Object.keys(this.watches).length >= this.maxOperators)
      throw Error("Dostignut je maksimalan broj operatera.");
    if (old?.revision === revision && old.enabled === enabled && !imported)
      return this.snapshot(operator);
    const inputSignature = (w) =>
        JSON.stringify([w.date, w.matches.map(({ id, ...match }) => match)]),
      inputChanged = !old || inputSignature(old.watch) !== inputSignature(watch);
    this.watches[operator] = {
      watch,
      revision,
      generation: ++this.generation,
      enabled,
      lastResult: old?.revision === revision ? old.lastResult : null,
      checks: old?.checks || [],
      reviews: Object.fromEntries(
        Object.entries(old?.reviews || {}).filter(([id]) => watch.matches.some((m) => m.id === id)),
      ),
      reviewEvents: old?.reviewEvents || [],
      aliasRevision: this.teamAliases?.revision(operator) || null,
      running: false,
      nextCheckAt: enabled ? this.clock() : null,
      importedAt:
        imported || inputChanged ? new Date(this.clock()).toISOString() : old?.importedAt || null,
      updatedAt: new Date(this.clock()).toISOString(),
    };
    await this.store.save(this.watches);
    return this.snapshot(operator);
  }
  async pause(operator) {
    const record = this.watches[operator];
    if (!record) return null;
    record.enabled = false;
    record.nextCheckAt = null;
    record.generation = ++this.generation;
    record.running = false;
    await this.store.save(this.watches);
    return this.snapshot(operator);
  }
  async matchingChanged(operator) {
    const record = this.watches[operator];
    if (!record) return;
    record.generation = ++this.generation;
    record.lastResult = null;
    record.aliasRevision = this.teamAliases?.revision(operator) || null;
    record.running = this.inflight.has(operator);
    record.nextCheckAt = record.enabled ? this.clock() : null;
    record.updatedAt = new Date(this.clock()).toISOString();
    await this.store.save(this.watches);
  }
  snapshot(operator) {
    const r = this.watches[operator];
    if (!r) return null;
    return {
      watch: r.watch,
      revision: r.revision,
      enabled: r.enabled,
      running: r.running,
      lastResult: r.lastResult,
      nextCheckAt: r.nextCheckAt ? new Date(r.nextCheckAt).toISOString() : null,
      importedAt: r.importedAt || null,
      cases: this.operations
        ? Object.fromEntries(
            r.watch.matches.map((m) => [m.id, this.operations.caseForMatch(m, r.watch.date)]),
          )
        : {},
      checks: r.checks.slice(0, 50),
      reviews: r.reviews || {},
      reviewEvents: r.reviewEvents || [],
      intervalSeconds: this.intervalMs / 1000,
    };
  }
  history(operator, matchId) {
    const record = this.watches[operator],
      match = record?.watch.matches.find((m) => m.id === matchId);
    if (!match) throw Error("Meč nije na vašem aktivnom spisku.");
    return this.operations?.history(operator, fixtureKey(match, record.watch.date)) || [];
  }
  async review(operator, { matchId, note, actorName }) {
    const record = this.watches[operator];
    if (!record || !record.watch.matches.some((m) => m.id === matchId))
      throw Error("Meč više nije na aktivnom spisku. Osvežite pregled.");
    if (typeof note !== "string" || !note.trim() || note.length > 1000)
      throw Error("Unesite napomenu od 1 do 1000 znakova.");
    const match = record.watch.matches.find((m) => m.id === matchId);
    const review = {
      operator,
      name: actorName || operator,
      note: note.trim(),
      at: new Date(this.clock()).toISOString(),
      match: match.match,
      internalId: match.internalId || null,
    };
    record.reviews = { ...(record.reviews || {}), [matchId]: review };
    record.reviewEvents = [{ matchId, ...review }, ...(record.reviewEvents || [])].slice(0, 500);
    await this.store.save(this.watches);
    return review;
  }
  check(operator, { trigger = "manual", revision } = {}) {
    const record = this.watches[operator];
    if (!record) return Promise.reject(Error("Operater nema konfigurisan spisak mečeva."));
    if (revision && record.revision !== revision)
      return Promise.reject(Error("Spisak je promenjen. Osvežite pregled pre provere."));
    if (this.inflight.has(operator)) {
      const active = this.inflight.get(operator);
      if (this.inflightGenerations.get(operator) === record.generation) return active;
      return active.catch(() => {}).then(() => this.check(operator, { trigger, revision }));
    }
    const generation = record.generation;
    const promise = (async () => {
      record.running = true;
      const start = this.clock();
      record.nextCheckAt = record.enabled ? start + this.intervalMs : null;
      let result;
      try {
        result = await this.collector.collect(record.watch, {
          teamAliases:
            this.teamAliases?.effective?.(operator) || this.teamAliases?.list(operator) || [],
          trigger,
        });
      } catch (error) {
        const checkedAt = new Date(this.clock()).toISOString();
        result = {
          checkedAt,
          startedAt: new Date(start).toISOString(),
          results: record.watch.matches.map((m) => ({
            id: m.id,
            refs: Object.fromEntries(
              record.watch.sources.map((s) => [
                s,
                { state: "unverified", reason: "Provera nije uspela.", checkedAt },
              ]),
            ),
          })),
          health: Object.fromEntries(
            record.watch.sources.map((s) => [
              s,
              { state: "unavailable", code: "CHECK_FAILED", message: "Provera nije uspela." },
            ]),
          ),
        };
      }
      if (this.watches[operator]?.generation !== generation)
        return { discarded: true, reason: "Spisak ili režim rada je promenjen tokom provere." };
      record.lastResult = { ...result, operator, trigger, revision: record.revision };
      record.running = false;
      if (this.operations)
        await this.operations.recordCheck(
          operator,
          record.watch,
          record.lastResult,
          record.importedAt || null,
        );
      record.checks.unshift({
        at: new Date(this.clock()).toISOString(),
        operator,
        trigger,
        revision: record.revision,
        health: result.health,
      });
      record.checks = record.checks.slice(0, 500);
      await this.store.save(this.watches);
      return record.lastResult;
    })().finally(() => {
      this.inflight.delete(operator);
      this.inflightGenerations.delete(operator);
      if (this.watches[operator] === record) record.running = false;
    });
    this.inflight.set(operator, promise);
    this.inflightGenerations.set(operator, generation);
    return promise;
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = Object.entries(this.watches).filter(
        ([operator, r]) =>
          r.enabled && r.nextCheckAt <= this.clock() && !this.inflight.has(operator),
      );
      for (const [operator] of due) {
        const current = this.watches[operator];
        if (current?.enabled && current.nextCheckAt <= this.clock() && !this.inflight.has(operator))
          await this.check(operator, { trigger: "scheduled" });
      }
    } finally {
      this.ticking = false;
    }
  }
  start() {
    if (this.timer) return;
    const tick = () => this.tick().catch((e) => console.error("Scheduler error:", e.message));
    this.timer = setInterval(tick, 1000);
    tick();
  }
  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.inflight.values()]);
    await this.store.save(this.watches);
  }
}
