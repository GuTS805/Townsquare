import canonicalizeImpl from "canonicalize";

// RFC 8785 (JSON Canonicalization Scheme). Every hash and signature in Townsquare
// is taken over these bytes, so the browser, the server and the verifier agree.
export function canonicalize(value: unknown): string {
  const out = (canonicalizeImpl as (v: unknown) => string | undefined)(value);
  if (out === undefined) throw new Error("value cannot be canonicalized");
  return out;
}

export function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalize(value));
}
