import { describe, expect, it } from "vitest";
import {
  ZERO_HASH,
  aadhaarNullifierSeed,
  batchProof,
  batchRoot,
  canonicalize,
  chainHeads,
  codeRoot,
  codeTree,
  eventHash,
  exportSpki,
  generateSessionKey,
  inviteCodeHash,
  nextHead,
  normalizeStatement,
  signPayload,
  signReceipt,
  verifyBatchProof,
  verifyCodeProof,
  verifyPayload,
  verifyReceipt,
  createConversationSchema,
  actionSchema,
  type LogEvent,
} from "../src";

describe("jcs", () => {
  it("sorts keys and is stable regardless of insertion order", () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }));
  });

  it("formats numbers per RFC 8785", () => {
    expect(canonicalize({ n: 1.0, m: 1e21, k: -0 })).toBe('{"k":0,"m":1e+21,"n":1}');
  });
});

describe("hash chain", () => {
  const ev = (seq: number, body: unknown): LogEvent => ({
    v: 1,
    conv: "ts_demo",
    seq,
    type: "VOTE",
    body,
    sig: null,
    t: "2026-09-27T10:00:00.000Z",
  });

  it("changes the head when any earlier event changes", () => {
    const hashes = [ev(1, { a: 1 }), ev(2, { a: 2 }), ev(3, { a: 3 })].map(eventHash);
    const tampered = [ev(1, { a: 1 }), ev(2, { a: 99 }), ev(3, { a: 3 })].map(eventHash);
    const h = chainHeads(hashes);
    const t = chainHeads(tampered);
    expect(h[0]).toBe(t[0]);
    expect(h[1]).not.toBe(t[1]);
    expect(h[2]).not.toBe(t[2]);
  });

  it("chains from the zero hash", () => {
    const e = eventHash(ev(1, {}));
    expect(chainHeads([e])[0]).toBe(nextHead(ZERO_HASH, e));
  });

  it("covers the signature in the event hash", () => {
    expect(eventHash({ ...ev(1, {}), sig: "a" })).not.toBe(eventHash({ ...ev(1, {}), sig: "b" }));
  });
});

describe("merkle", () => {
  const events = [1, 2, 3, 4, 5].map((seq) => ({
    seq,
    eventHash: eventHash({ v: 1, conv: "c", seq, type: "VOTE", body: { seq }, sig: null, t: "x" }),
  }));

  it("proves inclusion of each event in its batch", () => {
    const root = batchRoot(events);
    for (const e of events) {
      expect(verifyBatchProof(root, e.seq, e.eventHash, batchProof(events, e.seq))).toBe(true);
    }
  });

  it("rejects a proof for a changed event", () => {
    const root = batchRoot(events);
    const proof = batchProof(events, 3);
    expect(verifyBatchProof(root, 3, events[0]!.eventHash, proof)).toBe(false);
  });

  it("verifies invite code membership", () => {
    const hashes = ["AAAA1111", "BBBB2222", "CCCC3333"].map((c) => inviteCodeHash("ts_demo", c));
    const tree = codeTree(hashes);
    const root = codeRoot(hashes);
    expect(verifyCodeProof(root, hashes[1]!, tree.getProof(1) as `0x${string}`[])).toBe(true);
    expect(inviteCodeHash("ts_demo", "bbbb-2222")).toBe(hashes[1]);
    expect(inviteCodeHash("ts_other", "BBBB2222")).not.toBe(hashes[1]);
  });
});

describe("signatures", () => {
  it("signs and verifies canonical payloads with P-256", async () => {
    const kp = await generateSessionKey();
    const spki = await exportSpki(kp.publicKey);
    const payload = { v: 1, kind: "vote", sid: 17, value: 1, nonce: 38 };
    const sig = await signPayload(kp.privateKey, payload);
    expect(await verifyPayload(spki, { nonce: 38, value: 1, sid: 17, kind: "vote", v: 1 }, sig)).toBe(true);
    expect(await verifyPayload(spki, { ...payload, value: -1 }, sig)).toBe(false);
    expect(await verifyPayload(spki, payload, "not-a-sig")).toBe(false);
  });

  it("signs receipts with the log key", async () => {
    const kp = await generateSessionKey();
    const r = await signReceipt(kp.privateKey, { v: 1, conv: "c", seq: 4, eventHash: ZERO_HASH, head: ZERO_HASH });
    expect(await verifyReceipt(kp.publicKey, r)).toBe(true);
    expect(await verifyReceipt(kp.publicKey, { ...r, seq: 5 })).toBe(false);
  });
});

describe("schemas", () => {
  it("normalizes statements and enforces length", () => {
    expect(normalizeStatement("  Library  should\nstay open ")).toBe("Library should stay open");
    const base = { title: "Library", question: "Library hours?", gate: { type: "invite_code", codeCount: 5 } };
    expect(createConversationSchema.safeParse({ ...base, seedStatements: ["too short"] }).success).toBe(false);
    expect(createConversationSchema.safeParse({ ...base, seedStatements: ["The library should stay open till 10 pm"] }).success).toBe(true);
  });

  it("only accepts -1, 0 and 1 as vote values", () => {
    const vote = { v: 1, conv: "c", pid: "123", keyVersion: 1, nonce: 1, kind: "vote", sid: 1 };
    expect(actionSchema.safeParse({ ...vote, value: 1 }).success).toBe(true);
    expect(actionSchema.safeParse({ ...vote, value: 2 }).success).toBe(false);
  });
});

describe("aadhaar seed", () => {
  it("is 10 bytes and differs per conversation", () => {
    const a = aadhaarNullifierSeed("app", "ts_a");
    expect(a < 2n ** 80n).toBe(true);
    expect(a).not.toBe(aadhaarNullifierSeed("app", "ts_b"));
  });
});
