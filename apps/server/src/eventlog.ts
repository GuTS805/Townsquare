import { ZERO_HASH, eventHash, nextHead, roundToMinute, type EventType, type LogEvent } from "@townsquare/core";
import type { Hex } from "viem";
import type { Sql, Tx } from "./db";

export interface Appended {
  seq: number;
  eventHash: Hex;
  head: Hex;
}

// Must run inside a transaction. Bumping next_seq takes a row lock on the conversation,
// so appends for one conversation are serialized and the log stays gap-free.
export async function appendEvent(
  tx: Tx,
  convId: string,
  type: EventType,
  body: unknown,
  sig: string | null = null,
): Promise<Appended> {
  const [row] = await tx<{ seq: number; slug: string }[]>`
    update conversations set next_seq = next_seq + 1
    where id = ${convId}
    returning next_seq - 1 as seq, slug`;
  if (!row) throw new Error(`conversation ${convId} not found`);

  let prev: Hex = ZERO_HASH;
  if (row.seq > 1) {
    const [p] = await tx<{ chain_head: Hex }[]>`
      select chain_head from events where conv_id = ${convId} and seq = ${row.seq - 1}`;
    if (!p) throw new Error(`log gap before seq ${row.seq}`);
    prev = p.chain_head;
  }

  const event: LogEvent = { v: 1, conv: row.slug, seq: row.seq, type, body, sig, t: roundToMinute() };
  const h = eventHash(event);
  const head = nextHead(prev, h);

  await tx`
    insert into events (conv_id, seq, type, body, sig, event_hash, chain_head, t)
    values (${convId}, ${row.seq}, ${type}, ${tx.json(body as never)}, ${sig}, ${h}, ${head}, ${event.t})`;

  return { seq: row.seq, eventHash: h, head };
}

export interface StoredEvent extends LogEvent {
  eventHash: Hex;
  chainHead: Hex;
}

export async function loadEvents(sql: Sql, convId: string, fromSeq = 1, toSeq?: number): Promise<StoredEvent[]> {
  const rows = await sql<
    { seq: number; type: EventType; body: unknown; sig: string | null; event_hash: Hex; chain_head: Hex; t: Date; slug: string }[]
  >`
    select e.seq, e.type, e.body, e.sig, e.event_hash, e.chain_head, e.t, c.slug
    from events e join conversations c on c.id = e.conv_id
    where e.conv_id = ${convId} and e.seq >= ${fromSeq}
      ${toSeq === undefined ? sql`` : sql`and e.seq <= ${toSeq}`}
    order by e.seq`;
  return rows.map((r) => ({
    v: 1,
    conv: r.slug,
    seq: r.seq,
    type: r.type,
    body: r.body,
    sig: r.sig,
    t: r.t.toISOString(),
    eventHash: r.event_hash,
    chainHead: r.chain_head,
  }));
}
