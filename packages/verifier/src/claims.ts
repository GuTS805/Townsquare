import type { MathResult, StatementStat } from "@townsquare/math";
import { z } from "zod";

// Every AI claim must cite statements whose numbers back it up. These rules are the
// thresholds Pocket Polis uses; the server drops failing claims before publishing, and
// check F re-runs the same rules on whatever was published.

export const COMMON_GROUND_MIN = 0.6;
export const TENSION_MIN_GAP = 0.35;
export const REPORTABLE_GROUP_SIZE = 3;

const sids = z.array(z.number().int().min(1)).min(1).max(12);

export const synthesisSchema = z.object({
  overview: z.string().max(1500),
  themes: z.array(z.object({ title: z.string().min(1).max(140), sids })).max(8),
  commonGround: z.array(z.object({ claim: z.string().min(1).max(400), sids })).max(8),
  tensions: z.array(z.object({ groupA: z.string().min(1).max(4), groupB: z.string().min(1).max(4), claim: z.string().min(1).max(400), sids })).max(8),
});

export type Synthesis = z.infer<typeof synthesisSchema>;

export interface Dropped {
  kind: "theme" | "commonGround" | "tension";
  text: string;
  reason: string;
}

const agreeProb = (s: StatementStat) => (s.agrees + 1) / (s.seen + 2);
const agreeRate = (s: StatementStat) => (s.seen > 0 ? s.agrees / s.seen : 0);

function reportableGroups(math: MathResult) {
  return math.groups.filter((g) => g.size >= REPORTABLE_GROUP_SIZE && !g.statsRedacted && g.statementStats);
}

function unknownSid(list: number[], approved: Set<number>) {
  return list.find((sid) => !approved.has(sid));
}

export function commonGroundFailure(sidList: number[], math: MathResult, approved: Set<number>): string | null {
  const bad = unknownSid(sidList, approved);
  if (bad !== undefined) return `#${bad} is not an approved statement`;
  const groups = reportableGroups(math);
  for (const sid of sidList) {
    if (groups.length === 0) {
      // too few people for group statistics: fall back to everyone
      const s = math.statementStats.find((x) => x.sid === sid);
      if (!s || s.seen < REPORTABLE_GROUP_SIZE || agreeProb(s) < COMMON_GROUND_MIN) return `#${sid} lacks broad agreement`;
      continue;
    }
    for (const g of groups) {
      const s = g.statementStats!.find((x) => x.sid === sid);
      if (!s || agreeProb(s) < COMMON_GROUND_MIN) return `#${sid}: group ${g.label} agree probability below ${COMMON_GROUND_MIN}`;
    }
  }
  return null;
}

export function tensionFailure(t: { groupA: string; groupB: string; sids: number[] }, math: MathResult, approved: Set<number>): string | null {
  const bad = unknownSid(t.sids, approved);
  if (bad !== undefined) return `#${bad} is not an approved statement`;
  const groups = reportableGroups(math);
  const a = groups.find((g) => g.label === t.groupA);
  const b = groups.find((g) => g.label === t.groupB);
  if (!a || !b || a === b) return `groups ${t.groupA}/${t.groupB} are not two reportable groups`;
  for (const sid of t.sids) {
    const sa = a.statementStats!.find((x) => x.sid === sid);
    const sb = b.statementStats!.find((x) => x.sid === sid);
    if (!sa || !sb || sa.seen === 0 || sb.seen === 0) return `#${sid} was not seen by both groups`;
    if (Math.abs(agreeRate(sa) - agreeRate(sb)) < TENSION_MIN_GAP) return `#${sid}: groups differ by less than ${TENSION_MIN_GAP * 100} points`;
  }
  return null;
}

export function validateSynthesis(raw: Synthesis, math: MathResult, approvedSids: number[]) {
  const approved = new Set(approvedSids);
  const dropped: Dropped[] = [];

  const themes = raw.themes.filter((t) => {
    const bad = unknownSid(t.sids, approved);
    if (bad !== undefined) dropped.push({ kind: "theme", text: t.title, reason: `#${bad} is not an approved statement` });
    return bad === undefined;
  });
  const commonGround = raw.commonGround.filter((c) => {
    const why = commonGroundFailure(c.sids, math, approved);
    if (why) dropped.push({ kind: "commonGround", text: c.claim, reason: why });
    return !why;
  });
  const tensions = raw.tensions.filter((t) => {
    const why = tensionFailure(t, math, approved);
    if (why) dropped.push({ kind: "tension", text: t.claim, reason: why });
    return !why;
  });

  return { synthesis: { overview: raw.overview, themes, commonGround, tensions } satisfies Synthesis, dropped };
}
