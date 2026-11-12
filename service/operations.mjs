import { createHash, randomUUID } from "node:crypto";
import { StateDocument } from "./persistence.mjs";
import { compareResult, normalizeName, referenceFresh } from "../scraper/model.mjs";

export function fixtureKey(match, date) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        match.date || date,
        match.time,
        match.internalId || normalizeName(match.match),
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}
export function evidenceSignature(match, refs) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        match.score,
        match.ht,
        match.expectedStatus,
        ...Object.entries(refs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([source, r]) => [
            source,
            r.state,
            r.score,
            r.ht,
            r.phase,
            r.eventState,
            r.state === "verified" ? "" : String(r.reason || "").slice(0, 240),
          ]),
      ]),
    )
    .digest("hex");
}
function observation(match, date, sources, refs, importedAt, at) {
  const internal = {
    score: match.score,
    ht: match.ht,
    expectedStatus: match.expectedStatus,
    inputFormat: match.inputFormat,
    ...(match.native ? { native: { market: match.native.market, phase: match.native.phase } } : {}),
  };
  const compact = Object.fromEntries(
    sources.map((source) => {
      const r = refs[source] || { state: "unverified" };
      return [
        source,
        Object.fromEntries(
          [
            "state",
            "score",
            "ht",
            "htRequired",
            "phase",
            "phaseLabel",
            "eventState",
            "checkedAt",
            "reason",
          ]
            .filter((key) => r[key] !== undefined)
            .map((key) => [key, key === "reason" ? String(r[key]).slice(0, 240) : r[key]]),
        ),
      ];
    }),
  );
  return {
    date: match.date || date,
    time: match.time,
    match: match.match,
    league: match.league,
    internalId: match.internalId || null,
    internal,
    refs: compact,
    sources,
    importedAt,
    at,
    signature: evidenceSignature(internal, compact),
  };
}
function failure(message, status = 409) {
  const error = Error(message);
  error.status = status;
  return error;
}

export class OperationsStore {
  constructor(directory, { clock = () => Date.now(), historyLimit = 2000 } = {}) {
    this.directory = directory;
    this.document = new StateDocument(directory, "operations");
    this.historyDocuments = new Map();
    this.clock = clock;
    this.historyLimit = historyLimit;
    this.state = { version: 1, cases: {}, histories: {} };
    this.queue = Promise.resolve();
  }
  get status() {
    return (
      [this.document, ...this.historyDocuments.values()]
        .map((doc) => doc.status)
        .find((status) => !["ready", "starting"].includes(status.state)) || this.document.status
    );
  }
  async historyDocument(operator) {
    if (!/^[a-zA-Z0-9_.:@-]{1,200}$/.test(operator)) throw Error("Neispravan identitet istorije.");
    if (!this.historyDocuments.has(operator)) {
      const doc = new StateDocument(this.directory, "history-" + operator);
      doc.initialValue = await doc.load();
      this.historyDocuments.set(operator, doc);
    }
    return this.historyDocuments.get(operator);
  }
  async init() {
    const saved = await this.document.load();
    if (saved) {
      if (saved.version !== 1 || !saved.cases || Array.isArray(saved.cases))
        throw Error("Neispravna evidencija obrade.");
      this.state = { version: 1, cases: saved.cases, histories: saved.histories || {} };
      await Promise.all(
        (saved.historyOperators || []).map(async (operator) => {
          const doc = await this.historyDocument(operator),
            history = doc.initialValue;
          delete doc.initialValue;
          if (history) this.state.histories[operator] = history;
        }),
      );
      for (const [operator, history] of Object.entries(saved.histories || {})) {
        const doc = await this.historyDocument(operator);
        if (!doc.initialValue) await doc.save(history);
        delete doc.initialValue;
      }
    }
    await this.migrateSource();
  }
  async migrateSource() {
    const needsMigration = Object.values(this.state.cases).some((item) =>
      Object.values(item.observations || {}).some(
        (obs) => obs.sources?.includes("sofa") || obs.refs?.sofa,
      ),
    );
    if (!needsMigration) return;
    await this.mutate((state) => {
      for (const item of Object.values(state.cases))
        for (const obs of Object.values(item.observations || {})) {
          if (!obs.sources?.includes("sofa") && !obs.refs?.sofa) continue;
          obs.sources = obs.sources.map((source) => (source === "sofa" ? "f24" : source));
          delete obs.refs.sofa;
          obs.refs.f24 = {
            state: "unverified",
            reason: "Izvor je promenjen na Futbol24. Potrebna je nova provera.",
            checkedAt: new Date(this.clock()).toISOString(),
          };
          obs.signature = evidenceSignature(obs.internal, obs.refs);
          item.version++;
        }
    });
  }
  mutate(change, historyOperator = null) {
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        const next = {
          ...this.state,
          cases: structuredClone(this.state.cases),
          histories: { ...this.state.histories },
        };
        if (historyOperator && next.histories[historyOperator])
          next.histories[historyOperator] = structuredClone(next.histories[historyOperator]);
        const result = change(next);
        if (
          historyOperator &&
          JSON.stringify(next.histories[historyOperator]) !==
            JSON.stringify(this.state.histories[historyOperator])
        ) {
          const doc = await this.historyDocument(historyOperator);
          delete doc.initialValue;
          await doc.save(next.histories[historyOperator]);
        }
        const document = {
          version: 1,
          cases: next.cases,
          historyOperators: Object.keys(next.histories).sort(),
        };
        const previous = {
          version: 1,
          cases: this.state.cases,
          historyOperators: Object.keys(this.state.histories).sort(),
        };
        if (JSON.stringify(document) !== JSON.stringify(previous))
          await this.document.save(document);
        this.state = next;
        return result;
      });
    this.queue = job;
    return job;
  }
  async recordCheck(operator, watch, result, importedAt) {
    const at = new Date(this.clock()).toISOString(),
      byId = new Map((result.results || []).map((m) => [m.id, m.refs]));
    return this.mutate((state) => {
      const history =
        state.histories[operator] || (state.histories[operator] = { events: [], signatures: {} });
      const activeKeys = new Set();
      for (const match of watch.matches) {
        const key = fixtureKey(match, watch.date),
          obs = observation(
            match,
            watch.date,
            watch.sources,
            byId.get(match.id) || {},
            importedAt,
            at,
          );
        activeKeys.add(key);
        const comparison = compareResult(
          { ...obs.internal, refs: obs.refs },
          obs.sources,
          this.clock(),
        );
        if (history.signatures[key] !== obs.signature) {
          history.events.unshift({
            key,
            ...obs,
            comparisonStatus: comparison.status,
            comparisonReason: comparison.reason,
          });
          history.signatures[key] = obs.signature;
        }
        let item = state.cases[key];
        if (!item && comparison.status === "mismatch") {
          item = state.cases[key] = {
            id: key,
            workStatus: "new",
            owner: null,
            ownerName: null,
            version: 1,
            firstSeen: at,
            lastSeen: at,
            lastIssueSignature: obs.signature,
            observations: {},
            events: [{ id: randomUUID(), action: "opened", at, operator }],
          };
        }
        if (item) {
          const changed = item.observations[operator]?.signature !== obs.signature;
          if (
            item.workStatus === "resolved" &&
            comparison.status === "mismatch" &&
            item.lastIssueSignature !== obs.signature
          ) {
            item.workStatus = "new";
            item.owner = null;
            item.ownerName = null;
            item.events.unshift({ id: randomUUID(), action: "reopened", at, operator });
          }
          if (comparison.status === "mismatch") item.lastIssueSignature = obs.signature;
          item.observations[operator] = obs;
          item.lastSeen = at;
          if (changed) item.version++;
          item.events = item.events.slice(0, 100);
        }
      }
      history.events = history.events
        .filter((e) => this.clock() - Date.parse(e.at) < 14 * 86400000)
        .slice(0, this.historyLimit);
      history.signatures = Object.fromEntries(
        Object.entries(history.signatures).filter(([key]) => activeKeys.has(key)),
      );
      for (const [key, item] of Object.entries(state.cases))
        if (
          item.workStatus === "resolved" &&
          this.clock() - Date.parse(item.lastSeen) > 14 * 86400000
        )
          delete state.cases[key];
      return { events: history.events.length };
    }, operator);
  }
  caseForMatch(match, date) {
    const item = this.state.cases[fixtureKey(match, date)];
    return item
      ? {
          id: item.id,
          workStatus: item.workStatus,
          owner: item.owner,
          ownerName: item.ownerName,
          version: item.version,
        }
      : null;
  }
  history(operator, key) {
    return structuredClone(
      (this.state.histories[operator]?.events || [])
        .filter((event) => event.key === key)
        .slice(0, 50),
    );
  }
  exportHistory(operator) {
    return structuredClone(
      (this.state.histories[operator]?.events || []).slice(0, this.historyLimit),
    );
  }
  validateHistory(events) {
    if (!Array.isArray(events) || events.length > this.historyLimit)
      throw Error("Neispravna istorija u rezervnoj kopiji.");
    return events.map((event) => {
      if (
        !event ||
        !/^[a-f0-9]{32}$/.test(event.key) ||
        typeof event.match !== "string" ||
        event.match.length > 200 ||
        typeof event.at !== "string" ||
        !Number.isFinite(Date.parse(event.at)) ||
        !event.internal ||
        typeof event.internal !== "object" ||
        Array.isArray(event.internal) ||
        !event.refs ||
        typeof event.refs !== "object" ||
        Array.isArray(event.refs) ||
        !Array.isArray(event.sources) ||
        event.sources.some((s) => !["flash", "f24", "api", "sofa"].includes(s))
      )
        throw Error("Neispravna istorija u rezervnoj kopiji.");
      const copy = JSON.parse(JSON.stringify(event));
      if (JSON.stringify(copy).length > 6000)
        throw Error("Prevelik zapis istorije u rezervnoj kopiji.");
      return copy;
    });
  }
  async restoreHistory(operator, events) {
    // Restored history is labelled explicitly; it never creates verified references or claims.
    const restored = this.validateHistory(events).map((event) => ({
      ...event,
      restoredAt: new Date(this.clock()).toISOString(),
      restoredBy: operator,
    }));
    return this.mutate((state) => {
      const old = state.histories[operator] || { events: [], signatures: {} },
        unique = new Map();
      for (const event of [...old.events, ...restored]) {
        const key = [event.key, event.signature, event.at].join("|");
        if (!unique.has(key)) unique.set(key, event);
      }
      old.events = [...unique.values()]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, this.historyLimit);
      state.histories[operator] = old;
    }, operator);
  }
  board({ offset = 0, limit = 100, includeResolved = false, owner = "", query = "" } = {}) {
    const rows = Object.values(this.state.cases)
      .filter(
        (c) =>
          (includeResolved || c.workStatus !== "resolved") &&
          (!owner || (owner === "unassigned" ? !c.owner : c.owner === owner)),
      )
      .map((c) => {
        const observations = Object.entries(c.observations).map(([operator, obs]) => ({
          operator,
          ...obs,
          ...compareResult({ ...obs.internal, refs: obs.refs }, obs.sources, this.clock()),
        }));
        const evidence =
          observations.find((obs) => obs.status === "mismatch") ||
          observations.find((obs) => obs.status === "unverified") ||
          observations.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
        const finished = Object.values(evidence?.refs || {}).some(
          (r) =>
            r.eventState === "finished" &&
            r.state === "verified" &&
            referenceFresh(r, this.clock()),
        );
        return {
          id: c.id,
          workStatus: c.workStatus,
          owner: c.owner,
          ownerName: c.ownerName,
          version: c.version,
          firstSeen: c.firstSeen,
          lastSeen: c.lastSeen,
          events: c.events.slice(0, 20),
          comparisonStatus: evidence?.status || "unverified",
          comparisonReason: evidence?.reason || "",
          priority: evidence?.status === "mismatch" ? (finished ? 0 : 1) : 2,
          evidence,
          operatorCount: observations.length,
        };
      })
      .filter(
        (row) =>
          !query ||
          [row.evidence?.match, row.evidence?.league, row.evidence?.internalId]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      )
      .sort((a, b) => a.priority - b.priority || Date.parse(a.firstSeen) - Date.parse(b.firstSeen));
    return {
      total: rows.length,
      offset,
      limit,
      cases: structuredClone(rows.slice(offset, offset + limit)),
    };
  }
  async action(id, action, user, { version, note = "" } = {}) {
    if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))
      throw failure("Slučaj nije pronađen.", 404);
    if (!["claim", "release", "resolve", "reopen"].includes(action))
      throw failure("Izaberite ispravnu radnju.", 400);
    if (typeof note !== "string" || note.length > 1000)
      throw failure("Napomena može imati najviše 1000 znakova.", 400);
    return this.mutate((state) => {
      const item = state.cases[id];
      if (!item) throw failure("Slučaj nije pronađen.", 404);
      if (version !== item.version)
        throw failure("Slučaj je u međuvremenu izmenjen. Osvežite pregled.");
      if (action === "claim") {
        if (item.workStatus === "resolved")
          throw failure("Ponovo otvorite slučaj pre preuzimanja.");
        if (item.owner && item.owner !== user.id)
          throw failure("Slučaj već obrađuje " + item.ownerName + ".");
        item.workStatus = "in_progress";
        item.owner = user.id;
        item.ownerName = user.name;
      } else if (action === "release") {
        if (item.owner !== user.id && user.role !== "admin")
          throw failure("Slučaj može osloboditi njegov operater ili administrator.");
        item.workStatus = "new";
        item.owner = null;
        item.ownerName = null;
      } else if (action === "resolve") {
        if (item.owner !== user.id && user.role !== "admin")
          throw failure("Najpre preuzmite slučaj.");
        if (!note.trim()) throw failure("Za zatvaranje upišite šta ste proverili.", 400);
        item.workStatus = "resolved";
      } else {
        if (item.workStatus !== "resolved") throw failure("Slučaj je već otvoren.");
        item.workStatus = "new";
        item.owner = null;
        item.ownerName = null;
      }
      item.version++;
      item.events.unshift({
        id: randomUUID(),
        action,
        at: new Date(this.clock()).toISOString(),
        operator: user.id,
        name: user.name,
        note: note.trim(),
      });
      item.events = item.events.slice(0, 100);
      return {
        id: item.id,
        workStatus: item.workStatus,
        owner: item.owner,
        ownerName: item.ownerName,
        version: item.version,
      };
    });
  }
}
