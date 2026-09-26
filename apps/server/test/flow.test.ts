import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";
import {
  ZERO_HASH,
  chainHeads,
  eventHash,
  exportSpki,
  generateSessionKey,
  joinMessage,
  joinScope,
  signPayload,
  verifyBatchProof,
  verifyReceipt,
  batchRoot,
  type LogEvent,
} from "@townsquare/core";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createRelayer } from "../src/chain";
import type { Ctx } from "../src/context";
import { connect } from "../src/db";
import { loadEnv } from "../src/env";
import { createJobs } from "../src/jobs";
import { createLogger } from "../src/logger";
import { loadLogKey } from "../src/logkey";
import { anchorAll } from "../src/services/anchor";
import { recomputeResults } from "../src/services/results";
import { checkReceipt, fetchChainData, verifyAll, type Bundle } from "@townsquare/verifier";

const DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)(`server flow (${process.env.TEST_HUB_ADDRESS ? "onchain" : "offchain"})`, () => {
  let ctx: Ctx;
  let server: Server;
  let base: string;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    // With TEST_RPC_URL/TEST_HUB_ADDRESS/TEST_RELAYER_KEY (e.g. Anvil) the relayer path runs too.
    const env = loadEnv({
      DATABASE_URL: DB,
      NODE_ENV: "test",
      ANCHOR_INTERVAL_MS: "600000",
      RPC_URL: process.env.TEST_RPC_URL,
      CHAIN_ID: process.env.TEST_CHAIN_ID,
      HUB_ADDRESS: process.env.TEST_HUB_ADDRESS,
      RELAYER_PRIVATE_KEY: process.env.TEST_RELAYER_KEY,
    } as NodeJS.ProcessEnv);
    const log = createLogger("silent");
    let c!: Ctx;
    c = { sql: connect(env.DATABASE_URL), env, log, relayer: createRelayer(env, log), logKey: await loadLogKey(undefined), jobs: createJobs(() => c) };
    ctx = c;
    server = createApp(ctx).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await ctx?.sql.end();
  });

  it("runs host → gate → join → vote → results → anchor, and rejects attacks", async () => {
    // host creates a conversation with 4 invite codes and a minimum anonymity set of 3
    const created = await call("POST", "/conversations", {
      title: "Library hours",
      question: "Should the library stay open later during exams?",
      seedStatements: [
        "The library should stay open till 10 pm during exams.",
        "We need more charging points in the reading hall.",
        "Weekend hours matter more than weekday evenings.",
      ],
      gate: { type: "invite_code", codeCount: 4 },
      minMembers: 3,
    });
    expect(created.status).toBe(201);
    const { slug, adminToken, inviteCodes } = created.body as { slug: string; adminToken: string; inviteCodes: string[] };
    expect(inviteCodes).toHaveLength(4);
    if (ctx.relayer.enabled) expect(created.body.chain.txHash).toMatch(/^0x/);

    expect((await call("PATCH", `/conversations/${slug}`, { phase: "open" }, "wrong")).body.code).toBe("UNAUTHORIZED");
    expect((await call("PATCH", `/conversations/${slug}`, { phase: "open" }, adminToken)).status).toBe(200);

    // three people register with codes
    const ids = [new Identity(), new Identity(), new Identity()];
    for (let i = 0; i < 3; i++) {
      const r = await call("POST", `/c/${slug}/gate/code`, { code: inviteCodes[i], commitment: ids[i]!.commitment.toString() });
      expect(r.status).toBe(201);
      expect(r.body.memberIndex).toBe(i + 1);
    }

    // attack: reuse a code, and use a code that was never issued
    const reused = await call("POST", `/c/${slug}/gate/code`, { code: inviteCodes[0], commitment: new Identity().commitment.toString() });
    expect(reused.body.code).toBe("CODE_USED");
    const fake = await call("POST", `/c/${slug}/gate/code`, { code: "AAAAA-BBBBB", commitment: new Identity().commitment.toString() });
    expect(fake.body.code).toBe("BAD_CODE");

    // anonymous join
    const members = (await call("GET", `/c/${slug}/members`)).body.commitments as string[];
    const group = new Group(members.map(BigInt));
    const joined: { pid: string; key: CryptoKeyPair; nonce: number }[] = [];
    for (const id of ids) {
      const key = await generateSessionKey(false);
      const spki = await exportSpki(key.publicKey);
      const proof = await generateProof(id, group, joinMessage(spki), joinScope(slug));
      const r = await call("POST", `/c/${slug}/join`, { proof, sessionKey: spki });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      joined.push({ pid: r.body.pid, key, nonce: 0 });
    }
    expect(new Set(joined.map((j) => j.pid)).size).toBe(3);

    // attack: a proof whose message was tampered to bind a different key
    {
      const key = await generateSessionKey(false);
      const spki = await exportSpki(key.publicKey);
      const proof = await generateProof(ids[0]!, group, joinMessage(spki), joinScope(slug));
      const other = await exportSpki((await generateSessionKey(false)).publicKey);
      expect((await call("POST", `/c/${slug}/join`, { proof, sessionKey: other })).body.code).toBe("KEY_NOT_BOUND");
      const forged = { ...proof, message: joinMessage(other).toString() };
      expect((await call("POST", `/c/${slug}/join`, { proof: forged, sessionKey: other })).body.code).toBe("BAD_PROOF");
    }

    // rejoining with the same identity gives the same pid (key rotation)
    {
      const key = await generateSessionKey(false);
      const spki = await exportSpki(key.publicKey);
      const proof = await generateProof(ids[2]!, group, joinMessage(spki), joinScope(slug));
      const r = await call("POST", `/c/${slug}/join`, { proof, sessionKey: spki });
      expect(r.body).toMatchObject({ pid: joined[2]!.pid, keyVersion: 2, rotated: true });
      joined[2] = { pid: r.body.pid, key, nonce: 0 };
    }

    // votes: two agree on everything, one disagrees on everything
    const vote = async (who: (typeof joined)[number], sid: number, value: -1 | 0 | 1, keyVersion = 1) => {
      who.nonce++;
      const action = { v: 1, conv: slug, pid: who.pid, keyVersion, kind: "vote", sid, value, nonce: who.nonce } as const;
      return call("POST", `/c/${slug}/actions`, { action, sig: await signPayload(who.key.privateKey, action) });
    };
    const receipts = [];
    for (const sid of [1, 2, 3]) {
      receipts.push((await vote(joined[0]!, sid, 1)).body);
      receipts.push((await vote(joined[1]!, sid, 1)).body);
      receipts.push((await vote(joined[2]!, sid, -1, 2)).body);
    }
    expect(receipts.every((r) => typeof r.logSig === "string")).toBe(true);

    // attack: replayed nonce, forged signature, old key version
    {
      const who = joined[0]!;
      const action = { v: 1, conv: slug, pid: who.pid, keyVersion: 1, kind: "vote", sid: 1, value: -1, nonce: who.nonce } as const;
      const sig = await signPayload(who.key.privateKey, action);
      expect((await call("POST", `/c/${slug}/actions`, { action, sig })).body.code).toBe("NONCE_REPLAY");
      const next = { ...action, nonce: who.nonce + 1 };
      expect((await call("POST", `/c/${slug}/actions`, { action: next, sig })).body.code).toBe("BAD_SIGNATURE");
      expect((await vote(joined[2]!, 1, 1, 1)).body.code).toBe("STALE_KEY");
    }

    // participant adds a statement
    const st = await (async () => {
      const who = joined[1]!;
      who.nonce++;
      const action = { v: 1, conv: slug, pid: who.pid, keyVersion: 1, kind: "statement", text: "  Open the terrace for group study.  ", nonce: who.nonce } as const;
      return call("POST", `/c/${slug}/actions`, { action, sig: await signPayload(who.key.privateKey, action) });
    })();
    expect(st.status).toBe(201);
    expect(st.body.sid).toBe(4);

    // receipts verify with the published log key
    const meta = (await call("GET", "/meta")).body;
    expect(await verifyReceipt(meta.logPublicKey, receipts[0])).toBe(true);

    // results
    const conv = (await ctx.sql`select id from conversations where slug = ${slug}`)[0]!;
    await recomputeResults(ctx, conv.id);
    const results = (await call("GET", `/c/${slug}/results`)).body;
    expect(results.result.math.nParticipantsTotal).toBe(3);
    expect(results.result.result_hash).toMatch(/^0x[0-9a-f]{64}$/);

    // anchoring (offchain mode confirms locally) and receipt inclusion
    await anchorAll(ctx, true);
    const inc = (await call("GET", `/c/${slug}/receipts/${receipts[4].eventHash}`)).body;
    expect(inc.anchored).toBe(true);
    expect(verifyBatchProof(inc.batch.root, receipts[4].seq, receipts[4].eventHash, inc.proof)).toBe(true);

    // audit bundle: recompute every event hash, the chain head and each batch root
    const bundle = (await call("GET", `/c/${slug}/bundle`)).body;
    const events = bundle.events as (LogEvent & { eventHash: string; chainHead: string })[];
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const recomputed = events.map((e) => eventHash({ v: e.v, conv: e.conv, seq: e.seq, type: e.type, body: e.body, sig: e.sig, t: e.t }));
    expect(recomputed).toEqual(events.map((e) => e.eventHash));
    expect(chainHeads(recomputed as `0x${string}`[], ZERO_HASH)).toEqual(events.map((e) => e.chainHead));
    for (const b of bundle.batches) {
      const inBatch = events.filter((e) => e.seq >= b.from_seq && e.seq <= b.to_seq);
      expect(batchRoot(inBatch.map((e) => ({ seq: e.seq, eventHash: e.eventHash as `0x${string}` })))).toBe(b.root);
    }

    // crash between sending an anchor tx and recording it: the batch is found onchain, not resent
    if (ctx.relayer.enabled) {
      const [last] = await ctx.sql<{ batch_id: number; tx_hash: string }[]>`
        select batch_id, tx_hash from batches where conv_id = ${conv.id} order by batch_id desc limit 1`;
      await ctx.sql`update batches set status = 'sent', tx_hash = null where conv_id = ${conv.id} and batch_id = ${last!.batch_id}`;
      await anchorAll(ctx, true);
      const [after] = await ctx.sql<{ status: string; tx_hash: string }[]>`
        select status, tx_hash from batches where conv_id = ${conv.id} and batch_id = ${last!.batch_id}`;
      expect(after).toEqual({ status: "confirmed", tx_hash: last!.tx_hash });
    }

    // the events table rejects edits
    await expect(ctx.sql`update events set body = '{}' where conv_id = ${conv.id} and seq = 1`).rejects.toThrow(/append-only/);

    // seal
    const sealed = await call("PATCH", `/conversations/${slug}`, { phase: "sealed" }, adminToken);
    expect(sealed.status, JSON.stringify(sealed.body)).toBe(200);
    if (ctx.relayer.enabled) {
      expect(sealed.body.txHash).toMatch(/^0x/);
      const confirmed = (await call("GET", `/c/${slug}/bundle`)).body.batches;
      expect(confirmed.every((b: { status: string; tx_hash: string }) => b.status === "confirmed" && b.tx_hash)).toBe(true);
    }
    expect((await vote(joined[0]!, 2, -1)).body.code).toBe("WRONG_PHASE");

    // ---- verify it yourself ----
    const fetchBundle = async () => (await call("GET", `/c/${slug}/bundle`)).body as Bundle;
    const chainData = ctx.relayer.enabled
      ? await fetchChainData(ctx.env.RPC_URL, ctx.relayer.hubAddress!, (await fetchBundle()).conversation.chain!.convId)
      : null;
    const statuses = (checks: Awaited<ReturnType<typeof verifyAll>>) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

    const honest = await verifyAll(await fetchBundle(), chainData);
    for (const c of honest) expect(c.status, `${c.id}: ${c.failures.join("; ")}`).not.toBe("fail");
    if (chainData) expect(statuses(honest)).toEqual({ A: "pass", B: "pass", C: "pass", D: "pass", E: "pass" });

    const rc = await checkReceipt(receipts[4], await fetchBundle(), chainData);
    expect(rc.verdict).toBe("included");

    // tamper demo: an admin bypasses the trigger and flips one vote in the log
    const target = receipts[4].seq as number;
    const [orig] = await ctx.sql<{ body: any }[]>`select body from events where conv_id = ${conv.id} and seq = ${target}`;
    const flipped = { ...orig!.body, action: { ...orig!.body.action, value: -orig!.body.action.value } };
    await ctx.sql`alter table events disable trigger events_no_update`;
    await ctx.sql`update events set body = ${ctx.sql.json(flipped)} where conv_id = ${conv.id} and seq = ${target}`;

    const tampered = await verifyAll(await fetchBundle(), chainData);
    expect(statuses(tampered)).toMatchObject({ D: "fail", E: "fail" });
    expect(tampered.find((c) => c.id === "D")!.failures.join()).toContain(`seq ${target}`);
    expect((await checkReceipt(receipts[4], await fetchBundle(), chainData)).verdict).toBe("host-misbehaved");

    await ctx.sql`update events set body = ${ctx.sql.json(orig!.body)} where conv_id = ${conv.id} and seq = ${target}`;
    await ctx.sql`alter table events enable trigger events_no_update`;
    expect(statuses(await verifyAll(await fetchBundle(), chainData))).toEqual(statuses(honest));
  }, 120_000);
});
