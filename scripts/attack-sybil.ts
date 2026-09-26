// Tries to get extra voices in: guessed codes, a reused code, a forged or re-bound
// join proof, and a proof from outside the group. Every attempt should be rejected.
//
//   pnpm --filter @townsquare/scripts attack:sybil -- --tries 100
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";
import { exportSpki, generateSessionKey, joinMessage, joinScope } from "@townsquare/core";
import { arg, client, loadState, tally } from "./lib";

const s = loadState();
const api = client(s.api);
const TRIES = Number(arg("tries", "100"));
const t = tally();

const code = () => {
  const a = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const pick = () => Array.from({ length: 5 }, () => a[Math.floor(Math.random() * 32)]).join("");
  return `${pick()}-${pick()}`;
};

async function main() {
  console.log(`attacking ${s.slug}`);

  for (let i = 0; i < TRIES; i++) {
    t.add((await api(`/c/${s.slug}/gate/code`, { code: code(), commitment: new Identity().commitment.toString() })).code);
  }
  for (let i = 0; i < 5; i++) {
    t.add((await api(`/c/${s.slug}/gate/code`, { code: s.usedCode, commitment: new Identity().commitment.toString() })).code);
  }

  // A real member tries to mint a second pseudonym.
  const me = Identity.import(s.member.identity);
  const { data } = await api<{ commitments: string[] }>(`/c/${s.slug}/members`);
  const group = new Group(data.commitments.map(BigInt));
  const spki = await exportSpki((await generateSessionKey()).publicKey);
  const proof = await generateProof(me, group, joinMessage(spki), joinScope(s.slug));

  const other = await exportSpki((await generateSessionKey()).publicKey);
  t.add((await api(`/c/${s.slug}/join`, { proof, sessionKey: other })).code); // stolen proof, different key
  t.add((await api(`/c/${s.slug}/join`, { proof: { ...proof, nullifier: (BigInt(proof.nullifier) + 1n).toString() }, sessionKey: spki })).code);
  t.add((await api(`/c/${s.slug}/join`, { proof: { ...proof, scope: joinScope("ts_other").toString() }, sessionKey: spki })).code);

  // Outsiders build their own group and prove membership in it.
  const outsiders = Array.from({ length: 12 }, () => new Identity());
  const fakeGroup = new Group(outsiders.map((o) => o.commitment));
  for (const o of outsiders.slice(0, 3)) {
    const k = await exportSpki((await generateSessionKey()).publicKey);
    const p = await generateProof(o, fakeGroup, joinMessage(k), joinScope(s.slug));
    t.add((await api(`/c/${s.slug}/join`, { proof: p, sessionKey: k })).code);
  }

  t.print(`${TRIES + 11} sybil attempts`);
  const accepted = t.get("OK");
  console.log(accepted === 0 ? "\nall rejected ✓" : `\n${accepted} accepted ✗`);
  process.exit(accepted === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
