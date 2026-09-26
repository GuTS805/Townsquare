import { TsError, codeTree, hashJson, inviteCodeHash } from "@townsquare/core";
import { hexToBigInt, type Hex } from "viem";
import type { Ctx } from "../context";
import type { ConversationRow } from "../db";
import { recordMember } from "./members";

export interface MemberAddedResult {
  memberIndex: number;
  txHash: Hex | null;
}

// Serialize member additions per process so leaf order matches the chain.
let memberChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = memberChain.then(fn, fn);
  memberChain = next.catch(() => undefined);
  return next;
}

export async function passCodeGate(
  ctx: Ctx,
  conv: ConversationRow,
  code: string,
  commitment: string,
): Promise<MemberAddedResult> {
  if (conv.gate_type !== "invite_code") throw new TsError("BAD_REQUEST", "this conversation does not use invite codes");
  if (conv.phase === "closed" || conv.phase === "sealed") throw new TsError("WRONG_PHASE", "registration is closed");

  const codeHash = inviteCodeHash(conv.slug, code);
  const nullifier = hexToBigInt(codeHash).toString();

  const all = await ctx.sql<{ code_hash: Hex; used_at: Date | null }[]>`
    select code_hash, used_at from invite_codes where conv_id = ${conv.id} order by code_hash`;
  const row = all.find((r) => r.code_hash === codeHash);
  if (!row) throw new TsError("BAD_CODE", "invite code not valid for this conversation");
  if (row.used_at) throw new TsError("CODE_USED", "invite code already used");

  // Public evidence for check A: the code hash and its path to the onchain codeRoot.
  const tree = codeTree(all.map((r) => r.code_hash));
  let proofPath: Hex[] = [];
  for (const [i, leaf] of tree.entries()) if (leaf[0] === codeHash) proofPath = tree.getProof(i) as Hex[];
  const proof = { codeHash, merkleProof: proofPath };
  const proofHash = hashJson(proof);

  return serial(async () => {
    try {
      await ctx.sql.begin(async (tx) => {
        const used = await tx`
          update invite_codes set used_at = date_trunc('minute', now())
          where conv_id = ${conv.id} and code_hash = ${codeHash} and used_at is null
          returning code_hash`;
        if (used.length === 0) throw new TsError("CODE_USED", "invite code already used");
        await tx`
          insert into gate_records (conv_id, gate_type, nullifier, commitment, proof, proof_hash)
          values (${conv.id}, 'invite_code', ${nullifier}, ${commitment}, ${tx.json(proof)}, ${proofHash})`;
      });
    } catch (e) {
      throw mapUniqueViolation(e);
    }

    let txHash: Hex | null = null;
    let blockNumber = 0;
    if (conv.chain_conv_id) {
      try {
        const added = await ctx.relayer.addMember(conv.chain_conv_id, commitment, nullifier, proofHash);
        txHash = added?.txHash ?? null;
        blockNumber = added?.blockNumber ?? 0;
      } catch (e) {
        // Roll the local record back so the code can be retried.
        await ctx.sql.begin(async (tx) => {
          await tx`delete from gate_records where conv_id = ${conv.id} and nullifier = ${nullifier}`;
          await tx`update invite_codes set used_at = null where conv_id = ${conv.id} and code_hash = ${codeHash}`;
        });
        ctx.log.error({ err: e, slug: conv.slug }, "addMember failed");
        throw new TsError("CHAIN_ERROR", "could not add member onchain, try again");
      }
      await ctx.sql`update gate_records set tx_hash = ${txHash} where conv_id = ${conv.id} and nullifier = ${nullifier}`;
    }

    const m = await recordMember(ctx, conv.id, commitment, blockNumber);
    return { memberIndex: m.leafIndex + 1, txHash };
  });
}

function mapUniqueViolation(e: unknown): unknown {
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505") {
    const detail = String((e as { constraint_name?: string }).constraint_name ?? "");
    if (detail.includes("commitment")) return new TsError("BAD_REQUEST", "identity already registered");
    return new TsError("GATE_NULLIFIER_USED", "this credential already registered");
  }
  return e;
}
