// Chrome serializes this function into the selected tab. Keep it self-contained.
export function captureSnapshot(selector = "") {
  if (selector.length > 300 || /^(?:html|body|\*)$/i.test(selector.trim()))
    throw Error("Izaberite samo tabelu mečeva, ne celu stranicu.");
  const roots = selector
    ? [...document.querySelectorAll(selector)]
    : [...document.querySelectorAll("table")];
  const candidates = [];
  for (const root of roots) {
    if (["BODY", "HTML"].includes(root.tagName)) throw Error("Izaberite samo tabelu mečeva.");
    const records = [];
    for (const row of root.querySelectorAll('tr, [role="row"]')) {
      if (!row.getClientRects().length) continue;
      const fields = [
        ...row.querySelectorAll(':scope > td, :scope > [role="gridcell"], :scope > [role="cell"]'),
      ].map((cell) =>
        cell.innerText
          .replace(/[\t\r\n]+/g, " ")
          .replace(/\u00a0/g, " ")
          .trim(),
      );
      if (!["F", "Fudbal"].includes(fields[0])) continue;
      if (
        fields.length < 6 ||
        !/^\d{1,10}$/.test(fields[2]) ||
        !fields[1] ||
        !fields[3] ||
        !fields[4]
      )
        throw Error("Fudbalski red nema očekivane kolone. Proverite izbor tabele.");
      // Only the documented match columns are sent; action cells are excluded.
      const phase = fields.findIndex(
        (field, index) =>
          index >= 6 &&
          /^(?:1st half|2nd half|half[ -]?time|finished|full[ -]?time|ended|not started|scheduled|postponed|cancelled|canceled|suspended|interrupted|extra[ -]?time|penalties)$/i.test(
            field,
          ),
      );
      records.push(fields.slice(0, phase < 0 ? Math.min(fields.length, 12) : phase + 1).join("\t"));
    }
    if (records.length) candidates.push(records);
  }
  if (candidates.length !== 1)
    throw Error(
      candidates.length
        ? "Pronađeno je više tabela mečeva. Unesite selektor tačne tabele."
        : "Nema prepoznatih fudbalskih redova u prikazanoj tabeli. Otvorite spisak ili podesite selektor.",
    );
  const text = candidates[0].join("\n");
  if (candidates[0].length > 1000 || text.length > 256000)
    throw Error("Najviše 1.000 mečeva po prenosu.");
  return { text, count: candidates[0].length };
}
