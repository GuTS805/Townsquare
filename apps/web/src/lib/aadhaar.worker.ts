/// <reference lib="webworker" />
import { ArtifactsOrigin, artifactUrls, generateArgs, init, prove, type FieldsToRevealArray } from "@anon-aadhaar/core";

// Builds the Anon Aadhaar proof off the main thread. The QR data never leaves this worker;
// only the proof goes back. The signal is the Semaphore commitment, so the proof can't be
// used to register anyone else.
self.onmessage = async (
  ev: MessageEvent<{ qrData: string; certificate: string; nullifierSeed: string; signal: string; reveal: FieldsToRevealArray }>,
) => {
  const { qrData, certificate, nullifierSeed, signal, reveal } = ev.data;
  try {
    self.postMessage({ stage: "signature" });
    const args = await generateArgs({ qrData, certificateFile: certificate, nullifierSeed: BigInt(nullifierSeed), signal, fieldsToRevealArray: reveal });
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
