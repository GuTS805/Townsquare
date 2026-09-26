import { aadhaarSignalHash } from "@townsquare/core";
// @ts-expect-error snarkjs ships no types
import { groth16 } from "snarkjs";
import { z } from "zod";
// Anon Aadhaar v2 circuit verification key, from the project's published artifacts
// (anon-aadhaar-artifacts, v2.0.0/vkey.json). Bundled so verification never depends on a download.
import vkey from "./aadhaar-vkey.json";

// Hashes of the RSA keys that sign Secure QR codes (from @anon-aadhaar/core constants).
export const UIDAI_PUBKEY_HASH = "18063425702624337643644061197836918910810808173893535653269228433734128853484";
export const TEST_PUBKEY_HASH = "15134874015316324267425466444584014077184337590635665158241104437045239495873";

const num = z.string().regex(/^\d+$/);
export const aadhaarProofSchema = z.object({
  groth16Proof: z.object({
    pi_a: z.array(z.string()),
    pi_b: z.array(z.array(z.string())),
    pi_c: z.array(z.string()),
    protocol: z.string().optional(),
    curve: z.string().optional(),
  }),
  pubkeyHash: num,
  timestamp: num,
  nullifierSeed: num,
  nullifier: num,
  signalHash: num,
  ageAbove18: num,
  gender: num,
  pincode: num,
  state: num,
});
export type AadhaarProof = z.infer<typeof aadhaarProofSchema>;

export interface AadhaarPolicy {
  mode: "test" | "production";
  nullifierSeed: string;
  commitment: string;
  freshnessDays: number;
  reveal: string[];
  // when the proof was submitted (unix seconds); the QR must be recent relative to this
  at: number;
}

// Every rule except the SNARK itself. Returns a reason, or null when the proof fits the policy.
export function aadhaarPolicyFailure(p: AadhaarProof, policy: AadhaarPolicy): string | null {
  const expectedKey = policy.mode === "production" ? UIDAI_PUBKEY_HASH : TEST_PUBKEY_HASH;
  if (p.pubkeyHash !== expectedKey) return "QR is not signed by the expected UIDAI key";
  if (p.nullifierSeed !== policy.nullifierSeed) return "proof was made for a different conversation";
  if (p.signalHash !== aadhaarSignalHash(policy.commitment)) return "proof is not bound to this identity";
  const ts = Number(p.timestamp);
  if (ts > policy.at + 3600) return "QR timestamp is in the future";
  if (policy.at - ts > policy.freshnessDays * 86400) return `QR is older than ${policy.freshnessDays} days`;
  if (policy.reveal.includes("ageAbove18") && p.ageAbove18 !== "1") return "proof does not show age above 18";
  if (policy.reveal.includes("state") && p.state === "0") return "proof does not reveal the state";
  return null;
}

export async function verifyAadhaarSnark(p: AadhaarProof): Promise<boolean> {
  try {
    return await groth16.verify(
      vkey,
      [p.pubkeyHash, p.nullifier, p.timestamp, p.ageAbove18, p.gender, p.pincode, p.state, p.nullifierSeed, p.signalHash],
      p.groth16Proof,
    );
  } catch {
    return false;
  }
}
