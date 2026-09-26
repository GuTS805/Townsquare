import { TsError } from "@townsquare/core";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Ctx } from "./context";
import { routes } from "./routes";

export function createApp(ctx: Ctx) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(helmet());
  app.use(cors({ origin: ctx.env.WEB_ORIGIN.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "256kb" }));

  // Uptime pinger target; cheap and does not touch the database.
  app.get("/healthz", (_req, res) => res.json({ ok: true, pending: ctx.relayer.pending() }));

  app.use("/api", routes(ctx));

  app.use((_req, _res, next) => next(new TsError("NOT_FOUND", "no such route")));
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof TsError) {
      if (err.status >= 500) ctx.log.error({ err, path: req.path }, err.message);
      return res.status(err.status).json({ code: err.code, message: err.message });
    }
    if (err instanceof SyntaxError) return res.status(400).json({ code: "BAD_REQUEST", message: "invalid JSON" });
    ctx.log.error({ err, path: req.path }, "unhandled error");
    res.status(500).json({ code: "INTERNAL", message: "internal error" });
  });

  return app;
}
