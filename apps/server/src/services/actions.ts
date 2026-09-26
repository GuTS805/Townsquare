import {
  STATEMENT_MAX,
  STATEMENT_MIN,
  TsError,
  normalizeStatement,
  signReceipt,
  verifyPayload,
  type Action,
  type Receipt,
} from "@townsquare/core";
import type { Ctx } from "../context";
import type { ConversationRow } from "../db";
import { appendEvent } from "../eventlog";

export async function submitAction(ctx: Ctx, conv: ConversationRow, action: Action, sig: string): Promise<Receipt & { sid?: number }> {
  if (conv.phase !== "open") throw new TsError("WRONG_PHASE", "voting is not open");
  if (action.conv !== conv.slug) throw new TsError("WRONG_SCOPE", "action is for a different conversation");

  const result = await ctx.sql.begin(async (tx) => {
    const [p] = await tx<{ session_key_spki: string; key_version: number; last_nonce: number }[]>`
      select session_key_spki, key_version, last_nonce from participants
      where conv_id = ${conv.id} and pid = ${action.pid} for update`;
    if (!p) throw new TsError("UNKNOWN_PID", "join before voting");
    if (action.keyVersion !== p.key_version) throw new TsError("STALE_KEY", "session key was rotated");
    if (!(await verifyPayload(p.session_key_spki, action, sig))) throw new TsError("BAD_SIGNATURE", "signature does not match session key");
    if (action.nonce <= p.last_nonce) throw new TsError("NONCE_REPLAY", "nonce already used");

    await tx`update participants set last_nonce = ${action.nonce} where conv_id = ${conv.id} and pid = ${action.pid}`;

    if (action.kind === "vote") {
      const [s] = await tx<{ status: string }[]>`
        select status from statements where conv_id = ${conv.id} and sid = ${action.sid}`;
      if (!s || s.status !== "approved") throw new TsError("STATEMENT_NOT_OPEN", "statement not open for voting");
      const ev = await appendEvent(tx, conv.id, "VOTE", { action }, sig);
      await tx`
        insert into votes (conv_id, pid, sid, value, seq)
        values (${conv.id}, ${action.pid}, ${action.sid}, ${action.value}, ${ev.seq})
        on conflict (conv_id, pid, sid) do update set value = excluded.value, seq = excluded.seq`;
      return { ev };
    }

    const text = normalizeStatement(action.text);
    if (text.length < STATEMENT_MIN || text.length > STATEMENT_MAX) {
      throw new TsError("BAD_REQUEST", `statement must be ${STATEMENT_MIN}-${STATEMENT_MAX} characters`);
    }
    const [dup] = await tx`select 1 from statements where conv_id = ${conv.id} and text = ${text}`;
    if (dup) throw new TsError("DUPLICATE_STATEMENT", "that statement already exists");

    const [c] = await tx<{ sid: number }[]>`
      update conversations set next_sid = next_sid + 1 where id = ${conv.id} returning next_sid - 1 as sid`;
    const sid = c!.sid;
    const status = conv.moderation === "pre" ? "pending" : "approved";
    const ev = await appendEvent(tx, conv.id, "STATEMENT", { sid, text, author: action.pid, action }, sig);
    await tx`
      insert into statements (conv_id, sid, text, author_pid, status, seq)
      values (${conv.id}, ${sid}, ${text}, ${action.pid}, ${status}, ${ev.seq})`;
    return { ev, sid };
  });

  ctx.jobs.onNewVotes(conv.id);
  const receipt = await signReceipt(ctx.logKey.privateKey, {
    v: 1,
    conv: conv.slug,
    seq: result.ev.seq,
    eventHash: result.ev.eventHash,
    head: result.ev.head,
  });
  return "sid" in result ? { ...receipt, sid: result.sid } : receipt;
}

export async function moderate(
  ctx: Ctx,
  conv: ConversationRow,
  sid: number,
  status: "approved" | "rejected",
  reasonCode: string,
) {
  await ctx.sql.begin(async (tx) => {
    const [s] = await tx<{ status: string }[]>`
      select status from statements where conv_id = ${conv.id} and sid = ${sid} for update`;
    if (!s) throw new TsError("NOT_FOUND", "statement not found");
    if (s.status === status) return;
    await appendEvent(tx, conv.id, "MODERATE", { sid, status, reasonCode });
    await tx`update statements set status = ${status}, reason_code = ${reasonCode} where conv_id = ${conv.id} and sid = ${sid}`;
  });
  ctx.jobs.onNewVotes(conv.id);
}

// Least-seen approved statements first, skipping what this pid already voted on.
export async function nextStatement(ctx: Ctx, conv: ConversationRow, pid: string) {
  const rows = await ctx.sql<{ sid: number; text: string; seen: number }[]>`
    select s.sid, s.text, count(v.pid)::int as seen
    from statements s
    left join votes v on v.conv_id = s.conv_id and v.sid = s.sid
    where s.conv_id = ${conv.id} and s.status = 'approved'
      and not exists (select 1 from votes mine where mine.conv_id = s.conv_id and mine.sid = s.sid and mine.pid = ${pid})
    group by s.sid, s.text
    order by seen asc, s.sid asc
    limit 1`;
  const [totals] = await ctx.sql<{ total: number; mine: number }[]>`
    select
      (select count(*)::int from statements where conv_id = ${conv.id} and status = 'approved') as total,
      (select count(*)::int from votes where conv_id = ${conv.id} and pid = ${pid}) as mine`;
  return { statement: rows[0] ? { sid: rows[0].sid, text: rows[0].text } : null, seen: totals!.mine, total: totals!.total };
}
