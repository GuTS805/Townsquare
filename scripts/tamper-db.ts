// The tamper demo: act as a database admin, switch off the append-only trigger and flip
// one vote in the log. The Verify page then goes red at C, D and E. --restore puts it back.
//
//   DATABASE_URL=... pnpm --filter @townsquare/scripts tamper -- --slug ts_xxxxxx [--seq 42]
//   DATABASE_URL=... pnpm --filter @townsquare/scripts tamper -- --restore
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { arg, flag, loadState } from "./lib";

const BACKUP = fileURLToPath(new URL("./.tamper-backup.json", import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) throw new Error("set DATABASE_URL");
const sql = postgres(url, { prepare: false });

async function withTriggerOff(fn: () => Promise<void>) {
  await sql`alter table events disable trigger events_no_update`;
  try {
    await fn();
  } finally {
    await sql`alter table events enable trigger events_no_update`;
  }
}

async function main() {
  if (flag("restore")) {
    const b = JSON.parse(readFileSync(BACKUP, "utf8"));
    await withTriggerOff(async () => {
      await sql`update events set body = ${sql.json(b.body)} where conv_id = ${b.convId} and seq = ${b.seq}`;
      await sql`update votes set value = ${b.voteValue} where conv_id = ${b.convId} and pid = ${b.pid} and sid = ${b.sid}`;
    });
    rmSync(BACKUP);
    console.log(`restored seq ${b.seq} in ${b.slug}`);
    return;
  }

  const slug = arg("slug", (() => {
    try {
      return loadState().slug;
    } catch {
      return "";
    }
  })());
  if (!slug) throw new Error("pass --slug");
  const [conv] = await sql<{ id: string }[]>`select id from conversations where slug = ${slug}`;
  if (!conv) throw new Error(`no conversation ${slug}`);

  const seqArg = arg("seq", "");
  const [ev] = seqArg
    ? await sql<{ seq: number; body: any }[]>`select seq, body from events where conv_id = ${conv.id} and seq = ${Number(seqArg)} and type = 'VOTE'`
    : await sql<{ seq: number; body: any }[]>`select seq, body from events where conv_id = ${conv.id} and type = 'VOTE' order by seq desc limit 1`;
  if (!ev) throw new Error("no vote event to tamper with");

  const a = ev.body.action;
  const flipped = a.value === 1 ? -1 : 1;
  const [vote] = await sql<{ value: number }[]>`select value from votes where conv_id = ${conv.id} and pid = ${a.pid} and sid = ${a.sid}`;
  writeFileSync(BACKUP, JSON.stringify({ slug, convId: conv.id, seq: ev.seq, body: ev.body, pid: a.pid, sid: a.sid, voteValue: vote?.value ?? a.value }));

  await withTriggerOff(async () => {
    await sql`update events set body = ${sql.json({ ...ev.body, action: { ...a, value: flipped } })} where conv_id = ${conv.id} and seq = ${ev.seq}`;
    await sql`update votes set value = ${flipped} where conv_id = ${conv.id} and pid = ${a.pid} and sid = ${a.sid}`;
  });
  console.log(`flipped the vote at seq ${ev.seq} (#${a.sid}: ${a.value} → ${flipped}) in ${slug}`);
  console.log("now open the Verify page. Undo with --restore");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
