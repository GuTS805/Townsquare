// Replays and forges votes: resend a signed vote, change it after signing, vote as a pid
// you don't hold, sign for another conversation. Every attempt should be rejected.
//
//   pnpm --filter @townsquare/scripts attack:replay
import { importPkcs8, signPayload } from "@townsquare/core";
import { client, loadState, saveState, tally } from "./lib";

const s = loadState();
const api = client(s.api);
const t = tally();

async function main() {
  console.log(`attacking ${s.slug} as one real member`);
  const key = await importPkcs8(s.member.pkcs8);
  const base = { v: 1, conv: s.slug, pid: s.member.pid, keyVersion: s.member.keyVersion, kind: "vote", sid: 1 } as const;

  // one honest vote, so there is something to replay
  const nonce = s.member.nonce + 1;
  const honest = { ...base, value: 1, nonce };
  const sig = await signPayload(key, honest);
  const first = await api(`/c/${s.slug}/actions`, { action: honest, sig });
  console.log(`honest vote: ${first.code}`);
  saveState({ ...s, member: { ...s.member, nonce } });

  for (let i = 0; i < 10; i++) t.add((await api(`/c/${s.slug}/actions`, { action: honest, sig })).code);
  for (let i = 0; i < 10; i++) {
    t.add((await api(`/c/${s.slug}/actions`, { action: { ...honest, value: -1, nonce: nonce + 1 + i }, sig })).code);
  }
  const stale = { ...base, value: -1, nonce: 1 };
  t.add((await api(`/c/${s.slug}/actions`, { action: stale, sig: await signPayload(key, stale) })).code);

  const someoneElse = { ...base, pid: "12345678901234567890", value: -1, nonce: 99 };
  t.add((await api(`/c/${s.slug}/actions`, { action: someoneElse, sig: await signPayload(key, someoneElse) })).code);

  const otherConv = { ...base, conv: "ts_other", value: -1, nonce: nonce + 50 };
  t.add((await api(`/c/${s.slug}/actions`, { action: otherConv, sig: await signPayload(key, otherConv) })).code);

  t.print("23 replayed or forged votes");
  const accepted = t.get("OK");
  console.log(accepted === 0 ? "\nall rejected ✓" : `\n${accepted} accepted ✗`);
  process.exit(accepted === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
