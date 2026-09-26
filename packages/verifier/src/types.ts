import type { EventType } from "@townsquare/core";
import type { Hex } from "viem";

// Shape served by GET /api/c/:slug/bundle. Nothing in here is trusted by the checks:
// every hash is recomputed and every chain-backed claim is compared with chain data.
export interface Bundle {
  v: 1;
  meta: {
    chainId: number;
    hubAddress: Hex | null;
    semaphoreAddress: string;
    onchain: boolean;
    logPublicKey: string;
  };
  conversation: {
    slug: string;
    phase: string;
    configHash: Hex;
    minMembers: number;
    gate: { type: "invite_code" | "anon_aadhaar"; codeRoot: Hex | null };
    chain: { convId: string; groupId: string | null; txHash: Hex | null } | null;
    finalResultHash: Hex | null;
  };
  gateRecords: {
    gate_type: string;
    nullifier: string;
    commitment: string;
    proof: unknown;
    proof_hash: Hex;
    tx_hash: Hex | null;
  }[];
  members: { leaf_index: number; commitment: string; root_after: string; size_after: number }[];
  events: {
    v: 1;
    conv: string;
    seq: number;
    type: EventType;
    body: any;
    sig: string | null;
    t: string;
    eventHash: Hex;
    chainHead: Hex;
  }[];
  batches: { batch_id: number; from_seq: number; to_seq: number; root: Hex; head: Hex; tx_hash: Hex | null; status: string }[];
  result: { at_seq: number; math: unknown; result_hash: Hex; params: { head: Hex } } | null;
}

// Read straight from the hub contract through a public RPC, never from the API.
export interface ChainData {
  created: { groupId: string; configHash: Hex; gate: number; codeRoot: Hex } | null;
  members: { commitment: string; gateNullifier: string; proofHash: Hex; txHash: Hex }[];
  batches: { batch: number; root: Hex; fromSeq: number; toSeq: number; head: Hex; txHash: Hex }[];
  closed: { finalResultHash: Hex } | null;
}

export type CheckId = "A" | "B" | "C" | "D" | "E";

export interface CheckResult {
  id: CheckId;
  name: string;
  status: "pass" | "fail" | "warn";
  summary: string;
  failures: string[];
  ms: number;
}
