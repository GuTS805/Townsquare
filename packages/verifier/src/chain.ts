import { createPublicClient, http, parseAbi, type Hex, type PublicClient } from "viem";
import type { ChainData } from "./types";

const abi = parseAbi([
  "event Created(uint256 indexed id, uint256 groupId, bytes32 configHash, uint8 gate, bytes32 codeRoot)",
  "event MemberAdded(uint256 indexed id, uint256 commitment, uint256 gateNullifier, bytes32 proofHash)",
  "event BatchAnchored(uint256 indexed id, uint64 batch, bytes32 root, uint64 fromSeq, uint64 toSeq, bytes32 head)",
  "event Closed(uint256 indexed id, bytes32 finalResultHash)",
]);

// Public RPCs (sepolia.base.org among them) cap eth_getLogs at 1,000 blocks per call.
const PAGE = 1000n;
const PARALLEL = 4;

type HubLog = Awaited<ReturnType<typeof getHubLogs>>[number];

function getHubLogs(client: PublicClient, hub: Hex, fromBlock: bigint | "earliest", toBlock: bigint | "latest") {
  return client.getLogs({ address: hub, events: abi, fromBlock, toBlock });
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

async function pagedLogs(client: PublicClient, hub: Hex, from: bigint, to: bigint): Promise<HubLog[]> {
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += PAGE) ranges.push([s, s + PAGE - 1n < to ? s + PAGE - 1n : to]);
  const out: HubLog[][] = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const i = next++;
      const [s, e] = ranges[i]!;
      out[i] = await withRetry(() => getHubLogs(client, hub, s, e));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker));
  return out.flat();
}

// Reads every hub event for one conversation. `createTx` (from the bundle) lets the scan start
// at the creation block; a wrong one only makes the Created event go missing, so check A fails
// rather than passing.
export async function fetchChainData(
  rpcUrl: string,
  hub: Hex,
  convId: string,
  opts: { createTx?: Hex | null; fromBlock?: bigint } = {},
): Promise<ChainData> {
  const client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
  const id = BigInt(convId);

  let start = opts.fromBlock;
  if (start === undefined && opts.createTx) start = (await client.getTransactionReceipt({ hash: opts.createTx })).blockNumber;

  let logs: HubLog[];
  try {
    logs = await getHubLogs(client, hub, start ?? "earliest", "latest");
  } catch (e) {
    if (start === undefined) throw e;
    logs = await pagedLogs(client, hub, start, await client.getBlockNumber());
  }

  const mine = logs
    .filter((l) => l.args.id === id)
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex! - b.logIndex! : a.blockNumber! < b.blockNumber! ? -1 : 1));
  const created = mine.find((l) => l.eventName === "Created");
  const closed = mine.find((l) => l.eventName === "Closed");

  return {
    created:
      created?.eventName === "Created"
        ? { groupId: created.args.groupId!.toString(), configHash: created.args.configHash!, gate: Number(created.args.gate), codeRoot: created.args.codeRoot! }
        : null,
    members: mine.flatMap((l) =>
      l.eventName === "MemberAdded"
        ? [{ commitment: l.args.commitment!.toString(), gateNullifier: l.args.gateNullifier!.toString(), proofHash: l.args.proofHash!, txHash: l.transactionHash! }]
        : [],
    ),
    batches: mine.flatMap((l) =>
      l.eventName === "BatchAnchored"
        ? [
            {
              batch: Number(l.args.batch),
              root: l.args.root!,
              fromSeq: Number(l.args.fromSeq),
              toSeq: Number(l.args.toSeq),
              head: l.args.head!,
              txHash: l.transactionHash!,
            },
          ]
        : [],
    ),
    closed: closed?.eventName === "Closed" ? { finalResultHash: closed.args.finalResultHash! } : null,
  };
}
