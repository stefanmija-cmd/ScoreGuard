import {
  validateWatch,
  MAX_INPUT_BYTES,
  referenceFresh,
  normalizeName,
} from "../scraper/model.mjs";
import { importPreview, monitorPresentation } from "../scraper/import-preview.mjs";
import { appendZipEntry } from "../auth/zip.mjs";
import {
  isPackagePath,
  isCloudPackagePath,
  loginDestination,
  loginPath,
  isBrowserNavigation,
} from "../auth/navigation.mjs";
import { cloudSecrets } from "../auth/cloud-secrets.mjs";
import { normalizeTeamLink } from "../scraper/team-aliases.mjs";
export function createWebApp({
  monitor,
  auth,
  html,
  loginHtml,
  sourceZip,
  productionGuide,
  readme,
  teamAliases = null,
  streamlitGuide = null,
  cloudGuide = null,
  cloudZip = null,
  publicOrigin = null,
  trustProxy = false,
}) {
  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      ...headers,
    });
    res.end(body);
  }
  const json = (res, status, body, headers = {}) =>
    send(res, status, JSON.stringify(body), {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    });
  function sameOrigin(req) {
    const expected = publicOrigin || (auth.secure ? "https://" : "http://") + req.headers.host;
    return req.headers.origin === expected;
  }
  async function readBody(req, max = MAX_INPUT_BYTES) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) throw Error("Zahtev je prevelik.");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function aliasesChanged(shared, operator) {
    if (shared) {
      for (const id of Object.keys(monitor.watches)) await monitor.matchingChanged(id);
    } else await monitor.matchingChanged(operator);
  }
  const activeLinks = (operator) =>
    teamAliases.list(operator).filter((link) => link.source !== "sofa");
  return async function handle(req, res, url) {
    if (url.pathname === "/healthz" || url.pathname.startsWith("/v1/")) return false;
    const session = await auth.fromCookie(req.headers.cookie),
      user = session?.user;
    if (req.method === "GET" && url.pathname === "/downloads/cloud-uputstvo" && cloudGuide) {
      send(res, 200, cloudGuide, { "Content-Type": "text/html; charset=utf-8" });
      return true;
    }
    if (
      req.method === "GET" &&
      url.pathname === "/downloads/streamlit-uputstvo" &&
      streamlitGuide
    ) {
      send(res, 200, streamlitGuide, { "Content-Type": "text/html; charset=utf-8" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/downloads/produkcija") {
      send(res, 200, productionGuide, { "Content-Type": "text/plain; charset=utf-8" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/login") {
      if (user) {
        send(res, 303, "", { Location: loginDestination(url.searchParams.get("next")) });
      } else send(res, 200, loginHtml, { "Content-Type": "text/html; charset=utf-8" });
      return true;
    }
    if (url.pathname === "/api/me" && req.method === "GET") {
      json(res, 200, {
        ...(user || { authenticated: false, authMode: "password" }),
        backgroundAvailable: true,
        intervalSeconds: 300,
      });
      return true;
    }
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      if (!sameOrigin(req)) {
        json(res, 403, { error: "Nedozvoljen zahtev." });
        return true;
      }
      try {
        const body = await readBody(req, 4096);
        const result = await auth.login(body.username, body.password, {
          client: trustProxy
            ? String(req.headers["x-real-ip"] || req.socket.remoteAddress || "local")
            : req.socket.remoteAddress || "local",
        });
        if (!result.ok)
          json(
            res,
            result.status,
            { error: result.error },
            result.retryAfter ? { "Retry-After": String(result.retryAfter) } : {},
          );
        else
          json(
            res,
            200,
            { user: result.user, redirect: loginDestination(body.next) },
            { "Set-Cookie": result.cookie },
          );
      } catch {
        json(res, 400, { error: "Neispravan zahtev za prijavu." });
      }
      return true;
    }
    if (!user) {
      if (
        url.pathname.startsWith("/api/") ||
        ((isPackagePath(url.pathname) ||
          isCloudPackagePath(url.pathname) ||
          url.pathname === "/downloads/cloud-secrets.toml") &&
          !isBrowserNavigation(req.headers.accept, req.headers["sec-fetch-mode"]))
      )
        json(res, 401, { error: "Prijavite se kao operater." });
      else send(res, 303, "", { Location: loginPath(url.pathname) });
      return true;
    }
    if (url.pathname.startsWith("/api/")) {
      if (
        req.headers["x-scoreguard-operator"] &&
        req.headers["x-scoreguard-operator"] !== user.id
      ) {
        json(res, 409, {
          code: "ACCOUNT_CHANGED",
          error: "Aktivan nalog je promenjen u drugoj kartici. Osvežite stranicu.",
        });
        return true;
      }
      if (req.method !== "GET" && !sameOrigin(req)) {
        json(res, 403, { error: "Nedozvoljen zahtev." });
        return true;
      }
      try {
        if (url.pathname === "/api/team-aliases" || url.pathname === "/api/team-aliases/import") {
          if (!teamAliases) {
            json(res, 503, { error: "Povezivanje klubova nije dostupno. Ažurirajte servis." });
            return true;
          }
          if (req.method === "GET" && url.pathname === "/api/team-aliases") {
            json(res, 200, {
              aliases: activeLinks(user.id),
              sharedAliases: activeLinks("@shared"),
              legacyAliasCount: [
                ...teamAliases.list(user.id),
                ...teamAliases.list("@shared"),
              ].filter((link) => link.source === "sofa").length,
              canManageShared: user.role === "admin",
              events: teamAliases.history(user.id).filter((event) => event.source !== "sofa"),
              limit: teamAliases.limit,
              configuredCount: monitor.collector.configuredTeamAliasCount || 0,
            });
            return true;
          }
          if (req.method === "POST") {
            const body = await readBody(
              req,
              url.pathname.endsWith("/import") ? MAX_INPUT_BYTES : 4096,
            );
            let result;
            const shared = body.scope === "shared";
            if (shared && user.role !== "admin") {
              json(res, 403, { error: "Zajednička povezivanja uređuje administrator." });
              return true;
            }
            const target = shared ? "@shared" : user.id;
            if (url.pathname.endsWith("/import")) {
              if (body.version !== 1 || !Array.isArray(body.aliases))
                throw Error("Datoteka mora biti prethodno izvezena lista povezivanja.");
              result = await teamAliases.addMany(
                target,
                body.aliases.map((link) => ({ ...link, confirmed: body.confirmed === true })),
                user.name,
                user.id,
                { allowLegacy: true },
              );
            } else result = await teamAliases.add(target, body, user.name, user.id);
            if (result.changed) await aliasesChanged(shared, user.id);
            json(res, 200, { ...result, aliases: activeLinks(user.id) });
            return true;
          }
          if (req.method === "DELETE" && url.pathname === "/api/team-aliases") {
            const body = await readBody(req, 4096),
              shared = body.scope === "shared";
            if (shared && user.role !== "admin") {
              json(res, 403, { error: "Zajednička povezivanja uređuje administrator." });
              return true;
            }
            const result = await teamAliases.remove(
              shared ? "@shared" : user.id,
              body.id,
              user.name,
              user.id,
            );
            await aliasesChanged(shared, user.id);
            json(res, 200, { ...result, aliases: teamAliases.list(user.id) });
            return true;
          }
          json(res, 405, { error: "Nedozvoljen metod." });
          return true;
        }
        if (url.pathname === "/api/auth/logout" && req.method === "POST") {
          json(res, 200, { ok: true }, { "Set-Cookie": await auth.logout(req.headers.cookie) });
          return true;
        }
        if (url.pathname === "/api/monitor" && req.method === "GET") {
          const snapshot = monitor.snapshot(user.id),
            storage = monitor.store.status || { mode: "local", durable: false, state: "ready" },
            states = [storage, monitor.operations?.status, teamAliases?.document.status].filter(
              Boolean,
            );
          json(res, 200, {
            monitor: snapshot,
            view: monitorPresentation(snapshot),
            background: true,
            operations: !!monitor.operations,
            storage: {
              ...storage,
              state: states.find((s) => s.state !== "ready")?.state || "ready",
            },
            sourceConfiguration: monitor.collector.configuredSources || { flash: true, f24: true },
            limits: { matches: 1000 },
            feedStats: monitor.collector.stats || {},
          });
          return true;
        }
        if (url.pathname === "/api/history" && req.method === "GET") {
          json(res, 200, { events: monitor.history(user.id, url.searchParams.get("matchId")) });
          return true;
        }
        if (url.pathname === "/api/cases" && req.method === "GET") {
          if (!monitor.operations) throw Error("Evidencija slučajeva nije dostupna.");
          const offset = Math.max(
              0,
              Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0,
            ),
            owner =
              url.searchParams.get("owner") === "me"
                ? user.id
                : url.searchParams.get("owner") === "unassigned"
                  ? "unassigned"
                  : "";
          json(
            res,
            200,
            monitor.operations.board({
              offset,
              limit: 100,
              includeResolved: url.searchParams.get("resolved") === "1",
              owner,
              query: (url.searchParams.get("q") || "").slice(0, 150),
            }),
          );
          return true;
        }
        if (url.pathname === "/api/cases/action" && req.method === "POST") {
          const body = await readBody(req, 8000);
          if (!monitor.operations) throw Error("Evidencija slučajeva nije dostupna.");
          json(res, 200, {
            case: await monitor.operations.action(body.id, body.action, user, {
              version: body.version,
              note: body.note,
            }),
          });
          return true;
        }
        if (url.pathname === "/api/matching/confirm" && req.method === "POST") {
          const body = await readBody(req, 4096),
            snapshot = monitor.snapshot(user.id),
            match = snapshot?.watch.matches.find((m) => m.id === body.matchId),
            ref = snapshot?.lastResult?.results.find((m) => m.id === body.matchId)?.refs?.[
              body.source
            ];
          const candidate = ref?.suggestions?.find((c) => c.eventId === body.eventId);
          if (!match || !candidate || !referenceFresh(ref) || body.confirmed !== true)
            throw Error("Predlog više nije svež ili nije potvrđen. Ponovo proverite meč.");
          const shared = body.scope === "shared";
          if (shared && user.role !== "admin") {
            json(res, 403, { error: "Zajedničko povezivanje potvrđuje administrator." });
            return true;
          }
          const teams = match.match.split(/\s+[–—-]\s+/),
            links = teams
              .map((name, index) => ({
                source: body.source,
                internalName: name,
                sourceName: index ? candidate.away : candidate.home,
                confirmed: true,
              }))
              .filter(
                (link) => normalizeName(link.internalName) !== normalizeName(link.sourceName),
              );
          if (!links.length) throw Error("Nazivi se već poklapaju. Pokrenite novu proveru.");
          const saved = await teamAliases.addMany(
            shared ? "@shared" : user.id,
            links,
            user.name,
            user.id,
          );
          if (saved.changed) await aliasesChanged(shared, user.id);
          json(res, 200, { ...saved, recheckRequired: true });
          return true;
        }
        if (url.pathname === "/api/backup" && req.method === "GET") {
          const snapshot = monitor.snapshot(user.id);
          json(res, 200, {
            app: "ScoreGuard",
            version: 2,
            exportedAt: new Date().toISOString(),
            watch: snapshot?.watch || null,
            importedAt: snapshot?.importedAt || null,
            reviews: snapshot?.reviews || {},
            reviewEvents: snapshot?.reviewEvents || [],
            aliases:
              teamAliases?.list(user.id).map(({ source, internalName, sourceName }) => ({
                source,
                internalName,
                sourceName,
              })) || [],
            ...(user.role === "admin"
              ? {
                  sharedAliases:
                    teamAliases?.list("@shared").map(({ source, internalName, sourceName }) => ({
                      source,
                      internalName,
                      sourceName,
                    })) || [],
                }
              : {}),
            history: monitor.operations?.exportHistory(user.id) || [],
          });
          return true;
        }
        if (url.pathname === "/api/backup/restore" && req.method === "POST") {
          const raw = await readBody(req, 12 * 1024 * 1024),
            body = raw.backup;
          if (
            raw.confirmed !== true ||
            !body ||
            body.app !== "ScoreGuard" ||
            body.version !== 2 ||
            !Array.isArray(body.aliases) ||
            body.aliases.length > (teamAliases?.limit || 0)
          )
            throw Error("Izaberite važeću rezervnu kopiju i potvrdite vraćanje.");
          const watch = body.watch ? validateWatch(body.watch) : null;
          const aliases = body.aliases.map((link) => ({
            ...normalizeTeamLink({ ...link, confirmed: true }, { allowLegacy: true }),
            confirmed: true,
          }));
          if (body.sharedAliases !== undefined && !Array.isArray(body.sharedAliases))
            throw Error("Neispravna zajednička povezivanja u kopiji.");
          const shared = (body.sharedAliases || []).map((link) => ({
            ...normalizeTeamLink({ ...link, confirmed: true }, { allowLegacy: true }),
            confirmed: true,
          }));
          if (shared.length && user.role !== "admin") {
            json(res, 403, { error: "Zajednička povezivanja može vratiti administrator." });
            return true;
          }
          if (shared.length > (teamAliases?.limit || 0))
            throw Error("Previše zajedničkih povezivanja.");
          monitor.operations?.validateHistory(body.history || []);
          const restoreReview = (review) => {
            if (
              !review ||
              typeof review.note !== "string" ||
              review.note.length > 1000 ||
              typeof review.at !== "string" ||
              !Number.isFinite(Date.parse(review.at))
            )
              throw Error("Neispravna napomena u kopiji.");
            return {
              note: review.note,
              at: review.at,
              operator: user.id,
              name: "Vraćena kopija · " + user.name,
              restoredAt: new Date().toISOString(),
            };
          };
          if (
            body.reviews !== undefined &&
            (!body.reviews || typeof body.reviews !== "object" || Array.isArray(body.reviews))
          )
            throw Error("Neispravne napomene u kopiji.");
          const allowedIds = new Set(watch?.matches.map((m) => m.id) || []);
          if (Object.keys(body.reviews || {}).length > 1000)
            throw Error("Previše napomena u kopiji.");
          const reviews = Object.fromEntries(
            Object.entries(body.reviews || {})
              .filter(([id]) => allowedIds.has(id))
              .map(([id, review]) => [id, restoreReview(review)]),
          );
          if (
            body.reviewEvents !== undefined &&
            (!Array.isArray(body.reviewEvents) || body.reviewEvents.length > 500)
          )
            throw Error("Neispravna evidencija napomena u kopiji.");
          const reviewEvents = (body.reviewEvents || []).map((review) => ({
            ...restoreReview(review),
            matchId: typeof review.matchId === "string" ? review.matchId.slice(0, 100) : "",
            match: typeof review.match === "string" ? review.match.slice(0, 200) : "",
          }));
          if (
            body.importedAt !== null &&
            (!Number.isFinite(Date.parse(body.importedAt)) ||
              Date.parse(body.importedAt) > Date.now() + 30000)
          )
            throw Error("Neispravno vreme internog unosa u kopiji.");
          if (aliases.length)
            await teamAliases.addMany(user.id, aliases, user.name, user.id, { allowLegacy: true });
          if (shared.length)
            await teamAliases.addMany("@shared", shared, user.name, user.id, { allowLegacy: true });
          if (body.history?.length) await monitor.operations?.restoreHistory(user.id, body.history);
          if (watch) {
            await monitor.configure(user.id, watch, { enabled: false, imported: true });
            monitor.watches[user.id].importedAt = body.importedAt;
            monitor.watches[user.id].lastResult = null;
            monitor.watches[user.id].reviews = reviews;
            monitor.watches[user.id].reviewEvents = reviewEvents;
            await monitor.store.save(monitor.watches);
          }
          await aliasesChanged(shared.length > 0, user.id);
          json(res, 200, {
            ok: true,
            recheckRequired: true,
            message:
              "Kopija je vraćena. Automatika je pauzirana i potrebna je nova provera izvora.",
          });
          return true;
        }
        if (url.pathname === "/api/import/preview" && req.method === "POST") {
          const body = await readBody(req);
          json(res, 200, importPreview(body));
          return true;
        }
        if (url.pathname === "/api/review" && req.method === "POST") {
          const body = await readBody(req, 8000);
          json(res, 200, {
            review: await monitor.review(user.id, {
              matchId: body.matchId,
              note: body.note,
              actorName: user.name,
            }),
          });
          return true;
        }
        if (url.pathname === "/api/watch" && req.method === "DELETE") {
          json(res, 200, { monitor: await monitor.pause(user.id), background: true });
          return true;
        }
        if (url.pathname === "/api/watch" && req.method === "PUT") {
          const raw = await readBody(req),
            watch = validateWatch(raw);
          json(res, 200, {
            monitor: await monitor.configure(user.id, watch, {
              enabled: raw.enabled !== false,
              imported: raw.imported === true,
            }),
            background: true,
          });
          return true;
        }
        if (url.pathname === "/api/compare" && req.method === "POST") {
          const raw = await readBody(req),
            watch = validateWatch(raw);
          const snapshot = await monitor.configure(user.id, watch, {
            enabled: raw.enabled !== false,
          });
          json(res, 200, {
            ...(await monitor.check(user.id, {
              trigger: raw.trigger === "scheduled" ? "scheduled" : "manual",
              revision: snapshot.revision,
            })),
            background: true,
          });
          return true;
        }
        json(res, 404, { error: "Nepoznata API putanja." });
      } catch (e) {
        json(res, [404, 409].includes(e.status) ? e.status : 400, {
          error: e.message || "Zahtev nije izvršen.",
        });
      }
      return true;
    }
    if (
      req.method === "GET" &&
      (isCloudPackagePath(url.pathname) || url.pathname === "/downloads/cloud-secrets.toml")
    ) {
      if (user.role !== "admin") {
        json(res, 403, { error: "Cloud paket i konfiguraciju preuzima administrator." });
        return true;
      }
      if (!cloudZip) {
        json(res, 404, { error: "Paket za postavljanje nije dostupan u testnom Cloud servisu." });
        return true;
      }
      if (url.pathname === "/downloads/cloud-secrets.toml")
        send(res, 200, cloudSecrets(auth.config), {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": "attachment; filename=cloud-secrets.toml",
          "Cache-Control": "private, no-store",
        });
      else
        send(res, 200, cloudZip, {
          "Content-Type": "application/zip",
          "Content-Disposition": "attachment; filename=ScoreGuard-cloud-v0.7.zip",
          "Cache-Control": "private, no-store",
        });
      return true;
    }
    if (req.method === "GET" && isPackagePath(url.pathname)) {
      if (user.role !== "admin") {
        json(res, 403, { error: "Paket za postavljanje može preuzeti administrator." });
        return true;
      }
      if (!sourceZip) {
        json(res, 404, { error: "Paket za postavljanje nije dostupan u testnom Cloud servisu." });
        return true;
      }
      const zip = appendZipEntry(
        sourceZip,
        "scoreguard/secrets/operators.json",
        JSON.stringify(auth.config, null, 2) + "\n",
      );
      send(res, 200, zip, {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=ScoreGuard-streamlit-v0.6.zip",
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/downloads/uputstvo") {
      send(res, 200, readme, { "Content-Type": "text/plain; charset=utf-8" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
      return true;
    }
    json(res, 404, { error: "Nepoznata putanja." });
    return true;
  };
}
