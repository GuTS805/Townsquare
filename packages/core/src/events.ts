import type { Hex } from "viem";
import { hashJson } from "./hash";
import { signPayload, verifyPayload } from "./sign";

export const EVENT_TYPES = ["PHASE", "JOIN", "KEY_ROTATE", "STATEMENT", "MODERATE", "VOTE"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface LogEvent<B = unknown> {
  v: 1;
  conv: string;
  seq: number;
  type: EventType;
  body: B;
  // participant signature over the action inside body, when there is one
  sig: string | null;
  // ISO timestamp rounded down to the minute
  t: string;
}

export function roundToMinute(d: Date = new Date()): string {
  const r = new Date(d);
  r.setUTCSeconds(0, 0);
  return r.toISOString();
}

// The signature is part of what gets hashed, so swapping it later breaks check D.
export function eventHash(e: LogEvent): Hex {
  return hashJson({ v: e.v, conv: e.conv, seq: e.seq, type: e.type, body: e.body, sig: e.sig, t: e.t });
}

export interface ReceiptBody {
  v: 1;
  conv: string;
  seq: number;
  eventHash: Hex;
  head: Hex;
}

export interface Receipt extends ReceiptBody {
  logSig: string;
}

export async function signReceipt(logKey: CryptoKey, body: ReceiptBody): Promise<Receipt> {
  return { ...body, logSig: await signPayload(logKey, body) };
}

export async function verifyReceipt(logPublicKey: CryptoKey | string, r: Receipt): Promise<boolean> {
  const { logSig, ...body } = r;
  return verifyPayload(logPublicKey, body, logSig);
}
