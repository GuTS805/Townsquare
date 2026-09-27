// Re-checks a conversation from the terminal with the same code as the Verify page.
// Chain data comes from --rpc, not from the Townsquare server.
//
//   pnpm --filter @townsquare/scripts verify -- --slug ts_xxxxxx [--api URL] [--rpc URL]
import { fetchChainData, verifyAll, type Bundle } from "@townsquare/verifier";
import type { Hex } from "viem";
import { arg, client, loadState } from "./lib";

const state = (() => {
  try {
    return loadState();
  } catch {
    return null;
  }
})();
const API = arg("api", state?.api ?? "http://localhost:4000");
const slug = arg("slug", state?.slug ?? "");
const RPCS: Record<number, string> = { 84532: "https://sepolia.base.org", 8453: "https://mainnet.base.org", 31337: "http://127.0.0.1:8545" };

async function main() {
  if (!slug) throw new Error("pass --slug");
  const r = await client(API)<Bundle>(`/c/${slug}/bundle`);
  if (!r.ok) throw new Error(`could not download bundle: ${r.code}`);
  const b = r.data;
  const rpc = arg("rpc", RPCS[b.meta.chainId] ?? "");
  const chain = b.meta.onchain && b.meta.hubAddress && b.conversation.chain && rpc ? await fetchChainData(rpc, b.meta.hubAddress as Hex, b.conversation.chain.convId, { createTx: b.conversation.chain.txHash }) : null;

  console.log(`${slug}: ${b.events.length} events, ${chain ? `${chain.batches.length} anchors read from ${rpc}` : "not anchored onchain"}\n`);
  const checks = await verifyAll(b, chain);
  for (const c of checks) {
    const mark = c.status === "fail" ? "✗" : c.status === "warn" ? "!" : "✓";
    console.log(`${mark} ${c.id} ${c.name.padEnd(14)} ${c.summary} (${c.ms} ms)`);
    for (const f of c.failures) console.log(`    ${f}`);
  }
  const failed = checks.some((c) => c.status === "fail");
  console.log(failed ? "\nsomething doesn't add up" : "\neverything checks out");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
