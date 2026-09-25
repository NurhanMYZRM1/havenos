/** Safe, bounded sync diagnostics. Never persist the original exception or stack. */
export function sanitizeSyncText(value: string, feedUrl?: string | null): string {
  let text = value;
  // Exceptions may quote percent-encoded links, including a second encoding layer.
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(/(?:%[\da-f]{2})+/gi, (part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return "[redacted]";
      }
    });
  }
  if (feedUrl) {
    const secrets = new Set([feedUrl, encodeURIComponent(feedUrl)]);
    try {
      const url = new URL(feedUrl);
      for (const secret of url.searchParams.values()) {
        if (secret) {
          secrets.add(secret);
          secrets.add(encodeURIComponent(secret));
        }
      }
    } catch {
      // Invalid links are still removed as literal strings above.
    }
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/\b[a-z][a-z\d+.-]*:(?:\/\/|%2f%2f)[^\s<>"']*/gi, "[redacted]")
    .replace(/(?:\/\/|\bwww\.)[^\s<>"']+/gi, "[redacted]")
    .replace(/\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?\/[^\s<>"']*/gi, "[redacted]")
    .replace(/[?&][^\s<>"']*/g, "[redacted]")
    .replace(/\b[a-z][\w-]*\s*(?:=|%3d)\s*(?:"[^"]*"|'[^']*'|[^\s,;]*)/gi, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function safeSyncDiagnostic(err: unknown, feedUrl?: string | null): string {
  const name = err instanceof Error ? err.name === "Error" ? err.constructor.name : err.name || "Error" : "Error";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown failure";
  return sanitizeSyncText(`${name}: ${message}`, feedUrl);
}
