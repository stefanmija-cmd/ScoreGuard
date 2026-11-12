import { normalizeName } from "./model.mjs";
export const TEAM_LINK_SOURCES = new Set(["flash", "f24", "api", "all"]);
export function normalizeTeamLink(raw, { allowLegacy = false } = {}) {
  if (!raw || (!TEAM_LINK_SOURCES.has(raw.source) && !(allowLegacy && raw.source === "sofa")))
    throw Error("Izaberite Flashscore, Futbol24, API-Football ili sve izvore.");
  const names = {};
  for (const key of ["internalName", "sourceName"]) {
    if (
      typeof raw[key] !== "string" ||
      !raw[key].trim() ||
      raw[key].length > 150 ||
      /[\x00-\x1f\x7f]/.test(raw[key])
    )
      throw Error("Unesite oba naziva kluba, najviše 150 znakova po nazivu.");
    names[key] = raw[key].trim();
    if (!normalizeName(names[key])) throw Error("Naziv kluba mora sadržati slova ili brojeve.");
  }
  if (normalizeName(names.internalName) === normalizeName(names.sourceName))
    throw Error("Ovi nazivi se već automatski poklapaju; povezivanje nije potrebno.");
  if (raw.confirmed !== true)
    throw Error("Potvrdite da oba naziva označavaju isti klub i istu selekciju.");
  const age = (name) => name.match(/\b(?:u|under)[\s-]?(\d{1,2})\b/i)?.[1];
  if (
    age(names.internalName) &&
    age(names.sourceName) &&
    age(names.internalName) !== age(names.sourceName)
  )
    throw Error("Različite uzrasne selekcije ne mogu biti isti tim.");
  return { source: raw.source, ...names };
}
export function teamLinkKey(link) {
  return (
    link.source +
    ":" +
    [normalizeName(link.internalName), normalizeName(link.sourceName)].sort().join("|")
  );
}
export function compileTeamAliases(configured = {}, links = []) {
  const result = {};
  for (const source of ["flash", "f24", "api"]) {
    const parent = new Map();
    const targets = new Map();
    function root(name) {
      if (!parent.has(name)) parent.set(name, name);
      const p = parent.get(name);
      if (p !== name) parent.set(name, root(p));
      return parent.get(name);
    }
    function join(a, b) {
      const label = String(b ?? "");
      a = normalizeName(a);
      b = normalizeName(b);
      if (!a || !b) return;
      if (!targets.has(b) || targets.get(b) === b) targets.set(b, label);
      const x = root(a),
        y = root(b);
      if (x !== y) parent.set(x < y ? y : x, x < y ? x : y);
    }
    for (const [name, canonical] of Object.entries(configured[source]?.teams || {}))
      join(name, canonical);
    for (const link of links)
      if (link.source === source || link.source === "all") join(link.internalName, link.sourceName);
    // Keep the declared target's readable name: normalizing it would erase
    // category boundaries such as the space before U19, Women or II.
    const canonicalNames = new Map();
    for (const [name, label] of targets) {
      const group = root(name),
        existing = canonicalNames.get(group);
      if (!existing || name < normalizeName(existing)) canonicalNames.set(group, label);
    }
    result[source] = {
      ...(configured[source] || {}),
      teams: Object.fromEntries(
        [...parent.keys()].map((name) => [name, canonicalNames.get(root(name)) || root(name)]),
      ),
    };
  }
  return result;
}
