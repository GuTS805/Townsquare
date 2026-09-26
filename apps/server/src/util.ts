import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Crockford base32 without I, L, O, U, so codes survive being read aloud or handwritten.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomToken(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export function newSlug(): string {
  return `ts_${randomToken(6).toLowerCase()}`;
}

export function newInviteCode(): string {
  const raw = randomToken(10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
