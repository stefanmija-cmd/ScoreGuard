import { dateKey, shiftDate, validDate, normalizeScore, FRESH_MS } from "../model.mjs";
import { fetchText, SourceError } from "../http.mjs";

const futbolOffsetFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  timeZoneName: "longOffset",
});
export function futbol24Midnight(date) {
  if (!validDate(date)) throw new SourceError("INVALID_DATE", "Neispravan datum za Futbol24.");
  const zone = futbolOffsetFormatter
    .formatToParts(new Date(date + "T00:00:00Z"))
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = zone === "GMT" ? "+00:00" : zone?.slice(3);
  if (!/^[+-]\d{2}:\d{2}$/.test(offset || ""))
    throw new SourceError("INVALID_DATE", "Vremenska zona za Futbol24 nije dostupna.");
  return date + "T00:00:00" + offset;
}
function futbolObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function futbolTime(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value)
    : NaN;
}
function futbolPhase(status) {
  if (!futbolObject(status)) return ["unknown", "unknown"];
  const ended = status.is_ended === true,
    playing = status.in_play === true,
    name = String(status.name || "").trim();
  if (playing && !ended) {
    if (name === "1-45") return ["live", "first_half"];
    if (name === "HT") return ["live", "half_time"];
    if (name === "46-90") return ["live", "second_half"];
    if (/^(?:ET|1st ET|2nd ET|HT ET|ET HT)$/.test(name)) return ["live", "extra_time"];
  }
  if (ended && !playing) {
    if (name === "FT") return ["finished", "finished"];
    if (name === "AET") return ["finished", "finished_extra_time"];
    if (name === "AP" || name === "AP w/ET") return ["finished", "finished_penalties"];
    if (name === "Postp.") return ["postponed", "postponed"];
    if (name === "Cancelled") return ["cancelled", "cancelled"];
    if (name === "Abandoned" || name === "Interrupted" || name === "Suspended")
      return ["interrupted", "interrupted"];
    if (name === "Walkover") return ["awarded", "awarded"];
  }
  if (name === "---" && !ended && !playing) return ["scheduled", "scheduled"];
  // In particular, "FT Only" does not identify a trustworthy live period.
  return ["unknown", "unknown"];
}
function futbolScore(value) {
  return typeof value === "string" ? normalizeScore(value.trim()) : null;
}
export function parseFutbol24(data, { date, now = Date.now(), sourceAgeMs = 0 } = {}) {
  const live = data?.live;
  if (
    !futbolObject(live) ||
    !futbolObject(live.matches) ||
    !futbolObject(live.statuses) ||
    !futbolObject(live.leagues) ||
    !futbolObject(live.categories) ||
    !futbolObject(live.meta)
  )
    throw new SourceError("FORMAT_CHANGED", "Futbol24 nije vratio očekivani spisak mečeva.");
  if (date) {
    const start = futbolTime(live.start),
      end = futbolTime(live.end),
      wantedStart = Date.parse(futbol24Midnight(date)),
      wantedEnd = Date.parse(futbol24Midnight(shiftDate(date, 1)));
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > wantedStart ||
      end < wantedEnd ||
      end - start > 36 * 3600000
    )
      throw new SourceError(
        "DATE_MISMATCH",
        "Futbol24 je vratio podatke za drugi kalendarski datum.",
      );
  }
  let age = Math.max(0, sourceAgeMs),
    sourceUpdatedAt = null;
  if (live.meta.live === true) {
    const updated = futbolTime(live.datetime);
    if (!Number.isFinite(updated) || updated > now + 30000)
      throw new SourceError(
        "INVALID_SOURCE_TIME",
        "Futbol24 nije vratio pouzdano vreme ažuriranja.",
      );
    age = Math.max(age, Math.max(0, now - updated));
    sourceUpdatedAt = live.datetime;
  } else if (live.meta.live !== false)
    throw new SourceError("FORMAT_CHANGED", "Futbol24 nije označio vrstu odgovora.");
  if (age > FRESH_MS)
    throw new SourceError(
      "STALE_SOURCE",
      "Futbol24 je vratio podatke starije od 5 minuta i 30 sekundi.",
    );
  const events = [];
  for (const [id, match] of Object.entries(live.matches)) {
    if (
      !/^\d{1,16}$/.test(id) ||
      !futbolObject(match) ||
      typeof match.team1?.name !== "string" ||
      typeof match.team2?.name !== "string" ||
      !match.team1.name.trim() ||
      !match.team2.name.trim() ||
      !Number.isFinite(futbolTime(match.date))
    )
      throw new SourceError("FORMAT_CHANGED", "Futbol24 ima neprepoznatljiv zapis utakmice.");
    const startTimestamp = futbolTime(match.date) / 1000;
    if (date && dateKey(startTimestamp * 1000) !== date) continue;
    const [state, phase] = futbolPhase(live.statuses[match.status_id]),
      current = futbolScore(match.score1);
    let halfTime = null,
      regularTime = null;
    if (["finished", "second_half", "half_time"].includes(phase)) {
      halfTime = futbolScore(match.score2);
      if (phase === "half_time" && !halfTime) halfTime = current;
      regularTime = current;
    } else if (phase === "first_half") regularTime = current;
    else if (["extra_time", "finished_extra_time"].includes(phase)) {
      // Futbol24's AET tooltip identifies the SECOND score2 pair as FT (90 min).
      const parts =
        typeof match.score2 === "string"
          ? match.score2.split(",").map((value) => value.trim())
          : [];
      if (parts.length === 2) {
        halfTime = futbolScore(parts[0]);
        regularTime = futbolScore(parts[1]);
      }
    }
    // AP's "p.x-y" is a shootout, not half-time or a guaranteed 90-minute score.
    const category = live.categories[match.category_id]?.name || "",
      league = live.leagues[match.league_id]?.name || "",
      subleague = live.subleagues?.[match.league_sub_id]?.name || "";
    const slug =
      typeof match.slug === "string"
        ? match.slug
            .split("/")
            .filter((part) => part && part !== "." && part !== "..")
            .map(encodeURIComponent)
            .join("/")
        : "";
    events.push({
      provider: "f24",
      id,
      home: match.team1.name,
      away: match.team2.name,
      homeId: match.team1.slug || null,
      awayId: match.team2.slug || null,
      league,
      fullLeague: [category, league, subleague].filter(Boolean).join(": "),
      leagueId: String(match.league_id || ""),
      startTimestamp,
      state,
      phase,
      current,
      halfTime,
      regularTime,
      sourceUpdatedAt,
      sourceAgeMs: age,
      url: slug ? "https://www.futbol24.com/match/" + slug : "https://www.futbol24.com/",
    });
  }
  return Object.defineProperty(events, "sourceAgeMs", { value: age });
}
export async function scrapeFutbol24({
  date,
  now = Date.now(),
  fetcher,
  fetchTextImpl = fetchText,
} = {}) {
  const midnight = futbol24Midnight(date),
    offset = midnight.slice(-6),
    today = dateKey(now);
  const current = date === today,
    previous = date === shiftDate(today, -1);
  async function load(dated) {
    const query = new URLSearchParams();
    query.set("_", "0");
    if (dated) query.set("date", midnight);
    query.set("lang", "en");
    query.set("sort", "kickoff");
    if (!dated) query.set("tz", offset);
    // The public website requires these query parameters in alphabetical order.
    query.sort();
    const endpoint = dated ? "/api/live/matches" : previous ? "/api/live/yesterday" : "/api/live";
    const response = await fetchTextImpl("https://www.futbol24.com" + endpoint + "?" + query, {
      fetcher,
      headers: { Accept: "application/json" },
    });
    let body;
    try {
      body = JSON.parse(response.text);
    } catch {
      throw new SourceError("FORMAT_CHANGED", "Futbol24 je vratio neispravan JSON odgovor.");
    }
    return parseFutbol24(body, { date, now, sourceAgeMs: response.sourceAgeMs || 0 });
  }
  try {
    return await load(!current && !previous);
  } catch (error) {
    // At a DST/midnight boundary the rolling view can select an adjacent day.
    // Only a successful response for the wrong date falls back to the dated view.
    if ((current || previous) && error.code === "DATE_MISMATCH") return load(true);
    throw error;
  }
}
