import PQueue from "p-queue";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { Env } from "./env";
import type { Logger } from "./logger";

export const hubAbi = parseAbi([
  "function createConversation(bytes32 configHash, uint8 gate, bytes32 codeRoot) returns (uint256)",
  "function addMember(uint256 id, uint256 commitment, uint256 gateNullifier, bytes32 proofHash)",
  "function anchor(uint256 id, bytes32 root, uint64 fromSeq, uint64 toSeq, bytes32 head)",
  "function close(uint256 id, bytes32 finalResultHash)",
  "function gateNullifierUsed(uint256 id, uint256 nullifier) view returns (bool)",
  "function conversations(uint256 id) view returns (uint256 groupId, bytes32 configHash, uint8 gate, bytes32 codeRoot, uint64 nextSeq, uint64 batches, bytes32 finalResultHash, bool closed, bool exists)",
  "event Created(uint256 indexed id, uint256 groupId, bytes32 configHash, uint8 gate, bytes32 codeRoot)",
  "event MemberAdded(uint256 indexed id, uint256 commitment, uint256 gateNullifier, bytes32 proofHash)",
  "event BatchAnchored(uint256 indexed id, uint64 batch, bytes32 root, uint64 fromSeq, uint64 toSeq, bytes32 head)",
  "event Closed(uint256 indexed id, bytes32 finalResultHash)",
]);

export const GATE_ENUM = { invite_code: 0, anon_aadhaar: 1 } as const;

export interface Relayer {
  enabled: boolean;
  address: Hex | null;
  hubAddress: Hex | null;
  chainId: number;
  pending(): number;
  createConversation(configHash: Hex, gate: 0 | 1, codeRoot: Hex): Promise<{ txHash: Hex; convId: string; groupId: string } | null>;
  addMember(convId: string, commitment: string, gateNullifier: string, proofHash: Hex): Promise<{ txHash: Hex; blockNumber: number } | null>;
  anchor(convId: string, root: Hex, fromSeq: number, toSeq: number, head: Hex): Promise<Hex | null>;
  // Chain view used to recover batches whose outcome was lost (crash between send and record).
  onchainNextSeq(convId: string): Promise<number | null>;
  findAnchorTx(convId: string, fromSeq: number): Promise<Hex | null>;
  close(convId: string, finalResultHash: Hex): Promise<Hex | null>;
  idle(): Promise<void>;
}

// Without RELAYER_PRIVATE_KEY and HUB_ADDRESS the server runs offchain: everything works
// except anchoring, and /api/meta says so. Useful for local dev and tests only.
export function createRelayer(env: Env, log: Logger): Relayer {
  const queue = new PQueue({ concurrency: 1 });
  const chain = env.CHAIN_ID === baseSepolia.id ? baseSepolia : defineChain({ ...baseSepolia, id: env.CHAIN_ID, name: "custom" });

  if (!env.RELAYER_PRIVATE_KEY || !env.HUB_ADDRESS) {
    log.warn("relayer disabled: RELAYER_PRIVATE_KEY or HUB_ADDRESS missing, running offchain");
    const off = async () => null;
    return {
      enabled: false,
      address: null,
      hubAddress: null,
      chainId: env.CHAIN_ID,
      pending: () => queue.size + queue.pending,
      createConversation: off,
      addMember: off,
      anchor: off,
      close: off,
      onchainNextSeq: off,
      findAnchorTx: off,
      idle: () => queue.onIdle(),
    };
  }

  const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
  const hub = env.HUB_ADDRESS as Hex;
  const publicClient = createPublicClient({ chain, transport: http(env.RPC_URL) });
  const wallet = createWalletClient({ account, chain, transport: http(env.RPC_URL) });

  async function send(fn: "createConversation" | "addMember" | "anchor" | "close", args: readonly unknown[]) {
    return queue.add(async () => {
      const hash = await wallet.writeContract({
        address: hub,
        abi: hubAbi,
        functionName: fn,
        args: args as never,
        account,
        chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${fn} reverted in ${hash}`);
      log.info({ fn, tx: hash, gas: receipt.gasUsed.toString() }, "relayed");
      return receipt;
    }) as Promise<Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>>;
  }

  return {
    enabled: true,
    address: account.address,
    hubAddress: hub,
    chainId: env.CHAIN_ID,
    pending: () => queue.size + queue.pending,
    async createConversation(configHash, gate, codeRoot) {
      const receipt = await send("createConversation", [configHash, gate, codeRoot]);
      const [created] = parseEventLogs({ abi: hubAbi, logs: receipt.logs, eventName: "Created" });
      if (!created) throw new Error("Created event missing");
      return { txHash: receipt.transactionHash, convId: created.args.id.toString(), groupId: created.args.groupId.toString() };
    },
    async addMember(convId, commitment, gateNullifier, proofHash) {
      const r = await send("addMember", [BigInt(convId), BigInt(commitment), BigInt(gateNullifier), proofHash]);
      return { txHash: r.transactionHash, blockNumber: Number(r.blockNumber) };
    },
    async anchor(convId, root, fromSeq, toSeq, head) {
      const r = await send("anchor", [BigInt(convId), root, BigInt(fromSeq), BigInt(toSeq), head]);
      return r.transactionHash;
    },
    async close(convId, finalResultHash) {
      const r = await send("close", [BigInt(convId), finalResultHash]);
      return r.transactionHash;
    },
    async onchainNextSeq(convId) {
      const c = await publicClient.readContract({ address: hub, abi: hubAbi, functionName: "conversations", args: [BigInt(convId)] });
      return Number(c[4]);
    },
    async findAnchorTx(convId, fromSeq) {
      try {
        const logs = await publicClient.getContractEvents({
          address: hub,
          abi: hubAbi,
          eventName: "BatchAnchored",
          args: { id: BigInt(convId) },
          fromBlock: "earliest",
        });
        return logs.find((l) => Number(l.args.fromSeq) === fromSeq)?.transactionHash ?? null;
      } catch {
        // some public RPCs cap log ranges; the verifier reads logs itself anyway
        return null;
      }
    },
    idle: () => queue.onIdle(),
  };
}
