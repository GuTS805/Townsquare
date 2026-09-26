import { base64ToBytes, bytesToBase64 } from "./hash";
import { canonicalBytes } from "./jcs";

// ECDSA P-256 over SHA-256 via WebCrypto, which Node and every browser ship.
// Signatures are the raw 64-byte r‖s form WebCrypto produces, base64 encoded.

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

const subtle = () => globalThis.crypto.subtle;

export async function generateSessionKey(extractable = false): Promise<CryptoKeyPair> {
  return subtle().generateKey(ALG, extractable, ["sign", "verify"]);
}

export async function exportSpki(key: CryptoKey): Promise<string> {
  return bytesToBase64(new Uint8Array(await subtle().exportKey("spki", key)));
}

export async function importSpki(spkiB64: string): Promise<CryptoKey> {
  return subtle().importKey("spki", base64ToBytes(spkiB64), ALG, true, ["verify"]);
}

export async function importPkcs8(pkcs8B64: string): Promise<CryptoKey> {
  return subtle().importKey("pkcs8", base64ToBytes(pkcs8B64), ALG, false, ["sign"]);
}

export async function signPayload(privateKey: CryptoKey, payload: unknown): Promise<string> {
  const sig = await subtle().sign(SIGN, privateKey, canonicalBytes(payload));
  return bytesToBase64(new Uint8Array(sig));
}

export async function verifyPayload(publicKey: CryptoKey | string, payload: unknown, sigB64: string): Promise<boolean> {
  try {
    const key = typeof publicKey === "string" ? await importSpki(publicKey) : publicKey;
    return await subtle().verify(SIGN, key, base64ToBytes(sigB64), canonicalBytes(payload));
  } catch {
    return false;
  }
}
