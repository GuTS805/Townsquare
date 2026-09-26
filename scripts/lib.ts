import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const STATE_FILE = fileURLToPath(new URL("./.demo-state.json", import.meta.url));

export function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v === undefined && fallback === undefined) throw new Error(`missing --${name}`);
  return v ?? fallback!;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

export function client(base: string) {
  return async function api<T = any>(path: string, body?: unknown, init: { method?: string; token?: string } = {}) {
    const res = await fetch(`${base}/api${path}`, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    return { ok: res.ok, status: res.status, data: data as T, code: (data?.code as string | undefined) ?? (res.ok ? "OK" : "HTTP_" + res.status) };
  };
}

export interface DemoState {
  api: string;
  web: string;
  slug: string;
  adminToken: string;
  usedCode: string;
  unusedCodes: string[];
  // one participant, kept so the attack scripts can act as a real member
  member: { identity: string; pid: string; keyVersion: number; pkcs8: string; spki: string; nonce: number };
}

export const saveState = (s: DemoState) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

export function loadState(): DemoState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    throw new Error("no demo state found, run `pnpm --filter @townsquare/scripts seed` first");
  }
}

export function tally() {
  const counts = new Map<string, number>();
  return {
    add(code: string) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    },
    print(title: string) {
      console.log(`\n${title}`);
      for (const [code, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${code.padEnd(22)} ${n}`);
    },
    get: (code: string) => counts.get(code) ?? 0,
  };
}

// Small seeded PRNG so a demo run is reproducible.
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
