import { TsError } from "@townsquare/core";
import type { Ctx } from "../context";
import type { ConversationRow } from "../db";
import { anchorConversation, hasUnanchored } from "./anchor";
import { latestResult, recomputeResults } from "./results";
import { stopVoting } from "./conversations";

// Stop voting → final anchor → final math → close(conv, finalResultHash) onchain.
export async function sealConversation(ctx: Ctx, conv: ConversationRow) {
  if (conv.phase === "sealed") throw new TsError("WRONG_PHASE", "already sealed");
  if (conv.phase === "open") await stopVoting(ctx, conv);
  else if (conv.phase !== "closed") throw new TsError("WRONG_PHASE", `cannot seal from ${conv.phase}`);

  for (let i = 0; i < 20 && (await hasUnanchored(ctx, conv.id)); i++) {
    await anchorConversation(ctx, conv.id, true);
  }
  if (await hasUnanchored(ctx, conv.id)) throw new TsError("CHAIN_ERROR", "final anchor failed, try again");

  await recomputeResults(ctx, conv.id);
  const result = await latestResult(ctx, conv.id);
  if (!result) throw new TsError("INTERNAL", "no result to seal");

  let txHash = null;
  if (conv.chain_conv_id) {
    try {
      txHash = await ctx.relayer.close(conv.chain_conv_id, result.result_hash);
    } catch (err) {
      ctx.log.error({ err, slug: conv.slug }, "close failed");
      throw new TsError("CHAIN_ERROR", "could not seal onchain, try again");
    }
  }

  await ctx.sql`
    update conversations set phase = 'sealed', final_result_hash = ${result.result_hash}
    where id = ${conv.id}`;
  ctx.log.info({ slug: conv.slug, atSeq: result.at_seq, txHash }, "sealed");
  return { finalResultHash: result.result_hash, atSeq: result.at_seq, txHash };
}
