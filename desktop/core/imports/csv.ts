/**
 * A small RFC 4180 CSV reader for imported channel exports.
 *
 * Accepts what real exports and spreadsheet re-saves produce: a UTF-8 BOM,
 * CRLF, LF or lone CR line breaks, quoted fields with doubled quotes and
 * embedded line breaks, a missing final newline, and blank lines (dropped).
 * A comma is the separator unless the header line has more semicolons than
 * commas outside quotes (some European spreadsheet locales re-save that way).
 */

export class CsvSyntaxError extends Error {
  constructor(readonly line: number) {
    super(`Unterminated quoted field starting on line ${line}`);
  }
}

function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c === ",") commas++;
    else if (!quoted && c === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

/** Parse CSV text into rows of raw string cells. Rows that are entirely empty are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let quoteStart = 0;
  let i = 0;

  const endRow = () => {
    row.push(field);
    field = "";
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      quoteStart = line;
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      endRow();
      line++;
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    // A stray quote inside an unquoted field is kept as text (lenient, like spreadsheets).
    field += c;
    i++;
  }
  if (quoted) throw new CsvSyntaxError(quoteStart);
  if (field !== "" || row.length) endRow();
  return rows;
}

/** Lower-case a header and drop everything but letters and digits: "Paid Out" → "paidout", "# of nights" → "ofnights". */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Find columns by name. `aliases` maps a field to the normalised header names
 * that mean it; the first matching column wins. Unknown columns are ignored.
 */
export function mapColumns<F extends string>(header: readonly string[], aliases: Record<F, readonly string[]>): Partial<Record<F, number>> {
  const normalized = header.map(normalizeHeader);
  const out: Partial<Record<F, number>> = {};
  for (const field of Object.keys(aliases) as F[]) {
    for (const alias of aliases[field]) {
      const index = normalized.indexOf(normalizeHeader(alias));
      if (index >= 0) {
        out[field] = index;
        break;
      }
    }
  }
  return out;
}
