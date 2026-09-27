"use client";

import type { Receipt } from "@townsquare/core";
import { checkReceipt, type Bundle, type ChainData, type CheckResult, type ReceiptCheck } from "@townsquare/verifier";
import { use, useEffect, useRef, useState } from "react";
import { api, friendly, txUrl } from "@/lib/api";
import { listReceipts } from "@/lib/vault";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

const CHECKS: { id: string; name: string; catches: string }[] = [
  { id: "A", name: "Membership", catches: "fake or duplicate members" },
  { id: "B", name: "Pseudonyms", catches: "invented participants" },
  { id: "C", name: "Actions", catches: "forged or replayed votes" },
  { id: "D", name: "Log integrity", catches: "edited, deleted or reordered events" },
  { id: "E", name: "Results", catches: "cooked numbers" },
  { id: "F", name: "AI claims", catches: "hallucinated consensus" },
];

export default function Verify({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [chain, setChain] = useState<ChainData | null>(null);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [status, setStatus] = useState("Downloading the audit bundle…");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  async function run() {
    setRunning(true);
    setResults([]);
    setError(null);
    worker.current?.terminate();
    try {
      setStatus("Downloading the audit bundle…");
      const b = await api<Bundle>(`/c/${slug}/bundle`);
      setBundle(b);
      const w = new Worker(new URL("../../../lib/verifier.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "status") setStatus(m.text);
        else if (m.type === "chain") setChain(m.chain);
        else if (m.type === "check") setResults((r) => [...r, m.check]);
        else if (m.type === "done") {
          setRunning(false);
          setStatus("");
          w.terminate();
        } else if (m.type === "error") {
          setError(m.error);
          setRunning(false);
          w.terminate();
        }
      };
      setStatus("Running checks in your browser…");
      w.postMessage({ bundle: b, rpcUrl: RPC_URL });
    } catch (e) {
      setError(friendly(e));
      setRunning(false);
    }
  }

  useEffect(() => {
    void run();
    return () => worker.current?.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const failed = results.some((r) => r.status === "fail");
  const done = !running && results.length === CHECKS.length;

  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    a.download = `${slug}-audit-bundle.json`;
    a.click();
  }

  return (
    <div className="app-page verify-page mx-auto max-w-3xl space-y-6">
      <div className="page-hero">
        <p className="text-sm font-semibold uppercase tracking-widest text-teal">Verify it yourself</p>
        <h1 className="mt-1 text-2xl font-bold">{bundle?.conversation ? `Checking ${slug}` : "Checking…"}</h1>
        <p className="mt-2 text-base text-muted">
          Your browser downloads the full log and re-checks it. Anchors are read straight from Base through a public RPC, not from
          Townsquare's server.
        </p>
      </div>

      {done && (
        <div className={`card ${failed ? "border-disagree bg-disagree/5" : "border-teal bg-teal-soft"}`}>
          <p className={`font-semibold ${failed ? "text-disagree" : "text-teal"}`}>
            {failed ? "✗ Something doesn't add up. See the failing checks below." : "✓ Everything checks out."}
          </p>
          {!bundle?.meta.onchain && <p className="mt-1 text-sm text-muted">This server is not anchoring onchain, so D compares against its own batches only.</p>}
        </div>
      )}

      <div className="verify-checks space-y-2">
        {CHECKS.map((c, index) => {
          const r = results.find((x) => x.id === c.id);
          return (
            <details key={c.id} className={`card verify-check ${r ? "is-complete" : running && index === results.length ? "is-current" : ""}`} open={r?.status === "fail"}>
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                    !r ? "bg-line text-muted" : r.status === "fail" ? "bg-disagree text-white" : r.status === "warn" ? "bg-warm-soft text-warm" : "bg-teal text-white"
                  }`}
                >
                  {!r ? c.id : r.status === "fail" ? "✗" : "✓"}
                </span>
                <div className="flex-1">
                  <p className="font-semibold">
                    {c.id} · {c.name}
                  </p>
                  <p className="text-sm text-muted">{r ? r.summary : `catches ${c.catches}`}</p>
                </div>
                {r && <span className="text-sm text-muted">{r.ms} ms</span>}
              </summary>
              {r && r.failures.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 font-mono text-sm text-disagree">
                  {r.failures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}
      </div>

      {running && <p className="verify-status text-base text-muted" role="status">{status}</p>}
      {error && <p className="text-base text-disagree">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={running} onClick={() => void run()}>
          Run again
        </button>
        <button className="btn-outline" disabled={!bundle} onClick={download}>
          Download audit bundle
        </button>
      </div>

      {chain && chain.batches.length > 0 && (
        <div className="card">
          <h2 className="font-semibold">Anchors on Base</h2>
          <ul className="mt-2 space-y-1 text-base">
            {chain.batches.map((b) => (
              <li key={b.batch}>
                Batch {b.batch} · events {b.fromSeq}–{b.toSeq} ·{" "}
                <a className="text-teal underline" href={txUrl(b.txHash, bundle?.meta.chainId)} target="_blank" rel="noreferrer">
                  transaction
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bundle && <ReceiptChecker slug={slug} bundle={bundle} chain={chain} />}
    </div>
  );
}

function ReceiptChecker({ slug, bundle, chain }: { slug: string; bundle: Bundle; chain: ChainData | null }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReceiptCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<(Receipt & { label: string })[]>([]);

  useEffect(() => {
    void listReceipts(slug).then((r) => setMine(r.sort((a, b) => a.seq - b.seq))).catch(() => undefined);
  }, [slug]);

  async function check(r: Receipt) {
    setError(null);
    try {
      // only the signed fields; local extras (label, sid) are not part of the signature
      const { v, conv, seq, eventHash, head, logSig } = r;
      setResult(await checkReceipt({ v, conv, seq, eventHash, head, logSig }, bundle, chain));
    } catch (e) {
      setError(friendly(e));
    }
  }

  return (
    <div className="card receipt-card space-y-3">
      <h2 className="font-semibold">Check a receipt</h2>
      <p className="text-base text-muted">Every vote returns a receipt signed by the server. Paste one to see it in the anchored log.</p>
      {mine.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {mine.slice(-8).map((r) => (
            <button key={r.eventHash} className="rounded-full bg-indigo-soft px-3 py-1 text-sm text-indigo" onClick={() => void check(r)}>
              #{r.seq} {r.label}
            </button>
          ))}
        </div>
      )}
      <textarea className="input min-h-24 font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder='{"v":1,"conv":"…","seq":42,…}' />
      <button
        className="btn-outline"
        disabled={!text.trim()}
        onClick={() => {
          try {
            void check(JSON.parse(text));
          } catch {
            setError("That isn't valid receipt JSON.");
          }
        }}
      >
        Check receipt
      </button>
      {error && <p className="text-base text-disagree">{error}</p>}
      {result && (
        <p className={`rounded-xl px-3 py-2 text-base ${result.verdict === "included" ? "bg-teal-soft text-teal" : result.verdict === "pending" ? "bg-warm-soft text-warm" : "bg-disagree/10 text-disagree"}`}>
          {result.verdict === "included" ? "✓ " : result.verdict === "pending" ? "… " : "✗ "}
          {result.detail}
          {result.verdict === "host-misbehaved" && " This signed receipt is public proof of it."}
        </p>
      )}
    </div>
  );
}
