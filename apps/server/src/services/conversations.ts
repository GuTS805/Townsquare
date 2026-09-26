import {
  TsError,
  aadhaarNullifierSeed,
  codeRoot as computeCodeRoot,
  hashJson,
  inviteCodeHash,
  publicConfig,
  type CreateConversationInput,
} from "@townsquare/core";
import { zeroHash, type Hex } from "viem";
import { GATE_ENUM } from "../chain";
import type { Ctx } from "../context";
import type { ConversationRow } from "../db";
import { appendEvent } from "../eventlog";
import { newInviteCode, newSlug, randomToken, safeEqualHex, sha256Hex } from "../util";

export interface Created {
  slug: string;
  adminToken: string;
  inviteCodes: string[];
  configHash: Hex;
  chain: { convId: string; groupId: string; txHash: Hex } | null;
}

export async function createConversation(ctx: Ctx, input: CreateConversationInput): Promise<Created> {
  const slug = newSlug();
  const adminToken = randomToken(32);

  const inviteCodes = input.gate.type === "invite_code" ? Array.from({ length: input.gate.codeCount }, newInviteCode) : [];
  const codeHashes = inviteCodes.map((c) => inviteCodeHash(slug, c));
  const root = codeHashes.length > 0 ? computeCodeRoot(codeHashes) : null;

  const seed = input.gate.type === "anon_aadhaar" ? aadhaarNullifierSeed(ctx.env.APP_NULLIFIER_SEED, slug).toString() : null;
  const config = publicConfig(slug, input, root, seed);
  const configHash = hashJson(config);

  // Onchain first: if the chain rejects it, nothing is written locally.
  const chain = await ctx.relayer.createConversation(configHash, GATE_ENUM[input.gate.type], root ?? zeroHash);

  await ctx.sql.begin(async (tx) => {
    const [conv] = await tx<{ id: string }[]>`
      insert into conversations (
        slug, title, question, context, gate_type, nullifier_seed, code_root, freshness_days, reveal,
        min_members, moderation, phase, chain_conv_id, group_id, create_tx, config_hash, admin_token_hash
      ) values (
        ${slug}, ${input.title}, ${input.question}, ${input.context}, ${input.gate.type}, ${seed}, ${root},
        ${input.gate.type === "anon_aadhaar" ? input.gate.freshnessDays : 30},
        ${input.gate.type === "anon_aadhaar" ? input.gate.reveal : []},
        ${input.minMembers}, ${input.moderation}, 'draft',
        ${chain?.convId ?? null}, ${chain?.groupId ?? null}, ${chain?.txHash ?? null},
        ${configHash}, ${sha256Hex(adminToken)}
      ) returning id`;
    const convId = conv!.id;

    if (codeHashes.length > 0) {
      await tx`insert into invite_codes ${tx(codeHashes.map((h) => ({ conv_id: convId, code_hash: h })))}`;
    }

    await appendEvent(tx, convId, "PHASE", { phase: "draft", config, configHash });

    let sid = 1;
    for (const text of dedupe(input.seedStatements)) {
      const ev = await appendEvent(tx, convId, "STATEMENT", { sid, text, author: null });
      await tx`
        insert into statements (conv_id, sid, text, author_pid, status, seq)
        values (${convId}, ${sid}, ${text}, null, 'approved', ${ev.seq})`;
      sid++;
    }
    await tx`update conversations set next_sid = ${sid} where id = ${convId}`;
  });

  ctx.log.info({ slug, gate: input.gate.type, codes: inviteCodes.length, onchain: !!chain }, "conversation created");
  return { slug, adminToken, inviteCodes, configHash, chain };
}

function dedupe(texts: string[]): string[] {
  return [...new Set(texts)];
}

export async function getConversation(ctx: Ctx, slug: string): Promise<ConversationRow> {
  const [conv] = await ctx.sql<ConversationRow[]>`select * from conversations where slug = ${slug}`;
  if (!conv) throw new TsError("NOT_FOUND", "conversation not found");
  return conv;
}

export async function requireAdmin(ctx: Ctx, slug: string, token: string | undefined): Promise<ConversationRow> {
  const conv = await getConversation(ctx, slug);
  if (!token || !safeEqualHex(sha256Hex(token), conv.admin_token_hash)) {
    throw new TsError("UNAUTHORIZED", "admin token required");
  }
  return conv;
}

const NEXT_PHASE: Record<ConversationRow["phase"], ConversationRow["phase"] | null> = {
  draft: "open",
  open: "closed",
  closed: null,
  sealed: null,
};

export async function openConversation(ctx: Ctx, conv: ConversationRow) {
  if (conv.phase !== "draft") throw new TsError("WRONG_PHASE", `cannot open from ${conv.phase}`);
  await ctx.sql.begin(async (tx) => {
    await tx`update conversations set phase = 'open' where id = ${conv.id}`;
    await appendEvent(tx, conv.id, "PHASE", { phase: "open" });
  });
}

export async function stopVoting(ctx: Ctx, conv: ConversationRow) {
  if (NEXT_PHASE[conv.phase] !== "closed") throw new TsError("WRONG_PHASE", `cannot close from ${conv.phase}`);
  await ctx.sql.begin(async (tx) => {
    await tx`update conversations set phase = 'closed' where id = ${conv.id}`;
    await appendEvent(tx, conv.id, "PHASE", { phase: "closed" });
  });
}

export async function publicView(ctx: Ctx, conv: ConversationRow) {
  const [counts] = await ctx.sql<{ members: number; participants: number; statements: number; votes: number }[]>`
    select
      (select count(*)::int from members where conv_id = ${conv.id}) as members,
      (select count(*)::int from participants where conv_id = ${conv.id}) as participants,
      (select count(*)::int from statements where conv_id = ${conv.id} and status = 'approved') as statements,
      (select count(*)::int from votes where conv_id = ${conv.id}) as votes`;
  return {
    slug: conv.slug,
    title: conv.title,
    question: conv.question,
    context: conv.context,
    phase: conv.phase,
    gate: {
      type: conv.gate_type,
      codeRoot: conv.code_root,
      nullifierSeed: conv.nullifier_seed,
      freshnessDays: conv.freshness_days,
      reveal: conv.reveal,
    },
    minMembers: conv.min_members,
    moderation: conv.moderation,
    configHash: conv.config_hash,
    chain: conv.chain_conv_id
      ? { convId: conv.chain_conv_id, groupId: conv.group_id, txHash: conv.create_tx }
      : null,
    finalResultHash: conv.final_result_hash,
    counts: counts!,
    anonymityReady: counts!.members >= conv.min_members,
  };
}
