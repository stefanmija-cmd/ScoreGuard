import fs from "node:fs/promises";
import path from "node:path";

// One writer per Streamlit instance. Optional Supabase documents survive instance replacement.
export class StateDocument {
  constructor(
    directory,
    name,
    {
      fetcher = globalThis.fetch,
      url = process.env.SCOREGUARD_STORAGE_URL || "",
      key = process.env.SCOREGUARD_STORAGE_KEY || "",
      namespace = process.env.SCOREGUARD_STORAGE_NAMESPACE || "scoreguard",
    } = {},
  ) {
    this.filename = path.join(directory, name + ".json");
    this.name = name;
    this.fetcher = fetcher;
    this.queue = Promise.resolve();
    this.revision = null;
    if (!!url !== !!key)
      throw Error(
        "Trajna baza zahteva oba podešavanja: SCOREGUARD_STORAGE_URL i SCOREGUARD_STORAGE_KEY.",
      );
    if (url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {}
      if (
        !parsed ||
        parsed.protocol !== "https:" ||
        !parsed.hostname.endsWith(".supabase.co") ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        !["", "/"].includes(parsed.pathname) ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(namespace) ||
        key.length < 20 ||
        /\s/.test(key)
      )
        throw Error("Proverite podešavanja trajne baze u Secrets.");
      this.url = parsed.origin + "/rest/v1/scoreguard_state";
      this.key = key;
      this.id = namespace + ":" + name;
    }
    this.status = { mode: url ? "supabase" : "local", durable: !!url, state: "starting" };
  }
  async request(method, query = "", body) {
    let response;
    try {
      response = await this.fetcher(this.url + query, {
        method,
        headers: {
          apikey: this.key,
          Authorization: "Bearer " + this.key,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
    } catch {
      this.status.state = "error";
      throw Error("Trajna baza nije dostupna. Podaci nisu potvrđeno sačuvani.");
    }
    if (!response.ok) {
      this.status.state = "error";
      throw Error(
        "Trajna baza nije izvršila zahtev (HTTP " +
          response.status +
          "). Proverite SQL podešavanje i Secrets.",
      );
    }
    try {
      return await response.json();
    } catch {
      this.status.state = "error";
      throw Error("Trajna baza je vratila neispravan odgovor.");
    }
  }
  async local() {
    try {
      return JSON.parse(await fs.readFile(this.filename, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async load() {
    if (!this.url) {
      const value = await this.local();
      this.status.state = "ready";
      return value;
    }
    const rows = await this.request(
      "GET",
      "?id=eq." + encodeURIComponent(this.id) + "&select=payload,revision",
    );
    if (!Array.isArray(rows) || rows.length > 1) throw Error("Neispravan zapis trajne baze.");
    if (rows.length) {
      if (!Number.isSafeInteger(rows[0].revision) || rows[0].revision < 1)
        throw Error("Neispravna revizija trajne baze.");
      this.revision = rows[0].revision;
      this.status.state = "ready";
      return rows[0].payload;
    }
    const local = await this.local();
    this.revision = 0;
    // Migrate only into a document that is absent, never overwrite an existing remote state.
    if (local !== null) await this.save(local);
    this.status.state = "ready";
    return local;
  }
  save(value) {
    const snapshot = JSON.stringify(value);
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.url) {
          if (this.revision === null) throw Error("Trajna baza nije učitana.");
          const next = this.revision + 1;
          const rows = await this.request(
            this.revision === 0 ? "POST" : "PATCH",
            this.revision === 0
              ? "?select=revision"
              : "?id=eq." +
                  encodeURIComponent(this.id) +
                  "&revision=eq." +
                  this.revision +
                  "&select=revision",
            {
              ...(this.revision === 0 ? { id: this.id } : {}),
              payload: JSON.parse(snapshot),
              revision: next,
              updated_at: new Date().toISOString(),
            },
          );
          if (!Array.isArray(rows) || rows.length !== 1 || rows[0].revision !== next) {
            this.status.state = "conflict";
            throw Error(
              "Podatke u bazi je promenila druga instanca. Osvežite servis pre narednog upisa.",
            );
          }
          this.revision = next;
        } else {
          await fs.mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
          await fs.writeFile(this.filename + ".tmp", snapshot, { mode: 0o600 });
          await fs.rename(this.filename + ".tmp", this.filename);
        }
        this.status.state = "ready";
      });
    this.queue = job;
    return job;
  }
}
