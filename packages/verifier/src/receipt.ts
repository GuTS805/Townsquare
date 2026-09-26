import { batchProof, eventHash, verifyBatchProof, verifyReceipt, type Receipt } from "@townsquare/core";
import type { Bundle, ChainData } from "./types";

export interface ReceiptCheck {
  signed: boolean;
  inLog: boolean;
  anchored: { batch: number; txHash: string | null } | null;
  // A signed receipt for an event that is missing or changed is public proof of host misbehaviour.
  verdict: "included" | "pending" | "host-misbehaved" | "invalid-receipt";
  detail: string;
}

export async function checkReceipt(receipt: Receipt, b: Bundle, chain: ChainData | null): Promise<ReceiptCheck> {
  const signed = await verifyReceipt(b.meta.logPublicKey, receipt);
  if (!signed) {
    return { signed, inLog: false, anchored: null, verdict: "invalid-receipt", detail: "receipt is not signed by this server's log key" };
  }
  const ev = b.events[receipt.seq - 1];
  // recompute from content; the stored hash column alone proves nothing
  const inLog =
    !!ev &&
    eventHash({ v: ev.v, conv: ev.conv, seq: ev.seq, type: ev.type, body: ev.body, sig: ev.sig, t: ev.t }) === receipt.eventHash &&
    ev.chainHead === receipt.head;
  if (!inLog) {
    return { signed, inLog, anchored: null, verdict: "host-misbehaved", detail: `event #${receipt.seq} is missing or changed in the published log` };
  }

  const anchors = chain?.batches ?? b.batches.map((x) => ({ batch: x.batch_id, root: x.root, fromSeq: x.from_seq, toSeq: x.to_seq, txHash: x.tx_hash }));
  const a = anchors.find((x) => x.fromSeq <= receipt.seq && x.toSeq >= receipt.seq);
  if (!a) return { signed, inLog, anchored: null, verdict: "pending", detail: "in the log, not anchored yet" };

  const events = b.events.slice(a.fromSeq - 1, a.toSeq).map((e) => ({ seq: e.seq, eventHash: e.eventHash }));
  const proof = batchProof(events, receipt.seq);
  if (!verifyBatchProof(a.root, receipt.seq, receipt.eventHash, proof)) {
    return { signed, inLog, anchored: null, verdict: "host-misbehaved", detail: `batch ${a.batch} root does not include this event` };
  }
  return {
    signed,
    inLog,
    anchored: { batch: a.batch, txHash: a.txHash ?? null },
    verdict: "included",
    detail: `included in batch ${a.batch}${chain ? ", anchored onchain" : ""}`,
  };
}
