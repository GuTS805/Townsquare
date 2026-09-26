import { Group } from "@semaphore-protocol/group";
import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import {
  ZERO_HASH,
  batchRoot,
  eventHash,
  hashJson,
  joinMessage,
  joinScope,
  nextHead,
  normalizeStatement,
  resultHash,
  verifyCodeProof,
  verifyPayload,
} from "@townsquare/core";
import type { MathResult, VoteRow } from "@townsquare/math";
import { aadhaarPolicyFailure, aadhaarProofSchema, verifyAadhaarSnark } from "./aadhaar";
import { synthesisSchema, validateSynthesis } from "./claims";
import { numberToHex, type Hex } from "viem";
import { computeResult } from "./results";
import type { Bundle, ChainData, CheckId, CheckResult } from "./types";

const MAX_LISTED = 20;

class Report {
  failures: string[] = [];
  warnings: string[] = [];
  fail(msg: string) {
    this.failures.push(msg);
  }
  warn(msg: string) {
    this.warnings.push(msg);
  }
}

async function timed(id: CheckId, name: string, fn: (r: Report) => Promise<string>): Promise<CheckResult> {
  const r = new Report();
  const start = performance.now();
  let summary: string;
  try {
    summary = await fn(r);
  } catch (e) {
    r.fail(`check crashed: ${e instanceof Error ? e.message : String(e)}`);
    summary = "could not complete";
  }
  const failures = [...r.failures.slice(0, MAX_LISTED)];
  if (r.failures.length > MAX_LISTED) failures.push(`…and ${r.failures.length - MAX_LISTED} more`);
  return {
    id,
    name,
    status: r.failures.length > 0 ? "fail" : r.warnings.length > 0 ? "warn" : "pass",
    summary: r.warnings.length > 0 && r.failures.length === 0 ? `${summary} (${r.warnings.join("; ")})` : summary,
    failures,
    ms: Math.round(performance.now() - start),
  };
}

// The PHASE event at seq 1 carries the full public config; its hash is what went onchain.
function configOf(b: Bundle) {
  const first = b.events[0];
  if (!first || first.type !== "PHASE" || !first.body?.config) return null;
  return first.body.config as {
    slug: string;
    minMembers: number;
    moderation: "pre" | "post";
    gate: { type: string; codeRoot?: Hex; nullifierSeed?: string; freshnessDays?: number; reveal?: string[] };
  };
}

// A: every member onchain came through the gate exactly once, with public evidence.
export function checkMembership(b: Bundle, chain: ChainData | null) {
  return timed("A", "Membership", async (r) => {
    const config = configOf(b);
    if (!config) r.fail("first event is not the PHASE event with the config");
    const configHash = config ? hashJson(config) : null;
    if (configHash !== b.conversation.configHash) r.fail("config in the log does not match the published configHash");
    if (chain) {
      if (!chain.created) r.fail("conversation not found onchain");
      else if (chain.created.configHash !== configHash) r.fail("onchain configHash differs from the logged config");
    }

    const codeRoot = (chain?.created?.codeRoot ?? config?.gate.codeRoot ?? null) as Hex | null;
    const byNullifier = new Map(b.gateRecords.map((g) => [g.nullifier, g]));
    if (byNullifier.size !== b.gateRecords.length) r.fail("duplicate gate nullifiers in gate records");

    const memberList = chain ? chain.members : b.members.map((m) => ({ commitment: m.commitment, gateNullifier: null, proofHash: null }));
    if (!chain) r.warn("not anchored onchain, checked against the API's member list");

    const seenNullifiers = new Set<string>();
    for (const [i, m] of memberList.entries()) {
      const rec = m.gateNullifier ? byNullifier.get(m.gateNullifier) : b.gateRecords.find((g) => g.commitment === m.commitment);
      if (!rec) {
        r.fail(`member #${i + 1} has no gate record`);
        continue;
      }
      if (rec.commitment !== m.commitment) r.fail(`member #${i + 1}: commitment differs from its gate record`);
      if (seenNullifiers.has(rec.nullifier)) r.fail(`member #${i + 1}: gate nullifier reused`);
      seenNullifiers.add(rec.nullifier);
      if (hashJson(rec.proof) !== rec.proof_hash) r.fail(`member #${i + 1}: gate proof does not match its hash`);
      if (m.proofHash && m.proofHash !== rec.proof_hash) r.fail(`member #${i + 1}: onchain proof hash differs`);

      if (rec.gate_type === "invite_code") {
        const p = rec.proof as { codeHash: Hex; merkleProof: Hex[] };
        if (numberToHex(BigInt(rec.nullifier), { size: 32 }) !== p.codeHash) r.fail(`member #${i + 1}: nullifier is not the code hash`);
        if (!codeRoot || !verifyCodeProof(codeRoot, p.codeHash, p.merkleProof)) {
          r.fail(`member #${i + 1}: invite code is not in the committed code set`);
        }
      } else {
        const parsed = aadhaarProofSchema.safeParse(rec.proof);
        if (!parsed.success) {
          r.fail(`member #${i + 1}: malformed Anon Aadhaar proof`);
          continue;
        }
        const p = parsed.data;
        if (p.nullifier !== rec.nullifier) r.fail(`member #${i + 1}: gate nullifier is not the proof's nullifier`);
        const why = aadhaarPolicyFailure(p, {
          mode: b.meta.aadhaarMode ?? "test",
          nullifierSeed: config?.gate.nullifierSeed ?? "",
          commitment: rec.commitment,
          freshnessDays: config?.gate.freshnessDays ?? 30,
          reveal: config?.gate.reveal ?? [],
          at: rec.t ? Math.floor(new Date(rec.t).getTime() / 1000) + 60 : Math.floor(Date.now() / 1000),
        });
        if (why) r.fail(`member #${i + 1}: ${why}`);
        if (!(await verifyAadhaarSnark(p))) r.fail(`member #${i + 1}: Anon Aadhaar proof does not verify`);
      }
    }

    // The API's member list must be exactly the onchain order, with correct roots.
    const group = new Group();
    b.members.forEach((m, i) => {
      group.addMember(BigInt(m.commitment));
      if (chain && chain.members[i]?.commitment !== m.commitment) r.fail(`member list differs from chain at leaf ${i}`);
      if (group.root.toString() !== m.root_after || group.size !== m.size_after) r.fail(`wrong group root after leaf ${i}`);
    });
    if (chain && chain.members.length !== b.members.length) r.fail(`API lists ${b.members.length} members, chain has ${chain.members.length}`);

    return `${memberList.length} members, all with a valid gate record`;
  });
}

// B: every pseudonym comes from a valid Semaphore proof against a real, large-enough group root.
export function checkPseudonyms(b: Bundle) {
  return timed("B", "Pseudonyms", async (r) => {
    const config = configOf(b);
    const minMembers = config?.minMembers ?? b.conversation.minMembers;
    const slug = config?.slug ?? b.conversation.slug;
    const roots = new Map(b.members.map((m) => [m.root_after, m.size_after]));
    const versions = new Map<string, number>();
    let joins = 0;

    for (const e of b.events) {
      if (e.type !== "JOIN" && e.type !== "KEY_ROTATE") continue;
      joins++;
      const { pid, keyVersion, sessionKey, proof } = e.body as { pid: string; keyVersion: number; sessionKey: string; proof: SemaphoreProof };
      const at = `seq ${e.seq}`;
      if (proof.nullifier !== pid) r.fail(`${at}: pid is not the proof's nullifier`);
      if (proof.scope !== joinScope(slug).toString()) r.fail(`${at}: proof scope is for another conversation`);
      if (proof.message !== joinMessage(sessionKey).toString()) r.fail(`${at}: session key not bound to proof`);
      const size = roots.get(proof.merkleTreeRoot);
      if (size === undefined) r.fail(`${at}: proof uses a group root that never existed`);
      else if (size < minMembers) r.fail(`${at}: anonymity set ${size} below minimum ${minMembers}`);

      const prev = versions.get(pid);
      if (e.type === "JOIN" && prev !== undefined) r.fail(`${at}: pid joined twice`);
      if (e.type === "KEY_ROTATE" && prev === undefined) r.fail(`${at}: key rotation for unknown pid`);
      if (keyVersion !== (prev ?? 0) + 1) r.fail(`${at}: key version should be ${(prev ?? 0) + 1}`);
      versions.set(pid, keyVersion);

      let ok = false;
      try {
        ok = await verifyProof(proof);
      } catch {
        ok = false;
      }
      if (!ok) r.fail(`${at}: Semaphore proof does not verify`);
    }
    return `${versions.size} pseudonyms from ${joins} join proofs`;
  });
}

// C: every vote and statement is signed by its pid's current session key, nonces strictly increase.
export function checkActions(b: Bundle) {
  return timed("C", "Actions", async (r) => {
    const config = configOf(b);
    const slug = config?.slug ?? b.conversation.slug;
    const keys = new Map<string, { key: string; version: number; nonce: number }>();
    let n = 0;

    for (const e of b.events) {
      const at = `seq ${e.seq}`;
      if (e.type === "JOIN" || e.type === "KEY_ROTATE") {
        const { pid, keyVersion, sessionKey } = e.body;
        keys.set(pid, { key: sessionKey, version: keyVersion, nonce: keys.get(pid)?.nonce ?? 0 });
        continue;
      }
      const action = e.type === "VOTE" ? e.body?.action : e.type === "STATEMENT" && e.body?.author ? e.body.action : null;
      if (!action) continue;
      n++;
      const k = keys.get(action.pid);
      if (!k) {
        r.fail(`${at}: action by a pid that never joined`);
        continue;
      }
      if (action.conv !== slug) r.fail(`${at}: action signed for another conversation`);
      if (action.keyVersion !== k.version) r.fail(`${at}: signed with an old key version`);
      if (!e.sig || !(await verifyPayload(k.key, action, e.sig))) r.fail(`${at}: signature does not verify`);
      if (action.nonce <= k.nonce) r.fail(`${at}: nonce ${action.nonce} not above ${k.nonce}`);
      k.nonce = Math.max(k.nonce, action.nonce);
      if (e.type === "STATEMENT") {
        if (e.body.author !== action.pid) r.fail(`${at}: statement author differs from signer`);
        if (e.body.text !== normalizeStatement(action.text)) r.fail(`${at}: statement text differs from what was signed`);
      }
    }
    return `${n} signed actions`;
  });
}

// D: the log is gap-free, every hash recomputes, and every batch matches its onchain anchor.
export function checkLog(b: Bundle, chain: ChainData | null) {
  return timed("D", "Log integrity", async (r) => {
    let head: Hex = ZERO_HASH;
    const heads = new Map<number, Hex>();
    const hashes = new Map<number, Hex>();
    b.events.forEach((e, i) => {
      if (e.seq !== i + 1) r.fail(`gap or reorder: expected seq ${i + 1}, found ${e.seq}`);
      const h = eventHash({ v: e.v, conv: e.conv, seq: e.seq, type: e.type, body: e.body, sig: e.sig, t: e.t });
      if (h !== e.eventHash) r.fail(`seq ${e.seq}: event content does not match its hash`);
      head = nextHead(head, h);
      if (head !== e.chainHead) r.fail(`seq ${e.seq}: chain head mismatch`);
      heads.set(e.seq, head);
      hashes.set(e.seq, h);
    });

    const anchors = chain ? chain.batches : b.batches.map((x) => ({ batch: x.batch_id, root: x.root, fromSeq: x.from_seq, toSeq: x.to_seq, head: x.head }));
    if (!chain) r.warn("not anchored onchain, batches checked against the API only");

    let expectFrom = 1;
    for (const a of anchors) {
      const at = `batch ${a.batch}`;
      if (a.fromSeq !== expectFrom) r.fail(`${at}: starts at ${a.fromSeq}, expected ${expectFrom}`);
      expectFrom = a.toSeq + 1;
      const leaves: { seq: number; eventHash: Hex }[] = [];
      for (let s = a.fromSeq; s <= a.toSeq; s++) {
        const h = hashes.get(s);
        if (!h) {
          r.fail(`${at}: anchored seq ${s} is missing from the log`);
          continue;
        }
        leaves.push({ seq: s, eventHash: h });
      }
      if (leaves.length > 0 && batchRoot(leaves) !== a.root) {
        const bad = leaves.find((l) => b.events[l.seq - 1]?.eventHash !== l.eventHash) ?? leaves[0]!;
        r.fail(`${at}: root mismatch at seq ${bad.seq}`);
      }
      if (heads.get(a.toSeq) && heads.get(a.toSeq) !== a.head) r.fail(`${at}: head mismatch at seq ${a.toSeq}`);
    }

    const anchoredTo = expectFrom - 1;
    const unanchored = b.events.length - anchoredTo;
    if (unanchored > 0) r.warn(`${unanchored} newest events not anchored yet`);
    return `${b.events.length} events, ${anchors.length} batches anchored`;
  });
}

// Rebuild the math inputs from the log alone, exactly as the server's tables would hold them at atSeq.
export function inputsFromLog(b: Bundle, atSeq: number) {
  const config = configOf(b);
  const moderation = config?.moderation ?? "post";
  const status = new Map<number, string>();
  const votes = new Map<string, { pid: string; sid: number; value: -1 | 0 | 1; seq: number }>();

  for (const e of b.events) {
    if (e.seq > atSeq) break;
    if (e.type === "STATEMENT") status.set(e.body.sid, e.body.author ? (moderation === "pre" ? "pending" : "approved") : "approved");
    else if (e.type === "MODERATE") status.set(e.body.sid, e.body.status);
    else if (e.type === "VOTE") {
      const a = e.body.action;
      votes.set(`${a.pid}:${a.sid}`, { pid: a.pid, sid: a.sid, value: a.value, seq: e.seq });
    }
  }
  const approved = [...status].filter(([, s]) => s === "approved").map(([sid]) => sid).sort((x, y) => x - y);
  const ok = new Set(approved);
  const rows: VoteRow[] = [...votes.values()]
    .filter((v) => ok.has(v.sid))
    .sort((x, y) => x.seq - y.seq)
    .map(({ pid, sid, value }) => ({ pid, sid, value }));
  return { slug: config?.slug ?? b.conversation.slug, statementIds: approved, votes: rows };
}

// E: re-run the math on the log and compare with the published (and sealed) result hash.
export function checkResults(b: Bundle, chain: ChainData | null) {
  return timed("E", "Results", async (r) => {
    if (!b.result) {
      r.warn("no result published yet");
      return "nothing to check";
    }
    const { at_seq: atSeq, result_hash: published } = b.result;
    const head = b.events[atSeq - 1]?.chainHead;
    if (!head) {
      r.fail(`result claims seq ${atSeq}, which is not in the log`);
      return "result refers to missing events";
    }
    const inputs = inputsFromLog(b, atSeq);
    const { hash } = computeResult({ ...inputs, atSeq, head });
    if (hash !== published) r.fail(`result hash differs: recomputed ${hash.slice(0, 10)}…, published ${published.slice(0, 10)}…`);

    const stored = resultHash({ conv: inputs.slug, atSeq, head, math: b.result.math });
    if (stored !== published) r.fail("published numbers do not match the published result hash");

    const sealed = chain?.closed?.finalResultHash ?? null;
    if (sealed && sealed !== published) r.fail("sealed onchain result differs from the published result");
    if (b.conversation.finalResultHash && b.conversation.finalResultHash !== published) r.fail("sealed result differs from the published result");

    return `recomputed at seq ${atSeq} from ${inputs.votes.length} votes on ${inputs.statementIds.length} statements${sealed ? ", matches the onchain seal" : ""}`;
  });
}

// F: every published AI claim cites approved statements whose numbers meet the claim's rule.
export function checkClaims(b: Bundle) {
  return timed("F", "AI claims", async (r) => {
    const raw = b.result?.synthesis;
    if (!b.result || !raw) {
      r.warn("no AI summary published");
      return "nothing to check";
    }
    const parsed = synthesisSchema.safeParse(raw);
    if (!parsed.success) {
      r.fail("published summary does not match the summary schema");
      return "malformed summary";
    }
    const { statementIds } = inputsFromLog(b, b.result.at_seq);
    const { dropped } = validateSynthesis(parsed.data, b.result.math as MathResult, statementIds);
    for (const d of dropped) r.fail(`${d.kind} "${d.text.slice(0, 60)}": ${d.reason}`);
    const s = parsed.data;
    const n = s.themes.length + s.commonGround.length + s.tensions.length;
    return `${n} cited claims${b.result.model ? ` from ${b.result.model}` : ""}, each backed by its statements`;
  });
}

export async function verifyAll(b: Bundle, chain: ChainData | null): Promise<CheckResult[]> {
  return [
    await checkMembership(b, chain),
    await checkPseudonyms(b),
    await checkActions(b),
    await checkLog(b, chain),
    await checkResults(b, chain),
    await checkClaims(b),
  ];
}
