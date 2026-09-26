import { createPublicClient, http, parseAbi, type Hex } from "viem";
import type { ChainData } from "./types";

const abi = parseAbi([
  "event Created(uint256 indexed id, uint256 groupId, bytes32 configHash, uint8 gate, bytes32 codeRoot)",
  "event MemberAdded(uint256 indexed id, uint256 commitment, uint256 gateNullifier, bytes32 proofHash)",
  "event BatchAnchored(uint256 indexed id, uint64 batch, bytes32 root, uint64 fromSeq, uint64 toSeq, bytes32 head)",
  "event Closed(uint256 indexed id, bytes32 finalResultHash)",
]);

export async function fetchChainData(rpcUrl: string, hub: Hex, convId: string, fromBlock: bigint | "earliest" = "earliest"): Promise<ChainData> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const id = BigInt(convId);
  const base = { address: hub, abi, args: { id }, fromBlock } as const;
  const [created, members, batches, closed] = await Promise.all([
    client.getContractEvents({ ...base, eventName: "Created" }),
    client.getContractEvents({ ...base, eventName: "MemberAdded" }),
    client.getContractEvents({ ...base, eventName: "BatchAnchored" }),
    client.getContractEvents({ ...base, eventName: "Closed" }),
  ]);

  const c = created[0]?.args;
  return {
    created: c ? { groupId: c.groupId!.toString(), configHash: c.configHash!, gate: Number(c.gate), codeRoot: c.codeRoot! } : null,
    members: members.map((l) => ({
      commitment: l.args.commitment!.toString(),
      gateNullifier: l.args.gateNullifier!.toString(),
      proofHash: l.args.proofHash!,
      txHash: l.transactionHash,
    })),
    batches: batches.map((l) => ({
      batch: Number(l.args.batch),
      root: l.args.root!,
      fromSeq: Number(l.args.fromSeq),
      toSeq: Number(l.args.toSeq),
      head: l.args.head!,
      txHash: l.transactionHash,
    })),
    closed: closed[0] ? { finalResultHash: closed[0].args.finalResultHash! } : null,
  };
}
