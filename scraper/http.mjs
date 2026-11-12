export class SourceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourceError";
    this.code = code;
    Object.assign(this, details);
  }
}
export async function fetchText(
  url,
  {
    fetcher = globalThis.fetch,
    headers = {},
    timeoutMs = 12000,
    maxBytes = 8 * 1024 * 1024,
    redirect = "follow",
  } = {},
) {
  let response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "*/*", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect,
    });
  } catch (error) {
    throw new SourceError(
      error.name === "TimeoutError" || error.name === "AbortError" ? "TIMEOUT" : "NETWORK",
      "Izvor nije odgovorio u predviđenom roku ili veza nije dostupna.",
    );
  }
  if (!response.ok) {
    const seconds = Number(response.headers.get("retry-after"));
    const until = Date.parse(response.headers.get("retry-after"));
    const retryAfterMs =
      Number.isFinite(seconds) && response.headers.get("retry-after") !== null
        ? seconds * 1000
        : Number.isFinite(until)
          ? Math.max(0, until - Date.now())
          : null;
    throw new SourceError(
      response.status === 403 ? "BLOCKED" : response.status === 429 ? "RATE_LIMIT" : "HTTP_ERROR",
      "Izvor je vratio HTTP " + response.status + ".",
      { httpStatus: response.status, retryAfterMs },
    );
  }
  if (Number(response.headers.get("age")) > 330) {
    await response.body?.cancel();
    throw new SourceError(
      "STALE_SOURCE",
      "Izvor je vratio keširane podatke starije od 5 minuta i 30 sekundi.",
    );
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new SourceError("TOO_LARGE", "Odgovor izvora je prevelik.");
  }
  const reader = response.body?.getReader();
  if (!reader) return { text: "", headers: response.headers };
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new SourceError("TOO_LARGE", "Odgovor izvora je prevelik.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(
      error?.name === "TimeoutError" || error?.name === "AbortError" ? "TIMEOUT" : "NETWORK",
      "Izvor nije odgovorio u predviđenom roku ili veza nije dostupna.",
    );
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (
    /captcha|challenge-platform|challenge-form|cloudflare.*challenge/i.test(text.slice(0, 16000)) &&
    /<html|<!doctype/i.test(text.slice(0, 1000))
  )
    throw new SourceError("BLOCKED", "Izvor zahteva CAPTCHA ili zaštitnu proveru.");
  return {
    text,
    headers: response.headers,
    sourceAgeMs: Math.max(0, Number(response.headers.get("age")) || 0) * 1000,
  };
}
