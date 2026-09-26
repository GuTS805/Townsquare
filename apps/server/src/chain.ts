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
  addMember(convId: string, commitment: string, gateNullifier: string, proofHash: Hex): Promise<Hex | null>;
  anchor(convId: string, root: Hex, fromSeq: number, toSeq: number, head: Hex): Promise<Hex | null>;
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
      return r.transactionHash;
    },
    async anchor(convId, root, fromSeq, toSeq, head) {
      const r = await send("anchor", [BigInt(convId), root, BigInt(fromSeq), BigInt(toSeq), head]);
      return r.transactionHash;
    },
    async close(convId, finalResultHash) {
      const r = await send("close", [BigInt(convId), finalResultHash]);
      return r.transactionHash;
    },
    idle: () => queue.onIdle(),
  };
}
