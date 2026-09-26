import { createApp } from "./app";
import { createRelayer } from "./chain";
import type { Ctx } from "./context";
import { connect } from "./db";
import { loadEnv } from "./env";
import { createJobs } from "./jobs";
import { createLogger } from "./logger";
import { loadLogKey } from "./logkey";
import { createLlm } from "./services/ai";

const log = createLogger();
const env = loadEnv();
const logKey = await loadLogKey(env.LOG_SIGNING_KEY);
if (logKey.ephemeral) log.warn("LOG_SIGNING_KEY not set, using a throwaway receipt key");

let ctx!: Ctx;
const jobs = createJobs(() => ctx);
ctx = { sql: connect(env.DATABASE_URL), env, log, relayer: createRelayer(env, log), logKey, jobs, llm: createLlm(env) };

const server = createApp(ctx).listen(env.PORT, () => {
  log.info({ port: env.PORT, onchain: ctx.relayer.enabled, ai: ctx.llm?.model ?? null }, "townsquare server listening");
});
jobs.start();

// Render sends SIGTERM on deploys and restarts: stop taking requests, then anchor
// whatever is still pending so no accepted event is left without an anchor.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down, anchoring pending events");
  server.close();
  try {
    await jobs.drain();
  } catch (err) {
    log.error({ err }, "drain failed");
  }
  await ctx.sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
