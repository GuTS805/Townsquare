/// <reference lib="webworker" />
import { ArtifactsOrigin, artifactUrls, generateArgs, init, prove, type FieldsToRevealArray } from "@anon-aadhaar/core";

// Builds the Anon Aadhaar proof off the main thread. The QR data never leaves this worker;
// only the proof goes back. The signal is the Semaphore commitment, so the proof can't be
// used to register anyone else.
type Start = { qrData: string; certificate: string; nullifierSeed: string; signal: string; reveal: FieldsToRevealArray };

// After the signature check the worker waits for "key-ready": the page downloads the proving
// key in its own worker, and starting the prover earlier would fetch the same chunks twice.
let keyReady: () => void = () => undefined;
const waitForKey = new Promise<void>((r) => (keyReady = r));

self.onmessage = async (ev: MessageEvent<Start | "key-ready">) => {
  if (ev.data === "key-ready") return keyReady();
  const { qrData, certificate, nullifierSeed, signal, reveal } = ev.data;
  try {
    self.postMessage({ stage: "signature" });
    const args = await generateArgs({ qrData, certificateFile: certificate, nullifierSeed: BigInt(nullifierSeed), signal, fieldsToRevealArray: reveal });
    self.postMessage({ stage: "fetching-zkey", wait: true });
    await waitForKey;
    await init({
      wasmURL: artifactUrls.v2.wasm,
      zkeyURL: artifactUrls.v2.chunked,
      vkeyURL: artifactUrls.v2.vk,
      artifactsOrigin: ArtifactsOrigin.chunked,
    });
    const pcd = await prove(args, (state) => self.postMessage({ stage: state }));
    self.postMessage({ stage: "done", proof: pcd.proof });
  } catch (e) {
    self.postMessage({ stage: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
