import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Hex } from "viem";

// Leaves use OpenZeppelin's StandardMerkleTree encoding, so proofs verify with
// Solidity's MerkleProof as well as in JS.

export type BatchLeaf = [seq: bigint, eventHash: Hex];

export function batchTree(events: { seq: number | bigint; eventHash: Hex }[]) {
  const leaves: BatchLeaf[] = events.map((e) => [BigInt(e.seq), e.eventHash]);
  return StandardMerkleTree.of(leaves, ["uint64", "bytes32"]);
}

export function batchRoot(events: { seq: number | bigint; eventHash: Hex }[]): Hex {
  if (events.length === 0) throw new Error("empty batch");
  return batchTree(events).root as Hex;
}

export function batchProof(events: { seq: number | bigint; eventHash: Hex }[], seq: number | bigint): Hex[] {
  const tree = batchTree(events);
  for (const [i, leaf] of tree.entries()) {
    if (leaf[0] === BigInt(seq)) return tree.getProof(i) as Hex[];
  }
  throw new Error(`seq ${seq} not in batch`);
}

export function verifyBatchProof(root: Hex, seq: number | bigint, eventHash: Hex, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(root, ["uint64", "bytes32"], [BigInt(seq), eventHash], proof);
}

export function codeTree(codeHashes: Hex[]) {
  return StandardMerkleTree.of(
    codeHashes.map((h) => [h]),
    ["bytes32"],
  );
}

export function codeRoot(codeHashes: Hex[]): Hex {
  if (codeHashes.length === 0) throw new Error("no codes");
  return codeTree(codeHashes).root as Hex;
}

export function verifyCodeProof(root: Hex, codeHash: Hex, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(root, ["bytes32"], [codeHash], proof);
}
