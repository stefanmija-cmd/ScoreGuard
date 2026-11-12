import { scorePair, validDate } from "../model.mjs";
import { fetchText, SourceError } from "../http.mjs";

export function parseApiFootball(data) {
  if (!data || !Array.isArray(data.response))
    throw new SourceError("INVALID_DATA", "API-Football nije vratio očekivani format.");
  if (data.errors && Object.keys(data.errors).length)
    throw new SourceError(
      "API_ERROR",
      "API-Football je odbio zahtev. Proverite pretplatu, kvotu i dostupnost sezone u nalogu dobavljača.",
    );
  const phases = {
    "1H": ["live", "first_half"],
    HT: ["live", "half_time"],
    "2H": ["live", "second_half"],
    ET: ["live", "extra_time"],
    BT: ["live", "extra_time"],
    P: ["live", "penalties"],
    FT: ["finished", "finished"],
    AET: ["finished", "finished_extra_time"],
    PEN: ["finished", "finished_penalties"],
    NS: ["scheduled", "scheduled"],
    TBD: ["scheduled", "scheduled"],
    PST: ["postponed", "postponed"],
    CANC: ["cancelled", "cancelled"],
    INT: ["interrupted", "interrupted"],
    SUSP: ["interrupted", "interrupted"],
    ABD: ["interrupted", "interrupted"],
    AWD: ["awarded", "awarded"],
    WO: ["awarded", "awarded"],
  };
  return data.response
    .filter(
      (item) =>
        item?.fixture?.id &&
        typeof item.teams?.home?.name === "string" &&
        typeof item.teams?.away?.name === "string" &&
        Number.isFinite(item.fixture.timestamp),
    )
    .map((item) => {
      const [state, phase] = phases[item.fixture.status?.short] || ["unknown", "unknown"];
      return {
        id: String(item.fixture.id),
        home: item.teams.home.name,
        away: item.teams.away.name,
        homeId: item.teams.home.id,
        awayId: item.teams.away.id,
        league: item.league?.name || "",
        fullLeague: [item.league?.country, item.league?.name].filter(Boolean).join(": "),
        startTimestamp: item.fixture.timestamp,
        state,
        phase,
        current: scorePair(item.goals?.home, item.goals?.away),
        halfTime:
          phase === "first_half"
            ? null
            : scorePair(item.score?.halftime?.home, item.score?.halftime?.away),
        regularTime: scorePair(item.score?.fulltime?.home, item.score?.fulltime?.away),
        url: null,
      };
    });
}
export function createApiFootballProvider({
  key = "",
  dailyLimit = 90,
  clock = () => Date.now(),
} = {}) {
  let day = "",
    used = 0;
  const limit =
    Number.isInteger(Number(dailyLimit)) && Number(dailyLimit) > 0 ? Number(dailyLimit) : 90;
  return async function scrapeApiFootball({ date, fetcher = globalThis.fetch }) {
    if (!key)
      throw new SourceError(
        "NOT_CONFIGURED",
        "API-Football nije podešen. Administrator može dodati APIFOOTBALL_KEY u Streamlit Secrets.",
      );
    if (!validDate(date)) throw new SourceError("INVALID_DATE", "Neispravan datum provere.");
    const today = new Date(clock()).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used >= limit)
      throw new SourceError("RATE_LIMIT", "Dostignut je podešeni dnevni limit za API-Football.", {
        retryAfterMs: Date.parse(today + "T00:00:00Z") + 86400000 - clock(),
      });
    used++;
    const response = await fetchText(
      "https://v3.football.api-sports.io/fixtures?date=" + date + "&timezone=Europe%2FBelgrade",
      { fetcher, headers: { "x-apisports-key": key }, redirect: "error" },
    );
    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      throw new SourceError("INVALID_DATA", "API-Football je vratio neispravan odgovor.");
    }
    return Object.defineProperty(parseApiFootball(data), "sourceAgeMs", {
      value: response.sourceAgeMs || 0,
    });
  };
}
