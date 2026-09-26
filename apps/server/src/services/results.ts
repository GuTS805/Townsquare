import { ZERO_HASH, resultHash } from "@townsquare/core";
import { computeMath, privacySafeMathResult, type OpinionPoint, type VoteRow } from "@townsquare/math";
import type { Hex } from "viem";
import type { Ctx } from "../context";

// "You are here" points stay in memory only; the public result never carries pids.
const pidPointsCache = new Map<string, Record<string, OpinionPoint>>();

export interface MathInputs {
  slug: string;
  atSeq: number;
  head: Hex;
  votes: VoteRow[];
  statementIds: number[];
}

// Same function the verifier runs for check E. computedAt is the log position,
// not wall-clock time, and previousK is not used, so the output depends only on the log.
export function computeResult(input: MathInputs) {
  const { publicResult, pidPoints } = computeMath({
    conversationId: input.slug,
    votes: input.votes,
    statementIds: input.statementIds,
    computedAt: input.atSeq,
    previousK: null,
  });
  const math = privacySafeMathResult(publicResult);
  const hash = resultHash({ conv: input.slug, atSeq: input.atSeq, head: input.head, math });
  return { math, hash, pidPoints };
}

export async function recomputeResults(ctx: Ctx, convId: string) {
  const inputs = await ctx.sql.begin("isolation level repeatable read", async (tx) => {
    const [c] = await tx<{ slug: string; last_seq: number }[]>`
      select slug, next_seq - 1 as last_seq from conversations where id = ${convId}`;
    if (!c) return null;
    const [h] = await tx<{ chain_head: Hex }[]>`
      select chain_head from events where conv_id = ${convId} and seq = ${c.last_seq}`;
    const statements = await tx<{ sid: number }[]>`
      select sid from statements where conv_id = ${convId} and status = 'approved' order by sid`;
    const votes = await tx<{ pid: string; sid: number; value: -1 | 0 | 1 }[]>`
      select v.pid, v.sid, v.value from votes v
      join statements s on s.conv_id = v.conv_id and s.sid = v.sid and s.status = 'approved'
      where v.conv_id = ${convId}
      order by v.seq`;
    return {
      slug: c.slug,
      atSeq: c.last_seq,
      head: h?.chain_head ?? ZERO_HASH,
      votes: votes.map((v) => ({ pid: v.pid, sid: v.sid, value: v.value })),
      statementIds: statements.map((s) => s.sid),
    } satisfies MathInputs;
  });
  if (!inputs) return null;

  const [latest] = await ctx.sql<{ at_seq: number }[]>`
    select at_seq from results where conv_id = ${convId} order by id desc limit 1`;
  if (latest && latest.at_seq === inputs.atSeq) return null;

  const started = performance.now();
  const { math, hash, pidPoints } = computeResult(inputs);
  pidPointsCache.set(convId, pidPoints);

  await ctx.sql`
    insert into results (conv_id, at_seq, math, result_hash, params)
    values (${convId}, ${inputs.atSeq}, ${ctx.sql.json(math as never)}, ${hash},
            ${ctx.sql.json({ head: inputs.head, k: 3, version: "pocket-polis@7a725cd" })})`;
  ctx.log.info({ convId, atSeq: inputs.atSeq, ms: Math.round(performance.now() - started) }, "results computed");
  return { atSeq: inputs.atSeq, hash };
}

export async function latestResult(ctx: Ctx, convId: string) {
  const [r] = await ctx.sql<
    { at_seq: number; math: unknown; result_hash: Hex; synthesis: unknown; model: string | null; params: { head: Hex }; created_at: Date }[]
  >`select at_seq, math, result_hash, synthesis, model, params, created_at from results
    where conv_id = ${convId} order by id desc limit 1`;
  return r ?? null;
}

export async function whereAmI(ctx: Ctx, convId: string, pid: string): Promise<OpinionPoint | null> {
  if (!pidPointsCache.has(convId)) await recomputeResults(ctx, convId);
  return pidPointsCache.get(convId)?.[pid] ?? null;
}
