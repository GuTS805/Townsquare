import { concat, keccak256, toBytes, type Hex } from "viem";
import { canonicalBytes } from "./jcs";

export const ZERO_HASH: Hex = `0x${"00".repeat(32)}`;

export function hashJson(value: unknown): Hex {
  return keccak256(canonicalBytes(value));
}

// head_n = keccak256(head_(n-1) ‖ eventHash_n), head_0 = 0x00…00
export function nextHead(prevHead: Hex, eventHash: Hex): Hex {
  return keccak256(concat([prevHead, eventHash]));
}

export function chainHeads(eventHashes: Hex[], start: Hex = ZERO_HASH): Hex[] {
  const heads: Hex[] = [];
  let head = start;
  for (const h of eventHashes) {
    head = nextHead(head, h);
    heads.push(head);
  }
  return heads;
}

// Invite codes are never stored raw. The slug is known before the conversation
// exists onchain, so the code root can be committed in createConversation.
export function inviteCodeHash(slug: string, code: string): Hex {
  return keccak256(toBytes(`townsquare:code:${slug}:${normalizeCode(code)}`));
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

// Per-conversation Anon Aadhaar nullifier seed: first 10 bytes of H(appSeed ‖ slug).
export function aadhaarNullifierSeed(appSeed: string, slug: string): bigint {
  const h = keccak256(toBytes(`${appSeed}:${slug}`));
  return BigInt(h.slice(0, 2 + 20));
}

// Semaphore join proof inputs. scope gives one pid per identity per conversation;
// message binds the proof to the session key so a stolen proof can't register another key.
export function joinScope(slug: string): bigint {
  return BigInt(keccak256(toBytes(`townsquare:join:${slug}`)));
}

export function joinMessage(sessionKeySpkiB64: string): bigint {
  return BigInt(keccak256(base64ToBytes(sessionKeySpkiB64)));
}

export function hexToBase64(hex: Hex): string {
  return bytesToBase64(toBytes(hex));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
