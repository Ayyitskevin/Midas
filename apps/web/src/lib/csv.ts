/**
 * Minimal, dependency-free CSV serialization — pure and offline. Rows are
 * described by typed columns (a header plus an accessor), and every field is
 * RFC-4180 escaped: a value containing a comma, quote, CR or LF is wrapped in
 * double quotes with internal quotes doubled. Lines are CRLF-joined so the
 * output opens cleanly in Excel and Google Sheets.
 */

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

/** Stringify and escape a single field. */
export function escapeCsvField(value: CsvValue): string {
  if (value == null) return '';
  const s = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize `rows` to a CSV string with a header row from `columns`. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCsvField(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(c.value(row))).join(','));
  }
  return lines.join('\r\n');
}

/** Epoch-ms → ISO 8601, or '' for a non-finite / invalid instant. */
export function isoFromMs(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
