"use client";

import jsQR from "jsqr";

export type AadhaarStage = "reading" | "signature" | "fetching-wasm" | "fetching-zkey" | "proving" | "done";

// Reads the Secure QR from an uploaded image. Aadhaar QRs are dense, so the image is
// scaled up a little before decoding when it's small.
export async function readQrImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
  if (!code?.data) throw new Error("Couldn't find a QR code in that image. Try a sharper screenshot of the Secure QR.");
  if (!/^\d{500,}$/.test(code.data.trim())) throw new Error("That QR isn't an Aadhaar Secure QR.");
  return code.data.trim();
}

const REVEAL_FIELDS: Record<string, "revealAgeAbove18" | "revealState"> = {
  ageAbove18: "revealAgeAbove18",
  state: "revealState",
};

export function proveAadhaar(
  input: { qrData: string; certificate: string; nullifierSeed: string; signal: string; reveal: string[] },
  onStage: (s: AadhaarStage) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./aadhaar.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.stage === "error") {
        worker.terminate();
        reject(new Error(m.error));
      } else if (m.stage === "done") {
        worker.terminate();
        onStage("done");
        resolve(m.proof);
      } else if (m.stage !== "initializing" && m.stage !== "completed") onStage(m.stage);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "prover crashed"));
    };
    worker.postMessage({ ...input, reveal: input.reveal.map((r) => REVEAL_FIELDS[r]).filter(Boolean) });
  });
}
