/// <reference lib="webworker" />
import localforage from "localforage";

// Downloads the Anon Aadhaar proving key into the same localforage slots @anon-aadhaar/core
// reads (circuit_final_<i>.zkey), so the prover finds it cached. Chunks are gunzipped while
// they stream in and fetched two at a time, which keeps memory low on 8 GB laptops.
const BASE = "https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0";
// Compressed sizes of the v2.0.0 chunks, for the progress bar before each response arrives.
const SIZES = [8525757, 6238719, 5735232, 26831998, 40012897, 24679358, 34121118, 27311040, 61226907, 61226349];
const PARALLEL = 2;

const loaded = new Array<number>(SIZES.length).fill(0);
let lastReport = 0;
const report = (force = false) => {
  if (!force && Date.now() - lastReport < 250) return;
  lastReport = Date.now();
  self.postMessage({ type: "progress", loaded: loaded.reduce((a, b) => a + b, 0), total: SIZES.reduce((a, b) => a + b, 0) });
};

async function fetchChunk(i: number) {
  const res = await fetch(`${BASE}/chunked_zkey/circuit_final_${i}.gz`);
  if (!res.ok || !res.body) throw new Error(`proving key download failed (${res.status})`);
  const count = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(part, ctl) {
      loaded[i]! += part.length;
      report();
      ctl.enqueue(part);
    },
  });
  const reader = res.body.pipeThrough(count).pipeThrough(new DecompressionStream("gzip")).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  await localforage.setItem(`circuit_final_${i}.zkey`, out);
  loaded[i] = SIZES[i]!;
  report(true);
}

self.onmessage = async () => {
  try {
    const missing: number[] = [];
    for (let i = 0; i < SIZES.length; i++) {
      if (await localforage.getItem(`circuit_final_${i}.zkey`)) loaded[i] = SIZES[i]!;
      else missing.push(i);
    }
    report(true);
    // Warms the HTTP cache for the circuit wasm the prover fetches later.
    const wasm = fetch(`${BASE}/aadhaar-verifier.wasm`).then((r) => r.arrayBuffer()).catch(() => undefined);
    const worker = async () => {
      for (let i = missing.shift(); i !== undefined; i = missing.shift()) {
        for (let attempt = 1; ; attempt++) {
          try {
            await fetchChunk(i);
            break;
          } catch (e) {
            loaded[i] = 0;
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    await wasm;
    self.postMessage({ type: "done" });
  } catch (e) {
    self.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
