// Chrome serializes this function into the selected tab. Keep it self-contained.
export function captureSnapshot(selector = "", reportErrors = false) {
  const diagnostics = {
    documents: 0,
    shadowRoots: 0,
    slottedCells: 0,
    traversalLimited: false,
    frames: 0,
    inaccessibleFrames: 0,
    tables: 0,
    grids: 0,
    footballRows: 0,
    candidates: 0,
    ariaOrderedRows: 0,
    cssOrderedRows: 0,
    hiddenCells: 0,
    columnCounts: [],
    malformedRows: 0,
    invalidCode: 0,
    invalidTime: 0,
    missingNames: 0,
    score2Headers: 0,
    halftimeRead: 0,
    halftimeMissing: 0,
    halftimeUnreadable: 0,
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
      ':scope > td, :scope > th, :scope > [role="columnheader"], :scope > [role="gridcell"], :scope > [role="cell"], :scope > .slick-cell, :scope > .ag-cell, :scope > .tabulator-cell, :scope > .dhx_grid-cell';
    const roots = [],
      seenRoots = new Set(),
      queuedRoots = new Set(),
      priority = [],
      remaining = [];
    function enqueue(root, kind, urgent = false, scoped = false) {
      if (!root || queuedRoots.has(root)) return;
      queuedRoots.add(root);
      (urgent ? priority : remaining).push({ root, kind, scoped });
    }
    enqueue(document, "document", true);
    while (priority.length || remaining.length) {
      const { root: documentRoot, kind, scoped } = (priority.length ? priority : remaining).shift();
      if (seenRoots.has(documentRoot)) continue;
      if (seenRoots.size >= 2048) {
        diagnostics.traversalLimited = true;
        throw Error(
          "Stranica ima previše DOM delova za potpun pregled. Izaberite selektor tabele; postojeći spisak nije promenjen.",
        );
      }
      seenRoots.add(documentRoot);
      diagnostics[kind === "shadow" ? "shadowRoots" : "documents"]++;
      let found;
      try {
        found = documentRoot.querySelectorAll(scoped ? rootSelector : selector || rootSelector);
      } catch {
        throw Error(
          "Selektor tabele nije ispravan. Ostavite polje prazno ili proverite CSS selektor.",
        );
      }
      roots.push(...found);
      // Inspect the known grids before unrelated toolbar and input components.
      for (const grid of found) if (grid.shadowRoot) enqueue(grid.shadowRoot, "shadow", true, true);
      for (const frame of documentRoot.querySelectorAll("iframe, frame")) {
        if (!["IFRAME", "FRAME"].includes(frame.tagName)) continue;
        diagnostics.frames++;
        try {
          if (frame.contentDocument) enqueue(frame.contentDocument, "document", true);
          else diagnostics.inaccessibleFrames++;
        } catch {
          diagnostics.inaccessibleFrames++;
        }
      }
      const searchScopes = selector && !scoped && found.length ? [...found] : [documentRoot];
      for (const searchScope of searchScopes)
        for (const element of searchScope.querySelectorAll("*"))
          if (element.shadowRoot) enqueue(element.shadowRoot, "shadow", false, true);
    }
    function composedText(node, visited = new Set(), depth = 0) {
      if (!node || node.nodeType === 8 || visited.has(node) || depth > 64) return "";
      visited.add(node);
      if (
        ["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA"].includes(node.tagName) ||
        node.hidden
      )
        return "";
      if (node.nodeType === 3) return node.nodeValue || "";
      if (node.tagName === "BR") return " ";
      if (node.tagName === "SLOT") {
        const assigned = node.assignedNodes?.({ flatten: true }) || [];
        if (assigned.length)
          return [...assigned].map((child) => composedText(child, visited, depth + 1)).join("");
      }
      if (node.shadowRoot) return composedText(node.shadowRoot, visited, depth + 1);
      if (node.childNodes?.length) {
        const text = [...node.childNodes]
          .map((child) => composedText(child, visited, depth + 1))
          .join("");
        return /^(?:DIV|P|LI|SECTION|VAADIN-GRID-CELL-CONTENT)$/.test(node.tagName)
          ? " " + text + " "
          : text;
      }
      return node.innerText || node.textContent || "";
    }
    function cellText(cell) {
      if (cell.shadowRoot || cell.querySelectorAll?.("slot").length) {
        diagnostics.slottedCells++;
        return cell.innerText?.trim() ? cell.innerText : composedText(cell);
      }
      return cell.innerText || cell.textContent || "";
    }
    const styles = new WeakMap();
    function styleOf(cell) {
      if (!styles.has(cell))
        styles.set(
          cell,
          cell.ownerDocument?.defaultView?.getComputedStyle?.(cell) || cell.style || {},
        );
      return styles.get(cell);
    }
    function orderedCells(row) {
      const cells = [...row.querySelectorAll(cellSelector)].filter((cell) => {
        const style = styleOf(cell);
        const hidden =
          cell.hidden ||
          style.display === "none" ||
          ["hidden", "collapse"].includes(style.visibility);
        if (hidden) diagnostics.hiddenCells++;
        return !hidden;
      });
      const orders = cells.map((cell) => Number(styleOf(cell).order || 0));
      // Vaadin reuses cells in DOM order and places their columns with CSS order.
      const display = styleOf(row).display;
      if (
        (!display || /^(?:inline-)?(?:flex|grid)$/.test(display)) &&
        orders.every(Number.isInteger) &&
        new Set(orders).size > 1
      ) {
        diagnostics.cssOrderedRows++;
        return cells
          .map((cell, index) => ({ cell, index, order: orders[index] }))
          .sort((a, b) => a.order - b.order || a.index - b.index)
          .map(({ cell }) => cell);
      }
      const indexes = cells.map((cell) => cell.getAttribute?.("aria-colindex") || "");
      if (
        cells.length &&
        indexes.every((index) => /^[1-9]\d*$/.test(index)) &&
        new Set(indexes.map(Number)).size === cells.length
      ) {
        diagnostics.ariaOrderedRows++;
        return cells.sort(
          (a, b) =>
            Number(a.getAttribute("aria-colindex")) - Number(b.getAttribute("aria-colindex")),
        );
      }
      return cells;
    }
    function schedule(value) {
      const found =
        /^(?:(pon|uto|sre|čet|cet|pet|sub|ned)\.?\s*)?([01]\d|2[0-3])\s*:\s*([0-5]\d)$/i.exec(
          value,
        );
      return found
        ? {
            text: (found[1] ? found[1] + " " : "") + found[2] + ":" + found[3],
            weekday: Boolean(found[1]),
          }
        : null;
    }
    function cleanText(value) {
      return value
        .replace(/\s+/g, " ")
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .trim();
    }
    function isHeader(row, cells) {
      return (
        Boolean(row.closest?.("thead")) ||
        cells.some(
          (cell) =>
            cell.tagName === "TH" ||
            cell.getAttribute?.("role") === "columnheader" ||
            (cell.getAttribute?.("part") || "").split(/\s+/).includes("header-cell"),
        )
      );
    }
    function headerColumn(rows, names) {
      return rows.flatMap(({ cells, fields, header, row }) => {
        if (!header) return [];
        const display = styleOf(row).display,
          css =
            (!display || /^(?:inline-)?(?:flex|grid)$/.test(display)) &&
            new Set(cells.map((cell) => styleOf(cell).order || "0")).size > 1;
        const indexes = cells.map((cell) => cell.getAttribute?.("aria-colindex") || ""),
          aria =
            indexes.every((index) => /^[1-9]\d*$/.test(index)) &&
            new Set(indexes).size === cells.length;
        return fields.flatMap((text, index) =>
          names.includes(text.toLowerCase().replace(/\s/g, ""))
            ? [
                {
                  index,
                  count: cells.length,
                  cssOrder: css ? String(styleOf(cells[index]).order || "0") : null,
                  ariaIndex: aria ? indexes[index] : null,
                },
              ]
            : [],
        );
      });
    }
    function resolveColumn(cells, headers) {
      const matches = new Set();
      for (const column of headers) {
        const order = column.cssOrder,
          aria = column.ariaIndex;
        let found =
          order !== null
            ? cells.filter((cell) => String(styleOf(cell).order || "0") === order)
            : [];
        if (found.length !== 1 && aria)
          found = cells.filter((cell) => cell.getAttribute?.("aria-colindex") === aria);
        if (found.length !== 1 && column.count === cells.length) found = [cells[column.index]];
        if (found.length === 1) matches.add(found[0]);
      }
      return matches.size === 1 ? [...matches][0] : null;
    }
    function score2Value(cell) {
      if (!cell) return { value: "", state: "unreadable" };
      const raw = cleanText(cellText(cell));
      const pair =
        /^(\d{1,2})\s*[:\u2236\uff1a-]\s*(\d{1,2})$/.exec(raw) ||
        /^(\d{1,2})\s+(\d{1,2})$/.exec(raw);
      if (pair) return { value: Number(pair[1]) + ":" + Number(pair[2]), state: "read" };
      // A rendered colon may be CSS content: read the two numeric score elements.
      const visited = new Set();
      function groups(node, depth = 0) {
        if (
          !node ||
          visited.has(node) ||
          depth > 64 ||
          node.hidden ||
          ["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA"].includes(node.tagName)
        )
          return null;
        visited.add(node);
        const children =
          node.tagName === "SLOT"
            ? node.assignedNodes?.({ flatten: true }) || node.childNodes || []
            : node.shadowRoot
              ? [node.shadowRoot]
              : node.childNodes || [];
        const parts = [...children]
          .filter(
            (child) =>
              !child.hidden &&
              !["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA"].includes(child.tagName),
          )
          .map((child) => ({ node: child, text: cleanText(composedText(child)) }))
          .filter((part) => part.text && !/^[:\u2236\uff1a-]$/.test(part.text));
        if (parts.length === 2 && parts.every((part) => /^\d{1,2}$/.test(part.text)))
          return parts.map((part) => Number(part.text)).join(":");
        return parts.length === 1 ? groups(parts[0].node, depth + 1) : null;
      }
      const value = groups(cell);
      return value
        ? { value, state: "read" }
        : {
            value: "",
            state: !raw || /^[-:—–?\s]+$/.test(raw) ? "missing" : "unreadable",
          };
    }
    const uniqueRoots = [...new Set(roots)];
    diagnostics.tables = uniqueRoots.filter((root) => root.tagName === "TABLE").length;
    diagnostics.grids = uniqueRoots.length - diagnostics.tables;
    const candidates = [],
      malformed = [];
    for (const root of uniqueRoots) {
      if (["BODY", "HTML"].includes(root.tagName)) throw Error("Izaberite samo tabelu mečeva.");
      const records = [];
      let footballRows = 0,
        invalidCode = 0,
        invalidTime = 0,
        missingNames = 0,
        halftimeRead = 0,
        halftimeMissing = 0,
        halftimeUnreadable = 0;
      const rows = [...root.querySelectorAll(rowSelector)]
        .filter((row) => row.getClientRects().length)
        .map((row) => {
          const cells = orderedCells(row);
          return {
            row,
            cells,
            fields: cells.map((cell) => cleanText(cellText(cell))),
            header: isHeader(row, cells),
          };
        });
      const score2 = headerColumn(rows, ["score2"]),
        minuteColumn = headerColumn(rows, ["min", "minute", "minut"]),
        phaseColumn = headerColumn(rows, ["phase", "period"]);
      if (score2.length) diagnostics.score2Headers++;
      for (const { cells, fields, header } of rows) {
        if (header) continue;
        const sportIndex = fields.findIndex(
          (field, index) => index < 3 && /^(?:F|Fudbal)$/i.test(field),
        );
        if (sportIndex < 0) continue;
        footballRows++;
        if (
          !diagnostics.columnCounts.includes(cells.length) &&
          diagnostics.columnCounts.length < 32
        )
          diagnostics.columnCounts.push(cells.length);
        let match = fields.slice(sportIndex);
        match[0] = "F";
        const timeIndex = match.findIndex((field, index) => {
          const value = index >= 5 && index <= 10 ? schedule(field) : null;
          return value && (index === 5 || value.weekday);
        });
        if (timeIndex >= 5) {
          const prefix = match.slice(0, timeIndex).filter(Boolean);
          if (prefix.length === 5)
            match = [...prefix, schedule(match[timeIndex]).text, ...match.slice(timeIndex + 1)];
        }
        const codeValid = /^\d{1,10}$/.test(match[2] || ""),
          timeValid = Boolean(schedule(match[5] || "")),
          namesValid = Boolean(match[1] && match[3] && match[4]);
        if (!codeValid) invalidCode++;
        if (!timeValid) invalidTime++;
        if (!namesValid) missingNames++;
        if (match.length < 6 || !codeValid || !timeValid || !namesValid) {
          malformed.push(match.length);
          continue;
        }
        const halftime = score2Value(
          score2.length ? resolveColumn(cells, score2) : cells[sportIndex + timeIndex + 4],
        );
        if (halftime.state === "read") halftimeRead++;
        else if (halftime.state === "missing") halftimeMissing++;
        else halftimeUnreadable++;
        const phase = match.findIndex(
          (field, index) =>
            index >= 6 &&
            /^(?:1st half|2nd half|half[ -]?time|pause|finished|full[ -]?time|ended|not started|scheduled|postponed|cancelled|canceled|suspended|interrupted|extra[ -]?time|penalties)$/i.test(
              field,
            ),
        );
        const minuteCell = resolveColumn(cells, minuteColumn),
          phaseCell = resolveColumn(cells, phaseColumn);
        records.push(
          [
            ...match.slice(0, 9),
            halftime.value,
            minuteCell ? cleanText(cellText(minuteCell)) : match[10] || "",
            phaseCell ? cleanText(cellText(phaseCell)) : phase < 0 ? "" : match[phase],
          ].join("\t"),
        );
        if (records.length > 1000) throw Error("Najviše 1.000 mečeva po prenosu.");
      }
      diagnostics.footballRows = Math.max(diagnostics.footballRows, footballRows);
      diagnostics.malformedRows = Math.max(
        diagnostics.malformedRows,
        footballRows - records.length,
      );
      diagnostics.invalidCode = Math.max(diagnostics.invalidCode, invalidCode);
      diagnostics.invalidTime = Math.max(diagnostics.invalidTime, invalidTime);
      diagnostics.missingNames = Math.max(diagnostics.missingNames, missingNames);
      diagnostics.halftimeRead = Math.max(diagnostics.halftimeRead, halftimeRead);
      diagnostics.halftimeMissing = Math.max(diagnostics.halftimeMissing, halftimeMissing);
      diagnostics.halftimeUnreadable = Math.max(diagnostics.halftimeUnreadable, halftimeUnreadable);
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
