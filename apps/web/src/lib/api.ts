export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.code ?? "INTERNAL", data.message ?? res.statusText, res.status);
  return data as T;
}

export interface PublicConversation {
  slug: string;
  title: string;
  question: string;
  context: string;
  phase: "draft" | "open" | "closed" | "sealed";
  gate: { type: "invite_code" | "anon_aadhaar"; codeRoot: string | null; nullifierSeed: string | null; freshnessDays: number; reveal: string[] };
  minMembers: number;
  moderation: "pre" | "post";
  configHash: string;
  chain: { convId: string; groupId: string | null; txHash: string | null } | null;
  finalResultHash: string | null;
  counts: { members: number; participants: number; statements: number; votes: number };
  anonymityReady: boolean;
}

export interface Meta {
  chainId: number;
  hubAddress: string | null;
  onchain: boolean;
  logPublicKey: string;
  aadhaarMode: "test" | "production";
}

// Explorer links; Base Sepolia by default.
export function txUrl(hash: string, chainId = 84532) {
  const base = chainId === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${base}/tx/${hash}`;
}

export const ERROR_TEXT: Record<string, string> = {
  CODE_USED: "That invite code has already been used.",
  BAD_CODE: "That invite code isn't valid for this conversation.",
  GATE_NULLIFIER_USED: "This credential has already registered here.",
  ANON_SET_TOO_SMALL: "Not enough members yet to keep you anonymous.",
  ROOT_UNKNOWN: "The group changed, try again.",
  WRONG_PHASE: "This conversation isn't open right now.",
  NONCE_REPLAY: "That action was already recorded.",
  STALE_KEY: "Your identity was used on another device. Rejoin here to continue.",
  DUPLICATE_STATEMENT: "Someone already wrote exactly that.",
  RATE_LIMITED: "Slow down a little and try again.",
};

export function friendly(e: unknown) {
  if (e instanceof ApiError) return ERROR_TEXT[e.code] ?? e.message;
  return e instanceof Error ? e.message : String(e);
}
