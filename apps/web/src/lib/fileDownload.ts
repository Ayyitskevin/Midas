/** Trigger a browser download of raw `text` under `filename`. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of `data` serialized as pretty-printed JSON. */
export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}

/** Trigger a browser download of CSV `text`. */
export function downloadCsv(filename: string, text: string): void {
  downloadText(filename, text, 'text/csv');
}
