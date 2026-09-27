"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { use, useCallback, useEffect, useState } from "react";
import { api, friendly, txUrl, type PublicConversation } from "@/lib/api";

interface Dashboard extends PublicConversation {
  batches: { batch_id: number; from_seq: number; to_seq: number; tx_hash: string | null; status: string; created_at: string }[];
  votesLast5Min: number;
  rejections: Record<string, number>;
}
interface Mod {
  sid: number;
  text: string;
  status: "pending" | "approved" | "rejected";
  reason_code: string | null;
}

const REASONS = ["off_topic", "duplicate", "abusive", "personal_info", "spam"] as const;

export default function Host({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [token, setToken] = useState<string | null>(null);
  const [d, setD] = useState<Dashboard | null>(null);
  const [mods, setMods] = useState<Mod[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ finalResultHash: string; txHash: string | null } | null>(null);

  // The admin token arrives in the URL fragment once; keep it on this device only.
  useEffect(() => {
    const key = `ts-admin-${slug}`;
    const fromHash = window.location.hash.slice(1);
    if (fromHash) {
      localStorage.setItem(key, fromHash);
      history.replaceState(null, "", window.location.pathname);
    }
    setToken(localStorage.getItem(key));
  }, [slug]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [dash, queue] = await Promise.all([
        api<Dashboard>(`/conversations/${slug}/dashboard`, { token }),
        api<Mod[]>(`/conversations/${slug}/moderation`, { token }),
      ]);
      setD(dash);
      setMods(queue);
      setError(null);
    } catch (e) {
      setError(friendly(e));
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  if (token === null) return <p className="card">Open this page with your admin link.</p>;
  if (!d) return <p className="text-muted">{error ?? "Loading…"}</p>;

  const origin = window.location.origin;
  const participate = `${origin}/c/${slug}`;
  const pending = mods.filter((m) => m.status === "pending");
  const anonPct = Math.min(100, (d.counts.members / d.minMembers) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-teal">Host dashboard · {d.phase}</p>
          <h1 className="mt-1 text-2xl font-bold">{d.question}</h1>
        </div>
        <div className="flex gap-2">
          {d.phase === "draft" && (
            <button className="btn-primary" disabled={!!busy} onClick={() => act("open", () => api(`/conversations/${slug}`, { method: "PATCH", body: { phase: "open" }, token }))}>
              Open voting
            </button>
          )}
          {(d.phase === "open" || d.phase === "closed") && (
            <button
              className="btn-outline border-warm text-warm hover:bg-warm-soft"
              disabled={!!busy}
              onClick={() => {
                if (!confirm("Stop voting, anchor everything and seal the final result onchain? This can't be undone.")) return;
                void act("seal", async () => setSealed(await api(`/conversations/${slug}`, { method: "PATCH", body: { phase: "sealed" }, token })));
              }}
            >
              {busy === "seal" ? "Sealing…" : "Close and seal"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="rounded-xl bg-disagree/10 px-4 py-3 text-base text-disagree">{error}</p>}
      {(sealed || d.finalResultHash) && (
        <div className="card border-teal bg-teal-soft text-base">
          Sealed. Final result hash <span className="mono">{sealed?.finalResultHash ?? d.finalResultHash}</span>
          {sealed?.txHash && (
            <a className="ml-2 underline" href={txUrl(sealed.txHash)} target="_blank" rel="noreferrer">
              transaction
            </a>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Members", d.counts.members],
          ["Joined", d.counts.participants],
          ["Votes", d.counts.votes],
          ["Votes / 5 min", d.votesLast5Min],
        ].map(([k, v]) => (
          <div key={k} className="card">
            <p className="label">{k}</p>
            <p className="text-3xl font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="font-semibold">Anonymity</h2>
          <p className="text-base text-muted">
            Voting opens at {d.minMembers} members; now {d.counts.members}.
          </p>
          <div className="mt-3 h-3 rounded-full bg-line">
            <div className={`h-3 rounded-full ${d.anonymityReady ? "bg-teal" : "bg-warm"}`} style={{ width: `${anonPct}%` }} />
          </div>

          <h2 className="mt-6 font-semibold">Moderation {pending.length > 0 && <span className="text-warm">· {pending.length} waiting</span>}</h2>
          <p className="text-sm text-muted">Every decision is logged publicly with its reason.</p>
          <ul className="mt-3 divide-y divide-line">
            {mods.slice(0, 30).map((m) => (
              <li key={m.sid} className="flex flex-wrap items-center gap-2 py-2.5 text-base">
                <span className="text-muted">#{m.sid}</span>
                <span className="flex-1">{m.text}</span>
                {m.status === "pending" || m.status === "approved" ? (
                  <>
                    {m.status === "pending" && (
                      <button
                        className="rounded-lg bg-teal px-2.5 py-1 text-sm font-semibold text-white"
                        onClick={() => act(`m${m.sid}`, () => api(`/conversations/${slug}/statements/${m.sid}/moderate`, { body: { status: "approved", reasonCode: "ok" }, token }))}
                      >
                        Approve
                      </button>
                    )}
                    <select
                      className="rounded-lg border border-line px-2 py-1 text-sm"
                      value=""
                      onChange={(e) =>
                        act(`m${m.sid}`, () => api(`/conversations/${slug}/statements/${m.sid}/moderate`, { body: { status: "rejected", reasonCode: e.target.value }, token }))
                      }
                    >
                      <option value="" disabled>
                        Reject…
                      </option>
                      {REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="text-sm text-disagree">rejected · {m.reason_code?.replace("_", " ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-6">
          <div className="card text-center">
            <h2 className="font-semibold">Share</h2>
            <QRCodeSVG value={participate} size={148} className="mx-auto mt-3" />
            <p className="mono mt-3">{participate}</p>
            <div className="mt-3 flex justify-center gap-2 text-sm">
              <Link className="text-teal underline" href={`/r/${slug}`}>
                Public report
              </Link>
              <Link className="text-teal underline" href={`/verify/${slug}`}>
                Verify page
              </Link>
            </div>
          </div>

          <div className="card">
            <h2 className="font-semibold">Blocked attempts</h2>
            {Object.keys(d.rejections).length === 0 ? (
              <p className="mt-1 text-base text-muted">None so far.</p>
            ) : (
              <ul className="mt-2 space-y-1 font-mono text-sm">
                {Object.entries(d.rejections)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, n]) => (
                    <li key={code} className="flex justify-between">
                      <span>{code}</span>
                      <b>{n}</b>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold">Anchors</h2>
            {d.batches.length === 0 ? (
              <p className="mt-1 text-base text-muted">Nothing anchored yet. Batches go out every 2 minutes.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {d.batches.map((b) => (
                  <li key={b.batch_id} className="flex justify-between">
                    <span>
                      #{b.batch_id} · {b.from_seq}–{b.to_seq}
                    </span>
                    {b.tx_hash ? (
                      <a className="text-teal underline" href={txUrl(b.tx_hash)} target="_blank" rel="noreferrer">
                        {b.status}
                      </a>
                    ) : (
                      <span className="text-muted">{b.status}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
