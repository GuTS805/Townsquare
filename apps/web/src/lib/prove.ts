"use client";

import type { SemaphoreProof } from "@semaphore-protocol/proof";

export type ProveStage = "group" | "proving" | "done";

export function proveJoin(
  input: { secret: string; commitments: string[]; message: string; scope: string },
  onStage: (s: ProveStage) => void,
): Promise<SemaphoreProof> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./prover.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.stage === "error") {
        worker.terminate();
        reject(new Error(m.error));
      } else if (m.stage === "done") {
        worker.terminate();
        onStage("done");
        resolve(m.proof);
      } else onStage(m.stage);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "prover crashed"));
    };
    worker.postMessage(input);
  });
}
