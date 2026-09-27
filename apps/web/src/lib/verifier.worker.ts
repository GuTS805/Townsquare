/// <reference lib="webworker" />
import {
  checkActions,
  checkClaims,
  checkLog,
  checkMembership,
  checkPseudonyms,
  checkResults,
  fetchChainData,
  type Bundle,
  type ChainData,
} from "@townsquare/verifier";
import type { Hex } from "viem";

// Runs checks A–E. Chain data comes from a public RPC, never from the Townsquare API.
self.onmessage = async (ev: MessageEvent<{ bundle: Bundle; rpcUrl: string }>) => {
  const { bundle, rpcUrl } = ev.data;
  let chain: ChainData | null = null;
  try {
    if (bundle.meta.onchain && bundle.meta.hubAddress && bundle.conversation.chain) {
      self.postMessage({ type: "status", text: "Reading anchors from Base…" });
      chain = await fetchChainData(rpcUrl, bundle.meta.hubAddress as Hex, bundle.conversation.chain.convId, { createTx: bundle.conversation.chain.txHash });
    }
    self.postMessage({ type: "chain", chain });
    for (const run of [
      () => checkMembership(bundle, chain),
      () => checkPseudonyms(bundle),
      () => checkActions(bundle),
      () => checkLog(bundle, chain),
      () => checkResults(bundle, chain),
      () => checkClaims(bundle),
    ]) {
      self.postMessage({ type: "check", check: await run() });
    }
    self.postMessage({ type: "done" });
  } catch (e) {
    self.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
