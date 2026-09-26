/// <reference lib="webworker" />
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";

// Builds the Semaphore join proof off the main thread. Only the proof leaves this worker.
self.onmessage = async (ev: MessageEvent<{ secret: string; commitments: string[]; message: string; scope: string }>) => {
  const { secret, commitments, message, scope } = ev.data;
  try {
    self.postMessage({ stage: "group" });
    const identity = Identity.import(secret);
    const group = new Group(commitments.map(BigInt));
    if (group.indexOf(identity.commitment) === -1) throw new Error("your identity is not in this group yet");
    self.postMessage({ stage: "proving" });
    const proof = await generateProof(identity, group, BigInt(message), BigInt(scope));
    self.postMessage({ stage: "done", proof });
  } catch (e) {
    self.postMessage({ stage: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
