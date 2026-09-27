import PQueue from "p-queue";
import type { Ctx } from "./context";
import { anchorAll } from "./services/anchor";
import { summarize, summaryWaitMs } from "./services/ai";
import { recomputeResults } from "./services/results";

export interface Jobs {
  onNewVotes(convId: string): void;
  start(): void;
  // Anchor everything still pending. Called on SIGTERM so nothing is left unanchored.
  drain(): Promise<void>;
}

const MATH_DEBOUNCE_MS = 3_000;

// In-process replacement for BullMQ: one queue for background work, so math and
// anchoring never run concurrently with themselves.
export function createJobs(getCtx: () => Ctx): Jobs {
  const queue = new PQueue({ concurrency: 1 });
  const mathTimers = new Map<string, NodeJS.Timeout>();
  const summaryTimers = new Map<string, NodeJS.Timeout>();
  let anchorTimer: NodeJS.Timeout | null = null;
  let stopping = false;

  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    fn().catch((err) => getCtx().log.error({ err, job: name }, "job failed"));

  return {
    onNewVotes(convId) {
      if (stopping) return;
      const t = mathTimers.get(convId);
      if (t) clearTimeout(t);
      mathTimers.set(
        convId,
        setTimeout(() => {
          mathTimers.delete(convId);
          void queue.add(safe("math", () => recomputeResults(getCtx(), convId)));
          // At most once per 10 minutes, but always once after the last burst of votes,
          // so the latest result gets a summary even when voting stops inside the window.
          if (!summaryTimers.has(convId)) {
            summaryTimers.set(
              convId,
              setTimeout(() => {
                summaryTimers.delete(convId);
                if (!stopping) void queue.add(safe("summary", () => summarize(getCtx(), convId)));
              }, summaryWaitMs(convId)),
            );
          }
        }, MATH_DEBOUNCE_MS),
      );
    },
    start() {
      const every = Math.min(getCtx().env.ANCHOR_INTERVAL_MS, 30_000);
      anchorTimer = setInterval(() => {
        if (queue.size === 0) void queue.add(safe("anchor", () => anchorAll(getCtx())));
      }, every);
    },
    async drain() {
      stopping = true;
      if (anchorTimer) clearInterval(anchorTimer);
      for (const t of mathTimers.values()) clearTimeout(t);
      for (const t of summaryTimers.values()) clearTimeout(t);
      await queue.onIdle();
      await anchorAll(getCtx(), true);
      await getCtx().relayer.idle();
    },
  };
}
