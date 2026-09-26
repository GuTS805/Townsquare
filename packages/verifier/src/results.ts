import { resultHash } from "@townsquare/core";
import { computeMath, privacySafeMathResult, type VoteRow } from "@townsquare/math";
import type { Hex } from "viem";

export interface MathInputs {
  slug: string;
  atSeq: number;
  head: Hex;
  votes: VoteRow[];
  statementIds: number[];
}

// The one definition of "the result". The server publishes it, check E re-runs it.
// computedAt is the log position and previousK is unused, so only the log matters.
export function computeResult(input: MathInputs) {
  const { publicResult, pidPoints } = computeMath({
    conversationId: input.slug,
    votes: input.votes,
    statementIds: input.statementIds,
    computedAt: input.atSeq,
    previousK: null,
  });
  const math = privacySafeMathResult(publicResult);
  const hash = resultHash({ conv: input.slug, atSeq: input.atSeq, head: input.head, math });
  return { math, hash, pidPoints };
}
