// Rejected requests per conversation and error code, for the host dashboard's attack panel.
// In memory only: it resets on restart and holds no request details.
const counts = new Map<string, Map<string, number>>();

const SLUG_IN_PATH = /^\/api\/(?:c|conversations)\/([a-z0-9_]+)/;

export function recordRejection(path: string, code: string) {
  const slug = SLUG_IN_PATH.exec(path)?.[1];
  if (!slug) return;
  const m = counts.get(slug) ?? new Map<string, number>();
  m.set(code, (m.get(code) ?? 0) + 1);
  counts.set(slug, m);
}

export function rejectionsFor(slug: string): Record<string, number> {
  return Object.fromEntries(counts.get(slug) ?? []);
}
