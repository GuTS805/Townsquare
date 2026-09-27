// Seeds a demo conversation through the public API, exactly as real participants would:
// invite codes → Semaphore identities → anonymous join proofs → signed votes.
//
//   pnpm --filter @townsquare/scripts seed -- --people 30 --api http://localhost:4000
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";
import { bytesToBase64, exportSpki, generateSessionKey, joinMessage, joinScope, signPayload } from "@townsquare/core";
import { arg, client, rng, saveState, tally } from "./lib";

const API = arg("api", "http://localhost:4000");
const WEB = arg("web", "http://localhost:3000");
const PEOPLE = Number(arg("people", "30"));
const api = client(API);
const random = rng(Number(arg("seed", "7")));

const SEEDS = [
  "The library should stay open till 10 pm during exams.",
  "We need more charging points in the reading hall.",
  "Weekend hours matter more than weekday evenings.",
  "Group study rooms should be bookable online.",
  "Food should be allowed in the ground-floor reading area.",
  "Silent zones should be strictly enforced after 8 pm.",
  "Seats left with only a bag should be freed after 30 minutes.",
  "The library should stay open 24 hours in the last exam week.",
  "More printed copies of core textbooks are needed.",
  "Fans and lights on the top floor need fixing before exams.",
];

// Chance of "agree" per statement for three rough camps; everyone likes #2 and #10.
const CAMPS = [
  [0.95, 0.9, 0.3, 0.8, 0.8, 0.2, 0.3, 0.9, 0.6, 0.9],
  [0.3, 0.9, 0.9, 0.4, 0.2, 0.9, 0.9, 0.2, 0.7, 0.85],
  [0.7, 0.85, 0.6, 0.9, 0.3, 0.8, 0.5, 0.6, 0.9, 0.95],
];

function must<T>(r: { ok: boolean; code: string; data: T }, what: string): T {
  if (!r.ok) throw new Error(`${what} failed: ${r.code} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function main() {
  const t0 = Date.now();
  const created = must(
    await api<{ slug: string; adminToken: string; inviteCodes: string[]; chain: { txHash: string } | null }>("/conversations", {
      title: "Library hours during exams",
      question: "How should the library work during exam weeks?",
      context: "Demo conversation seeded with simulated participants.",
      seedStatements: SEEDS,
      gate: { type: "invite_code", codeCount: PEOPLE + 10 },
      minMembers: Math.min(10, PEOPLE),
    }),
    "create",
  );
  const { slug, adminToken, inviteCodes } = created;
  console.log(`created ${slug}${created.chain ? ` (tx ${created.chain.txHash})` : " (offchain)"}`);
  must(await api(`/conversations/${slug}`, { phase: "open" }, { method: "PATCH", token: adminToken }), "open");

  const people = Array.from({ length: PEOPLE }, (_, i) => ({ identity: new Identity(), camp: i % CAMPS.length }));
  // everyone registers at once, like a room scanning the code together
  const tReg = Date.now();
  const regs = await Promise.all(
    people.map(async (p, i) =>
      must(
        await api<{ txHash: string | null }>(`/c/${slug}/gate/code`, { code: inviteCodes[i], commitment: p.identity.commitment.toString() }),
        `register #${i + 1}`,
      ),
    ),
  );
  const txs = new Set(regs.map((r) => r.txHash)).size;
  console.log(`registered ${PEOPLE} members in ${((Date.now() - tReg) / 1000).toFixed(1)}s (${txs} transaction${txs === 1 ? "" : "s"})`);

  const { commitments } = must(await api<{ commitments: string[] }>(`/c/${slug}/members`), "members");
  const group = new Group(commitments.map(BigInt));
  const joined: { pid: string; key: CryptoKeyPair; spki: string; camp: number; identity: Identity; nonce: number }[] = [];
  for (const p of people) {
    const key = await generateSessionKey(true);
    const spki = await exportSpki(key.publicKey);
    const proof = await generateProof(p.identity, group, joinMessage(spki), joinScope(slug));
    const { pid } = must(await api<{ pid: string }>(`/c/${slug}/join`, { proof, sessionKey: spki }), "join");
    joined.push({ pid, key, spki, camp: p.camp, identity: p.identity, nonce: 0 });
  }
  console.log(`joined ${joined.length} pseudonyms`);

  const counts = tally();
  const act = async (who: (typeof joined)[number], body: Record<string, unknown>) => {
    who.nonce++;
    const action = { v: 1, conv: slug, pid: who.pid, keyVersion: 1, nonce: who.nonce, ...body };
    const r = await api(`/c/${slug}/actions`, { action, sig: await signPayload(who.key.privateKey, action) });
    counts.add(r.code);
    return r;
  };

  for (const who of joined) {
    for (let sid = 1; sid <= SEEDS.length; sid++) {
      if (random() < 0.1) continue; // not everyone sees everything
      const pAgree = CAMPS[who.camp]![sid - 1]!;
      const x = random();
      await act(who, { kind: "vote", sid, value: x < pAgree * 0.9 ? 1 : x < 0.93 ? -1 : 0 });
    }
  }
  const extra = [
    "Library staff should announce closing time 15 minutes early.",
    "Water coolers on every floor would help during long sessions.",
  ];
  for (const [i, text] of extra.entries()) await act(joined[i]!, { kind: "statement", text });
  counts.print("actions");

  const member = joined[0]!;
  saveState({
    api: API,
    web: WEB,
    slug,
    adminToken,
    usedCode: inviteCodes[0]!,
    unusedCodes: inviteCodes.slice(PEOPLE),
    member: {
      identity: member.identity.export(),
      pid: member.pid,
      keyVersion: 1,
      pkcs8: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", member.key.privateKey))),
      spki: member.spki,
      nonce: member.nonce,
    },
  });

  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  participate  ${WEB}/c/${slug}`);
  console.log(`  report       ${WEB}/r/${slug}`);
  console.log(`  verify       ${WEB}/verify/${slug}`);
  console.log(`  host         ${WEB}/host/${slug}#${adminToken}`);
  console.log(`  state saved to scripts/.demo-state.json (used by attack and tamper scripts)`);
  // snarkjs keeps worker threads alive
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
