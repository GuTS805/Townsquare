import {
  TsError,
  codeGateSchema,
  createConversationSchema,
  moderateSchema,
  signedActionSchema,
} from "@townsquare/core";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Ctx } from "./context";
import { rateLimit } from "./ratelimit";
import { rejectionsFor } from "./rejections";
import { submitAction, moderate, nextStatement } from "./services/actions";
import { auditBundle, meta } from "./services/bundle";
import {
  createConversation,
  getConversation,
  openConversation,
  publicView,
  requireAdmin,
} from "./services/conversations";
import { passAadhaarGate, passCodeGate } from "./services/gate";
import { join, joinSchema } from "./services/join";
import { listCommitments } from "./services/members";
import { latestResult, whereAmI } from "./services/results";
import { sealConversation } from "./services/seal";
import { batchProof } from "@townsquare/core";
import type { Hex } from "viem";

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new TsError("BAD_REQUEST", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

const bearer = (req: Request) => req.header("authorization")?.replace(/^Bearer\s+/i, "");
const slugOf = (req: Request) => String(req.params.slug);

export function routes(ctx: Ctx): Router {
  const r = Router();

  r.get("/meta", (_req, res) => res.json(meta(ctx)));

  // ---- host ----
  r.post(
    "/conversations",
    rateLimit("create", 10),
    h(async (req, res) => {
      const input = parse(createConversationSchema, req.body);
      const created = await createConversation(ctx, input);
      res.status(201).json(created);
    }),
  );

  r.patch(
    "/conversations/:slug",
    h(async (req, res) => {
      const conv = await requireAdmin(ctx, slugOf(req), bearer(req));
      const { phase } = parse(z.object({ phase: z.enum(["open", "sealed"]) }), req.body);
      if (phase === "open") await openConversation(ctx, conv);
      else return res.json(await sealConversation(ctx, conv));
      res.json({ ok: true });
    }),
  );

  r.get(
    "/conversations/:slug/moderation",
    h(async (req, res) => {
      const conv = await requireAdmin(ctx, slugOf(req), bearer(req));
      const rows = await ctx.sql`
        select sid, text, status, reason_code from statements
        where conv_id = ${conv.id} order by (status = 'pending') desc, sid desc`;
      res.json(rows);
    }),
  );

  r.get(
    "/conversations/:slug/dashboard",
    h(async (req, res) => {
      const conv = await requireAdmin(ctx, slugOf(req), bearer(req));
      const [view, batches, recent] = await Promise.all([
        publicView(ctx, conv),
        ctx.sql`select batch_id, from_seq, to_seq, tx_hash, status, created_at from batches
                where conv_id = ${conv.id} order by batch_id desc limit 20`,
        ctx.sql<{ n: number }[]>`select count(*)::int as n from events
                where conv_id = ${conv.id} and type = 'VOTE' and t > now() - interval '5 minutes'`,
      ]);
      res.json({ ...view, batches, votesLast5Min: recent[0]?.n ?? 0, rejections: rejectionsFor(conv.slug) });
    }),
  );

  r.post(
    "/conversations/:slug/statements/:sid/moderate",
    h(async (req, res) => {
      const conv = await requireAdmin(ctx, slugOf(req), bearer(req));
      const body = parse(moderateSchema, req.body);
      await moderate(ctx, conv, Number(req.params.sid), body.status, body.reasonCode);
      res.json({ ok: true });
    }),
  );

  // ---- participant ----
  r.get(
    "/c/:slug",
    h(async (req, res) => res.json(await publicView(ctx, await getConversation(ctx, slugOf(req))))),
  );

  r.get(
    "/c/:slug/members",
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      res.json({ commitments: await listCommitments(ctx, conv.id) });
    }),
  );

  r.post(
    "/c/:slug/gate/code",
    rateLimit("gate", 300, 150),
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      const { code, commitment } = parse(codeGateSchema, req.body);
      res.status(201).json(await passCodeGate(ctx, conv, code, commitment));
    }),
  );

  r.post(
    "/c/:slug/gate/aadhaar",
    rateLimit("gate", 300, 150),
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      const { proof, commitment } = parse(z.object({ proof: z.unknown(), commitment: z.string().regex(/^\d+$/) }), req.body);
      res.status(201).json(await passAadhaarGate(ctx, conv, proof, commitment));
    }),
  );

  r.post(
    "/c/:slug/join",
    rateLimit("join", 300, 150),
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      res.json(await join(ctx, conv, parse(joinSchema, req.body)));
    }),
  );

  r.get(
    "/c/:slug/next",
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      const pid = parse(z.string().regex(/^\d+$/), req.query.pid);
      res.json(await nextStatement(ctx, conv, pid));
    }),
  );

  r.post(
    "/c/:slug/actions",
    rateLimit("actions-conn", 1200, 400),
    rateLimit("actions", 60, 30, (req) => (typeof req.body?.action?.pid === "string" ? `pid:${req.body.action.pid}` : undefined)),
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      const { action, sig } = parse(signedActionSchema, req.body);
      res.status(201).json(await submitAction(ctx, conv, action, sig));
    }),
  );

  r.get(
    "/c/:slug/receipts/:eventHash",
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      const eventHash = String(req.params.eventHash);
      const [ev] = await ctx.sql<{ seq: number }[]>`
        select seq from events where conv_id = ${conv.id} and event_hash = ${eventHash}`;
      if (!ev) throw new TsError("NOT_FOUND", "event not in log");
      const [batch] = await ctx.sql<{ batch_id: number; from_seq: number; to_seq: number; root: Hex; tx_hash: Hex | null; status: string }[]>`
        select batch_id, from_seq, to_seq, root, tx_hash, status from batches
        where conv_id = ${conv.id} and from_seq <= ${ev.seq} and to_seq >= ${ev.seq}`;
      if (!batch) return res.json({ seq: ev.seq, anchored: false });
      const events = await ctx.sql<{ seq: number; event_hash: Hex }[]>`
        select seq, event_hash from events
        where conv_id = ${conv.id} and seq between ${batch.from_seq} and ${batch.to_seq} order by seq`;
      res.json({
        seq: ev.seq,
        anchored: batch.status === "confirmed",
        batch: { id: batch.batch_id, fromSeq: batch.from_seq, toSeq: batch.to_seq, root: batch.root, txHash: batch.tx_hash },
        proof: batchProof(events.map((e) => ({ seq: e.seq, eventHash: e.event_hash })), ev.seq),
      });
    }),
  );

  r.get(
    "/c/:slug/me",
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      const pid = parse(z.string().regex(/^\d+$/), req.query.pid);
      res.json({ point: await whereAmI(ctx, conv.id, pid) });
    }),
  );

  // ---- public ----
  r.get(
    "/c/:slug/results",
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      const [result, lastBatch, statements] = await Promise.all([
        latestResult(ctx, conv.id),
        ctx.sql`select batch_id, to_seq, tx_hash, created_at from batches
                where conv_id = ${conv.id} and status = 'confirmed' order by batch_id desc limit 1`,
        ctx.sql`select sid, text, status, reason_code from statements where conv_id = ${conv.id} order by sid`,
      ]);
      res.json({
        result,
        statements,
        lastAnchor: lastBatch[0] ?? null,
        finalResultHash: conv.final_result_hash,
        phase: conv.phase,
        question: conv.question,
        title: conv.title,
      });
    }),
  );

  r.get(
    "/c/:slug/bundle",
    rateLimit("bundle", 60, 30),
    h(async (req, res) => {
      const conv = await getConversation(ctx, slugOf(req));
      res.json(await auditBundle(ctx, conv));
    }),
  );

  return r;
}
