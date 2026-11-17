// Chrome serializes this function into the selected tab. Keep it self-contained.
export function captureSnapshot(selector = "", reportErrors = false) {
  const diagnostics = {
    documents: 0,
    frames: 0,
    inaccessibleFrames: 0,
    tables: 0,
    grids: 0,
    footballRows: 0,
    candidates: 0,
  };
  try {
    if (
      typeof selector !== "string" ||
      selector.length > 300 ||
      /^(?:html|body|\*)$/i.test(selector.trim())
    )
      throw Error("Izaberite samo tabelu mečeva, ne celu stranicu.");
    const rootSelector =
      'table, [role="grid"], [role="treegrid"], .grid-canvas, .slick-viewport, .ag-root, .k-grid-content, .tabulator-table, .dhx_grid-body, vaadin-grid';
    const rowSelector = 'tr, [role="row"], .slick-row, .ag-row, .tabulator-row, .dhx_grid-row';
    const cellSelector =
      ':scope > td, :scope > [role="gridcell"], :scope > [role="cell"], :scope > .slick-cell, :scope > .ag-cell, :scope > .tabulator-cell, :scope > .dhx_grid-cell';
    const roots = [],
      seenDocuments = new Set();
    function visit(documentRoot) {
      if (!documentRoot || seenDocuments.has(documentRoot) || seenDocuments.size >= 20) return;
      seenDocuments.add(documentRoot);
      diagnostics.documents++;
      let found;
      try {
        found = documentRoot.querySelectorAll(selector || rootSelector);
      } catch {
        throw Error(
          "Selektor tabele nije ispravan. Ostavite polje prazno ili proverite CSS selektor.",
        );
      }
      roots.push(...found);
      for (const frame of documentRoot.querySelectorAll("iframe, frame")) {
        if (!["IFRAME", "FRAME"].includes(frame.tagName)) continue;
        diagnostics.frames++;
        try {
          if (frame.contentDocument) visit(frame.contentDocument);
          else diagnostics.inaccessibleFrames++;
        } catch {
          diagnostics.inaccessibleFrames++;
        }
      }
      for (const element of documentRoot.querySelectorAll("*"))
        if (element.shadowRoot) visit(element.shadowRoot);
    }
    visit(document);
    const uniqueRoots = [...new Set(roots)];
    diagnostics.tables = uniqueRoots.filter((root) => root.tagName === "TABLE").length;
    diagnostics.grids = uniqueRoots.length - diagnostics.tables;
    const candidates = [],
      malformed = [];
    for (const root of uniqueRoots) {
      if (["BODY", "HTML"].includes(root.tagName)) throw Error("Izaberite samo tabelu mečeva.");
      const records = [];
      let footballRows = 0;
      for (const row of root.querySelectorAll(rowSelector)) {
        if (!row.getClientRects().length) continue;
        let cells = [...row.querySelectorAll(cellSelector)];
        if (
          cells.length &&
          cells.every((cell) => /^\d+$/.test(cell.getAttribute?.("aria-colindex") || ""))
        )
          cells.sort(
            (a, b) =>
              Number(a.getAttribute("aria-colindex")) - Number(b.getAttribute("aria-colindex")),
          );
        const fields = cells.map((cell) =>
          (cell.innerText || "")
            .replace(/[\t\r\n]+/g, " ")
            .replace(/\u00a0/g, " ")
            .replace(/[\u200b-\u200d\ufeff]/g, "")
            .trim(),
        );
        const sportIndex = fields.findIndex(
          (field, index) => index < 3 && /^(?:F|Fudbal)$/i.test(field),
        );
        if (sportIndex < 0) continue;
        footballRows++;
        const match = fields.slice(sportIndex);
        match[0] = "F";
        if (
          match.length < 6 ||
          !/^\d{1,10}$/.test(match[2]) ||
          !match[1] ||
          !match[3] ||
          !match[4] ||
          !/^(?:(?:pon|uto|sre|čet|cet|pet|sub|ned)\.?\s+)?(?:[01]\d|2[0-3]):[0-5]\d$/i.test(
            match[5],
          )
        ) {
          malformed.push(match.length);
          continue;
        }
        const phase = match.findIndex(
          (field, index) =>
            index >= 6 &&
            /^(?:1st half|2nd half|half[ -]?time|finished|full[ -]?time|ended|not started|scheduled|postponed|cancelled|canceled|suspended|interrupted|extra[ -]?time|penalties)$/i.test(
              field,
            ),
        );
        records.push(match.slice(0, phase < 0 ? Math.min(match.length, 12) : phase + 1).join("\t"));
        if (records.length > 1000) throw Error("Najviše 1.000 mečeva po prenosu.");
      }
      diagnostics.footballRows = Math.max(diagnostics.footballRows, footballRows);
      if (records.length && footballRows === records.length) candidates.push(records);
    }
    const unique = [
      ...new Map(candidates.map((records) => [[...records].sort().join("\n"), records])).values(),
    ];
    diagnostics.candidates = unique.length;
    const withSets = unique.map((records) => ({ records, values: new Set(records) }));
    const maximal = withSets.filter(
      (candidate) =>
        !withSets.some(
          (other) =>
            other.records.length > candidate.records.length &&
            candidate.records.every((record) => other.values.has(record)),
        ),
    );
    if (maximal.length !== 1) {
      if (maximal.length > 1)
        throw Error("Pronađeno je više tabela mečeva. Unesite selektor tačne tabele.");
      if (malformed.length)
        throw Error(
          "Fudbalski red nema očekivane kolone. Spisak nije prenet; proverite izbor tabele.",
        );
      throw Error(
        diagnostics.inaccessibleFrames
          ? "Tabela može biti u okviru kome dodatak nema pristup. Otvorite spisak direktno u tabu ili proverite detalje čitanja."
          : "Nema prepoznatih fudbalskih redova. Proverite detalje čitanja; moguća je drugačija struktura tabele.",
      );
    }
    const text = maximal[0].records.join("\n");
    if (text.length > 256000) throw Error("Najviše 1.000 mečeva po prenosu.");
    return { text, count: maximal[0].records.length, diagnostics };
  } catch (error) {
    if (reportErrors) return { error: error.message || "Čitanje tabele nije uspelo.", diagnostics };
    throw error;
  }
}
