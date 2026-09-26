import type { Ctx } from "../context";
import type { ConversationRow } from "../db";
import { loadEvents } from "../eventlog";
import { publicView } from "./conversations";

// Everything an auditor needs to re-run checks A–F, apart from chain data,
// which the verifier reads from a public RPC itself.
export async function auditBundle(ctx: Ctx, conv: ConversationRow) {
  const [config, gateRecords, members, events, batches, results] = await Promise.all([
    publicView(ctx, conv),
    ctx.sql`
      select gate_type, nullifier, commitment, proof, proof_hash, tx_hash, t
      from gate_records where conv_id = ${conv.id} order by id`,
    ctx.sql`
      select leaf_index, commitment, root_after, size_after
      from members where conv_id = ${conv.id} order by leaf_index`,
    loadEvents(ctx.sql, conv.id),
    ctx.sql`
      select batch_id, from_seq, to_seq, root, head, tx_hash, status
      from batches where conv_id = ${conv.id} order by batch_id`,
    ctx.sql`
      select at_seq, math, result_hash, synthesis, model, prompt_hash, params, created_at
      from results where conv_id = ${conv.id} order by id desc limit 1`,
  ]);
  return {
    v: 1,
    meta: meta(ctx),
    conversation: config,
    gateRecords,
    members,
    events,
    batches,
    result: results[0] ?? null,
  };
}

export function meta(ctx: Ctx) {
  return {
    chainId: ctx.relayer.chainId,
    hubAddress: ctx.relayer.hubAddress,
    semaphoreAddress: ctx.env.SEMAPHORE_ADDRESS,
    relayer: ctx.relayer.address,
    onchain: ctx.relayer.enabled,
    logPublicKey: ctx.logKey.publicKeySpki,
    logKeyEphemeral: ctx.logKey.ephemeral,
    aadhaarMode: ctx.env.AADHAAR_MODE,
    software: "townsquare@0.1.0",
    math: "pocket-polis@7a725cd",
  };
}
