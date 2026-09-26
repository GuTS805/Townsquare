import { batchRoot } from "@townsquare/core";
import type { Hex } from "viem";
import type { Ctx } from "../context";

interface Pending {
  conv_id: string;
  chain_conv_id: string | null;
  last_seq: number;
  anchored_to: number;
}

// Conversations with events not yet covered by a batch.
async function pendingConversations(ctx: Ctx): Promise<Pending[]> {
  return ctx.sql<Pending[]>`
    select c.id as conv_id, c.chain_conv_id, c.next_seq - 1 as last_seq,
           coalesce((select max(to_seq) from batches b where b.conv_id = c.id), 0)::bigint as anchored_to
    from conversations c
    where c.next_seq - 1 > coalesce((select max(to_seq) from batches b where b.conv_id = c.id), 0)
       or exists (select 1 from batches b where b.conv_id = c.id and b.status in ('pending', 'sent', 'failed'))`;
}

// The job loop and seal can both anchor; never let them race on one conversation.
const locks = new Map<string, Promise<void>>();

export function anchorConversation(ctx: Ctx, convId: string, force = false): Promise<void> {
  const prev = locks.get(convId) ?? Promise.resolve();
  const next = prev.then(() => anchorOnce(ctx, convId, force));
  const settled = next.catch(() => undefined);
  locks.set(convId, settled);
  void settled.then(() => {
    if (locks.get(convId) === settled) locks.delete(convId);
  });
  return next;
}

// One batch per conversation per call. An unfinished batch is retried before a new one is cut,
// because the contract only accepts fromSeq == nextSeq.
async function anchorOnce(ctx: Ctx, convId: string, force: boolean): Promise<void> {
  const [p] = (await pendingConversations(ctx)).filter((x) => x.conv_id === convId);
  if (!p) return;

  let [batch] = await ctx.sql<{ batch_id: number; from_seq: number; to_seq: number; root: Hex; head: Hex }[]>`
    select batch_id, from_seq, to_seq, root, head from batches
    where conv_id = ${convId} and status in ('pending', 'sent', 'failed') order by batch_id limit 1`;

  if (!batch) {
    const count = p.last_seq - p.anchored_to;
    if (count <= 0) return;
    if (!force && count < ctx.env.ANCHOR_MAX_EVENTS && !(await oldEnough(ctx, convId, p.anchored_to + 1))) return;

    const events = await ctx.sql<{ seq: number; event_hash: Hex; chain_head: Hex }[]>`
      select seq, event_hash, chain_head from events
      where conv_id = ${convId} and seq > ${p.anchored_to} and seq <= ${p.last_seq} order by seq`;
    const root = batchRoot(events.map((e) => ({ seq: e.seq, eventHash: e.event_hash })));
    const last = events[events.length - 1]!;
    const [b] = await ctx.sql<{ batch_id: number }[]>`
      insert into batches (conv_id, batch_id, from_seq, to_seq, root, head, status)
      values (${convId}, coalesce((select max(batch_id) from batches where conv_id = ${convId}), 0) + 1,
              ${events[0]!.seq}, ${last.seq}, ${root}, ${last.chain_head}, 'pending')
      returning batch_id`;
    batch = { batch_id: b!.batch_id, from_seq: events[0]!.seq, to_seq: last.seq, root, head: last.chain_head };
  }

  if (!p.chain_conv_id) {
    await ctx.sql`update batches set status = 'confirmed' where conv_id = ${convId} and batch_id = ${batch.batch_id}`;
    return;
  }

  try {
    // A batch may already be onchain if we crashed after sending it. Resending would revert.
    const chainNext = await ctx.relayer.onchainNextSeq(p.chain_conv_id);
    if (chainNext !== null && chainNext > batch.to_seq) {
      const tx = await ctx.relayer.findAnchorTx(p.chain_conv_id, batch.from_seq);
      await ctx.sql`
        update batches set status = 'confirmed', tx_hash = ${tx}
        where conv_id = ${convId} and batch_id = ${batch.batch_id}`;
      ctx.log.warn({ convId, batch: batch.batch_id, tx }, "batch was already anchored, recovered");
      return;
    }
    if (chainNext !== null && chainNext !== batch.from_seq) {
      throw new Error(`chain expects seq ${chainNext}, batch starts at ${batch.from_seq}`);
    }
    await ctx.sql`update batches set status = 'sent' where conv_id = ${convId} and batch_id = ${batch.batch_id}`;
    const tx = await ctx.relayer.anchor(p.chain_conv_id, batch.root, batch.from_seq, batch.to_seq, batch.head);
    await ctx.sql`
      update batches set status = 'confirmed', tx_hash = ${tx}
      where conv_id = ${convId} and batch_id = ${batch.batch_id}`;
  } catch (err) {
    await ctx.sql`update batches set status = 'failed' where conv_id = ${convId} and batch_id = ${batch.batch_id}`;
    ctx.log.error({ err, convId, batch: batch.batch_id }, "anchor failed");
  }
}

async function oldEnough(ctx: Ctx, convId: string, seq: number) {
  const [e] = await ctx.sql<{ age_ms: number }[]>`
    select (extract(epoch from now() - t) * 1000)::float8 as age_ms from events where conv_id = ${convId} and seq = ${seq}`;
  // event timestamps are rounded down to the minute, so this errs toward anchoring early
  return !!e && e.age_ms >= ctx.env.ANCHOR_INTERVAL_MS;
}

export async function anchorAll(ctx: Ctx, force = false) {
  for (const p of await pendingConversations(ctx)) {
    // keep anchoring until caught up when forced (shutdown, close)
    let guard = 0;
    do {
      await anchorConversation(ctx, p.conv_id, force);
    } while (force && ++guard < 50 && (await hasUnanchored(ctx, p.conv_id)));
  }
}

export async function hasUnanchored(ctx: Ctx, convId: string) {
  const [r] = await ctx.sql<{ n: number }[]>`
    select (c.next_seq - 1 - coalesce((select max(to_seq) from batches b where b.conv_id = c.id and b.status = 'confirmed'), 0))::int as n
    from conversations c where c.id = ${convId}`;
  return (r?.n ?? 0) > 0;
}
