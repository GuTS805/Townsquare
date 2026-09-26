import { base64ToBytes, bytesToBase64 } from "@townsquare/core";

export interface LogKey {
  privateKey: CryptoKey;
  publicKeySpki: string;
  ephemeral: boolean;
}

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;

// LOG_SIGNING_KEY is a base64 PKCS8 P-256 key. Without one (local dev) a fresh key is
// generated per process, which means receipts from earlier runs no longer verify.
export async function loadLogKey(pkcs8B64: string | undefined): Promise<LogKey> {
  const subtle = globalThis.crypto.subtle;
  if (!pkcs8B64) {
    const kp = await subtle.generateKey(ALG, true, ["sign", "verify"]);
    const spki = new Uint8Array(await subtle.exportKey("spki", kp.publicKey));
    return { privateKey: kp.privateKey, publicKeySpki: bytesToBase64(spki), ephemeral: true };
  }
  const extractable = await subtle.importKey("pkcs8", base64ToBytes(pkcs8B64), ALG, true, ["sign"]);
  const { d: _d, key_ops: _ops, ...pub } = await subtle.exportKey("jwk", extractable);
  const publicKey = await subtle.importKey("jwk", { ...pub, key_ops: ["verify"] }, ALG, true, ["verify"]);
  const privateKey = await subtle.importKey("pkcs8", base64ToBytes(pkcs8B64), ALG, false, ["sign"]);
  const spki = new Uint8Array(await subtle.exportKey("spki", publicKey));
  return { privateKey, publicKeySpki: bytesToBase64(spki), ephemeral: false };
}

export async function generateLogKeyPkcs8(): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const kp = await subtle.generateKey(ALG, true, ["sign", "verify"]);
  return bytesToBase64(new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey)));
}
