import { ZERO_HASH, batchRoot, eventHash, nextHead, type EventType } from "@townsquare/core";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { checkLog, inputsFromLog, type Bundle } from "../src";

const config = { v: 1, slug: "ts_demo", minMembers: 2, moderation: "pre", gate: { type: "invite_code", codeRoot: ZERO_HASH } };

function buildBundle(bodies: [EventType, unknown][], batchSizes: number[]): Bundle {
  let head: Hex = ZERO_HASH;
  const events = bodies.map(([type, body], i) => {
    const e = { v: 1 as const, conv: "ts_demo", seq: i + 1, type, body: structuredClone(body), sig: null, t: "2026-09-27T10:00:00.000Z" };
    const h = eventHash(e);
    head = nextHead(head, h);
    return { ...e, eventHash: h, chainHead: head };
  });
  let from = 1;
  const batches = batchSizes.map((n, i) => {
    const slice = events.slice(from - 1, from - 1 + n);
    const b = {
      batch_id: i + 1,
      from_seq: from,
      to_seq: from + n - 1,
      root: batchRoot(slice.map((e) => ({ seq: e.seq, eventHash: e.eventHash }))),
      head: slice[slice.length - 1]!.chainHead,
      tx_hash: null,
      status: "confirmed",
    };
    from += n;
    return b;
  });
  return {
    v: 1,
    meta: { chainId: 1, hubAddress: null, semaphoreAddress: "", onchain: false, logPublicKey: "" },
    conversation: {
      slug: "ts_demo",
      phase: "open",
      configHash: ZERO_HASH,
      minMembers: 2,
      gate: { type: "invite_code", codeRoot: ZERO_HASH },
      chain: null,
      finalResultHash: null,
    },
    gateRecords: [],
    members: [],
    events,
    batches,
    result: null,
  };
}

const vote = (pid: string, sid: number, value: number) => ["VOTE", { action: { pid, sid, value } }] as [EventType, unknown];

const log: [EventType, unknown][] = [
  ["PHASE", { phase: "draft", config }],
  ["STATEMENT", { sid: 1, text: "seed one is here", author: null }],
  ["STATEMENT", { sid: 2, text: "seed two is here", author: null }],
  vote("p1", 1, 1),
  vote("p2", 1, -1),
  ["STATEMENT", { sid: 3, text: "participant idea", author: "p1" }],
  vote("p1", 1, -1),
  ["MODERATE", { sid: 3, status: "approved", reasonCode: "ok" }],
  vote("p2", 3, 1),
];

describe("checkLog", () => {
  it("passes an honest log", async () => {
    const r = await checkLog(buildBundle(log, [4, 5]), null);
    expect(r.failures).toEqual([]);
    expect(r.status).toBe("warn"); // offchain
  });

  it("names the seq and batch of an edited event", async () => {
    const b = buildBundle(log, [4, 5]);
    (b.events[4]!.body as any).action.value = 1;
    const r = await checkLog(b, null);
    expect(r.status).toBe("fail");
    expect(r.failures).toContain("seq 5: event content does not match its hash");
  });

  it("catches a deleted event", async () => {
    const b = buildBundle(log, [4, 5]);
    b.events.splice(6, 1);
    const r = await checkLog(b, null);
    expect(r.failures.some((f) => f.includes("gap or reorder"))).toBe(true);
  });

  it("catches a rewritten event whose hashes were recomputed, via the anchored root", async () => {
    const honest = buildBundle(log, [4, 5]);
    const forged = buildBundle(log.map((e, i) => (i === 4 ? vote("p2", 1, 1) : e)), [4, 5]);
    forged.batches = honest.batches; // anchors are onchain and can't be changed
    const r = await checkLog(forged, null);
    expect(r.failures.join()).toMatch(/batch 2: root mismatch|batch 2: head mismatch/);
  });
});

describe("inputsFromLog", () => {
  it("keeps the latest vote per pid and statement and applies moderation", () => {
    const b = buildBundle(log, [9]);
    expect(inputsFromLog(b, 7)).toEqual({
      slug: "ts_demo",
      statementIds: [1, 2],
      votes: [
        { pid: "p2", sid: 1, value: -1 },
        { pid: "p1", sid: 1, value: -1 },
      ],
    });
    expect(inputsFromLog(b, 9).statementIds).toEqual([1, 2, 3]);
    expect(inputsFromLog(b, 9).votes).toContainEqual({ pid: "p2", sid: 3, value: 1 });
  });
});
