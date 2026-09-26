import type { MathResult } from "@townsquare/math";
import { describe, expect, it } from "vitest";
import { validateSynthesis } from "../src";

const stat = (sid: number, agrees: number, disagrees: number, passes = 0) => ({ sid, agrees, disagrees, passes, seen: agrees + disagrees + passes });

// Two groups of 5: they agree on #1, split on #2, #3 is barely seen.
const math = {
  statementStats: [stat(1, 9, 1), stat(2, 5, 5), stat(3, 1, 0)],
  groups: [
    { id: 0, label: "A", size: 5, center: [0, 0], representative: [], statementStats: [stat(1, 5, 0), stat(2, 5, 0), stat(3, 1, 0)] },
    { id: 1, label: "B", size: 5, center: [1, 1], representative: [], statementStats: [stat(1, 4, 1), stat(2, 0, 5)] },
    { id: 2, label: "C", size: 2, center: [2, 2], representative: [], statsRedacted: true },
  ],
} as unknown as MathResult;

const base = { overview: "x", themes: [], commonGround: [], tensions: [] };

describe("validateSynthesis", () => {
  it("keeps common ground only where every reportable group agrees", () => {
    const { synthesis, dropped } = validateSynthesis(
      { ...base, commonGround: [{ claim: "all agree", sids: [1] }, { claim: "split", sids: [2] }, { claim: "unseen", sids: [3] }] },
      math,
      [1, 2, 3],
    );
    expect(synthesis.commonGround.map((c) => c.claim)).toEqual(["all agree"]);
    expect(dropped.map((d) => d.reason)).toEqual([
      "#2: group B agree probability below 0.6",
      "#3: group B agree probability below 0.6",
    ]);
  });

  it("keeps tensions only between two reportable groups that really differ", () => {
    const { synthesis, dropped } = validateSynthesis(
      {
        ...base,
        tensions: [
          { groupA: "A", groupB: "B", claim: "split on #2", sids: [2] },
          { groupA: "A", groupB: "B", claim: "not split on #1", sids: [1] },
          { groupA: "A", groupB: "C", claim: "C is too small", sids: [2] },
        ],
      },
      math,
      [1, 2, 3],
    );
    expect(synthesis.tensions.map((t) => t.claim)).toEqual(["split on #2"]);
    expect(dropped).toHaveLength(2);
  });

  it("drops anything citing a statement that isn't approved", () => {
    const { synthesis } = validateSynthesis({ ...base, themes: [{ title: "ok", sids: [1] }, { title: "ghost", sids: [7] }] }, math, [1, 2, 3]);
    expect(synthesis.themes.map((t) => t.title)).toEqual(["ok"]);
  });
});
