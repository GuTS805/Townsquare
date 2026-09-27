import { TsError, codeTree, hashJson, inviteCodeHash } from "@townsquare/core";
import { aadhaarPolicyFailure, aadhaarProofSchema, verifyAadhaarSnark } from "@townsquare/verifier";
import { hexToBigInt, type Hex } from "viem";
import type { Ctx } from "../context";
import type { ConversationRow } from "../db";
import { recordMember } from "./members";

export interface MemberAddedResult {
  memberIndex: number;
  txHash: Hex | null;
}

// Members must be recorded locally in the order the chain adds them, or leaf indexes and
// roots drift from the Semaphore contract. relayer.addMember queues synchronously, and the
// local record is appended to this chain in the same tick, so both orders are call order.
let recordChain: Promise<unknown> = Promise.resolve();

function requireOpenGate(conv: ConversationRow, type: ConversationRow["gate_type"]) {
  if (conv.gate_type !== type) throw new TsError("BAD_REQUEST", `this conversation does not use ${type === "invite_code" ? "invite codes" : "Anon Aadhaar"}`);
  if (conv.phase === "closed" || conv.phase === "sealed") throw new TsError("WRONG_PHASE", "registration is closed");
}

interface Admission {
  gateType: ConversationRow["gate_type"];
  nullifier: string;
  commitment: string;
  proof: unknown;
  codeHash?: Hex;
}

// Record the gate evidence, add the commitment onchain, then mirror the member locally.
// If the chain rejects it, the local record is rolled back so the credential can be retried.
// People registering at the same time share one addMembers transaction.
async function admit(ctx: Ctx, conv: ConversationRow, a: Admission): Promise<MemberAddedResult> {
  const proofHash = hashJson(a.proof);
  try {
    await ctx.sql.begin(async (tx) => {
      if (a.codeHash) {
        const used = await tx`
          update invite_codes set used_at = date_trunc('minute', now())
          where conv_id = ${conv.id} and code_hash = ${a.codeHash} and used_at is null
          returning code_hash`;
        if (used.length === 0) throw new TsError("CODE_USED", "invite code already used");
      }
      await tx`
        insert into gate_records (conv_id, gate_type, nullifier, commitment, proof, proof_hash)
        values (${conv.id}, ${a.gateType}, ${a.nullifier}, ${a.commitment}, ${tx.json(a.proof as never)}, ${proofHash})`;
    });
  } catch (e) {
    throw mapUniqueViolation(e);
  }

  // Same tick from here to the recordChain append: that is what keeps the two orders equal.
  const onchain = conv.chain_conv_id
    ? ctx.relayer.addMember(conv.chain_conv_id, a.commitment, a.nullifier, proofHash)
    : Promise.resolve(null);
  onchain.catch(() => undefined); // handled below; avoids an unhandled rejection while queued

  const result = recordChain.then(async () => {
    let added: Awaited<typeof onchain>;
    try {
      added = await onchain;
    } catch (e) {
      await ctx.sql.begin(async (tx) => {
        await tx`delete from gate_records where conv_id = ${conv.id} and nullifier = ${a.nullifier}`;
        if (a.codeHash) await tx`update invite_codes set used_at = null where conv_id = ${conv.id} and code_hash = ${a.codeHash}`;
      });
      ctx.log.error({ err: e, slug: conv.slug }, "addMember failed");
      throw new TsError("CHAIN_ERROR", "could not add member onchain, try again");
    }
    if (added) await ctx.sql`update gate_records set tx_hash = ${added.txHash} where conv_id = ${conv.id} and nullifier = ${a.nullifier}`;
    const m = await recordMember(ctx, conv.id, a.commitment, added?.blockNumber ?? 0);
    return { memberIndex: m.leafIndex + 1, txHash: added?.txHash ?? null };
  });
  recordChain = result.catch(() => undefined);
  return result;
}

export async function passCodeGate(ctx: Ctx, conv: ConversationRow, code: string, commitment: string): Promise<MemberAddedResult> {
  requireOpenGate(conv, "invite_code");
  const codeHash = inviteCodeHash(conv.slug, code);

  const all = await ctx.sql<{ code_hash: Hex; used_at: Date | null }[]>`
    select code_hash, used_at from invite_codes where conv_id = ${conv.id} order by code_hash`;
  const row = all.find((r) => r.code_hash === codeHash);
  if (!row) throw new TsError("BAD_CODE", "invite code not valid for this conversation");
  if (row.used_at) throw new TsError("CODE_USED", "invite code already used");

  // Public evidence for check A: the code hash and its path to the onchain codeRoot.
  const tree = codeTree(all.map((r) => r.code_hash));
  let merkleProof: Hex[] = [];
  for (const [i, leaf] of tree.entries()) if (leaf[0] === codeHash) merkleProof = tree.getProof(i) as Hex[];

  return admit(ctx, conv, {
    gateType: "invite_code",
    nullifier: hexToBigInt(codeHash).toString(),
    commitment,
    proof: { codeHash, merkleProof },
    codeHash,
  });
}

export async function passAadhaarGate(ctx: Ctx, conv: ConversationRow, rawProof: unknown, commitment: string): Promise<MemberAddedResult> {
  requireOpenGate(conv, "anon_aadhaar");
  const parsed = aadhaarProofSchema.safeParse(rawProof);
  if (!parsed.success) throw new TsError("BAD_PROOF", "not an Anon Aadhaar proof");
  const proof = parsed.data;

  const why = aadhaarPolicyFailure(proof, {
    mode: ctx.env.AADHAAR_MODE,
    nullifierSeed: conv.nullifier_seed ?? "",
    commitment,
    freshnessDays: conv.freshness_days,
    reveal: conv.reveal,
    at: Math.floor(Date.now() / 1000),
  });
  if (why) throw new TsError("BAD_PROOF", why);

  const [dup] = await ctx.sql`select 1 from gate_records where conv_id = ${conv.id} and nullifier = ${proof.nullifier}`;
  if (dup) throw new TsError("GATE_NULLIFIER_USED", "this Aadhaar already registered here");
  if (!(await verifyAadhaarSnark(proof))) throw new TsError("BAD_PROOF", "Anon Aadhaar proof does not verify");

  return admit(ctx, conv, { gateType: "anon_aadhaar", nullifier: proof.nullifier, commitment, proof });
}

function mapUniqueViolation(e: unknown): unknown {
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505") {
    const detail = String((e as { constraint_name?: string }).constraint_name ?? "");
    if (detail.includes("commitment")) return new TsError("BAD_REQUEST", "identity already registered");
    return new TsError("GATE_NULLIFIER_USED", "this credential already registered");
  }
  return e;
}
