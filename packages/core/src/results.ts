import type { Hex } from "viem";
import { hashJson } from "./hash";

// A result is bound to the log position it was computed at, so check E can
// recompute it from the anchored events and compare hashes.
export function resultHash(input: { conv: string; atSeq: number; head: Hex; math: unknown }): Hex {
  return hashJson({ v: 1, conv: input.conv, atSeq: input.atSeq, head: input.head, math: input.math });
}
