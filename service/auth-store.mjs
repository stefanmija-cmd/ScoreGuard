import fs from "node:fs/promises";
import path from "node:path";
export class SessionFileStore {
  constructor(directory, { clock = () => Date.now() } = {}) {
    this.filename = path.join(directory, "sessions.json");
    this.directory = directory;
    this.clock = clock;
    this.sessions = {};
    this.events = [];
    this.queue = Promise.resolve();
  }
  async init() {
    try {
      const saved = JSON.parse(await fs.readFile(this.filename, "utf8"));
      this.sessions = saved.sessions || {};
      this.events = saved.events || [];
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    this.prune();
  }
  prune() {
    const now = Math.floor(this.clock() / 1000);
    for (const [key, p] of Object.entries(this.sessions))
      if (p.exp <= now) delete this.sessions[key];
  }
  async save() {
    this.prune();
    const text = JSON.stringify({
      version: 1,
      sessions: this.sessions,
      events: this.events.slice(0, 1000),
    });
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        await fs.writeFile(this.filename + ".tmp", text, { mode: 0o600 });
        await fs.rename(this.filename + ".tmp", this.filename);
      });
    this.queue = task;
    return task;
  }
  async add(payload) {
    this.sessions[payload.nonce] = { id: payload.id, exp: payload.exp };
    this.events.unshift({
      at: new Date(this.clock()).toISOString(),
      operator: payload.id,
      action: "login",
    });
    await this.save();
  }
  async has(payload) {
    const p = this.sessions[payload.nonce];
    return !!p && p.id === payload.id && p.exp > Math.floor(this.clock() / 1000);
  }
  async remove(nonce) {
    const p = this.sessions[nonce];
    delete this.sessions[nonce];
    if (p)
      this.events.unshift({
        at: new Date(this.clock()).toISOString(),
        operator: p.id,
        action: "logout",
      });
    await this.save();
  }
}
