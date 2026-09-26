import { z } from "zod";

export const STATEMENT_MIN = 10;
export const STATEMENT_MAX = 140;

export function normalizeStatement(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

const statementText = z
  .string()
  .transform(normalizeStatement)
  .pipe(z.string().min(STATEMENT_MIN).max(STATEMENT_MAX));

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const decimal = z.string().regex(/^\d+$/);

export const gateTypeSchema = z.enum(["invite_code", "anon_aadhaar"]);
export type GateType = z.infer<typeof gateTypeSchema>;

export const createConversationSchema = z.object({
  title: z.string().trim().min(3).max(120),
  question: z.string().trim().min(5).max(280),
  context: z.string().trim().max(2000).default(""),
  seedStatements: z.array(statementText).min(1).max(30),
  gate: z.discriminatedUnion("type", [
    z.object({ type: z.literal("invite_code"), codeCount: z.number().int().min(1).max(2000) }),
    z.object({
      type: z.literal("anon_aadhaar"),
      freshnessDays: z.number().int().min(1).max(365).default(30),
      reveal: z.array(z.enum(["state", "ageAbove18"])).default([]),
    }),
  ]),
  minMembers: z.number().int().min(2).max(1000).default(10),
  moderation: z.enum(["pre", "post"]).default("post"),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

// What gets committed onchain as configHash. Only public, fixed rules go in here.
export function publicConfig(slug: string, input: CreateConversationInput, codeRoot: string | null, nullifierSeed: string | null = null) {
  return {
    v: 1,
    slug,
    title: input.title,
    question: input.question,
    context: input.context,
    gate: input.gate.type === "invite_code" ? { type: "invite_code", codeRoot } : { ...input.gate, nullifierSeed },
    minMembers: input.minMembers,
    moderation: input.moderation,
  };
}

const actionBase = {
  v: z.literal(1),
  conv: z.string(),
  pid: decimal,
  keyVersion: z.number().int().min(1),
  nonce: z.number().int().min(1),
};

export const voteActionSchema = z.object({
  ...actionBase,
  kind: z.literal("vote"),
  sid: z.number().int().min(1),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export const statementActionSchema = z.object({
  ...actionBase,
  kind: z.literal("statement"),
  text: z.string().min(1).max(STATEMENT_MAX * 2),
});

export const actionSchema = z.discriminatedUnion("kind", [voteActionSchema, statementActionSchema]);
export type Action = z.infer<typeof actionSchema>;
export type VoteAction = z.infer<typeof voteActionSchema>;
export type StatementAction = z.infer<typeof statementActionSchema>;

export const signedActionSchema = z.object({ action: actionSchema, sig: z.string().min(1) });

export const codeGateSchema = z.object({ code: z.string().trim().min(4).max(64), commitment: decimal });

export const moderateSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reasonCode: z.enum(["ok", "off_topic", "duplicate", "abusive", "personal_info", "spam"]).default("ok"),
});

export { hex as hexSchema, decimal as decimalSchema, statementText as statementTextSchema };
