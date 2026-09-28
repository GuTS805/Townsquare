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

export type KeyProgress = { loaded: number; total: number; done: boolean };

let keyDownload: Promise<void> | null = null;
let keyProgress: KeyProgress | null = null;
const keyListeners = new Set<(p: KeyProgress) => void>();

// Downloads the ~300 MB proving key into the browser cache once per page load. Safe to call
// repeatedly; later calls share the running download. A failed download can be started again.
export function downloadProvingKey(): Promise<void> {
  keyDownload ??= new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./aadhaar-key.worker.ts", import.meta.url), { type: "module" });
    const emit = (p: KeyProgress) => {
      keyProgress = p;
      keyListeners.forEach((l) => l(p));
    };
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "progress") emit({ loaded: m.loaded, total: m.total, done: false });
      else {
        worker.terminate();
        if (m.type === "done") {
          emit({ loaded: keyProgress?.total ?? 1, total: keyProgress?.total ?? 1, done: true });
          resolve();
        } else {
          keyDownload = null;
          reject(new Error(m.error));
        }
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      keyDownload = null;
      reject(new Error(e.message || "download crashed"));
    };
    worker.postMessage("start");
  });
  return keyDownload;
}

export function onKeyProgress(listener: (p: KeyProgress) => void): () => void {
  keyListeners.add(listener);
  if (keyProgress) listener(keyProgress);
  return () => keyListeners.delete(listener);
}

type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; type?: string } };

// Phones and small laptops often run out of memory while proving. deviceMemory is Chromium-only
// and rounded, so an unknown value counts as fine.
export function lowMemoryDevice(): boolean {
  const mem = (navigator as NavigatorHints).deviceMemory;
  return mem !== undefined && mem <= 4;
}

// Starting a 300 MB download without asking is fine on Wi-Fi, not on mobile data.
export function shouldPrefetchKey(): boolean {
  const c = (navigator as NavigatorHints).connection;
  return !c?.saveData && c?.type !== "cellular" && !lowMemoryDevice();
}

// Keeps a phone screen on while the proof runs; the browser drops the lock when the tab hides.
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => undefined);
  } catch {
    return () => undefined;
  }
}

export function proveAadhaar(
  input: { qrData: string; certificate: string; nullifierSeed: string; signal: string; reveal: string[] },
  onStage: (s: AadhaarStage) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./aadhaar.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.wait) {
        onStage("fetching-zkey");
        downloadProvingKey().then(
          () => worker.postMessage("key-ready"),
          (e: Error) => {
            worker.terminate();
            reject(e);
          },
        );
      } else if (m.stage === "error") {
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
