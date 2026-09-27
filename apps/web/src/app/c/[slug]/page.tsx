"use client";

import { STATEMENT_MAX, STATEMENT_MIN, joinMessage, joinScope, normalizeStatement } from "@townsquare/core";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { proveAadhaar, readQrImage, type AadhaarStage } from "@/lib/aadhaar";
import { ApiError, api, friendly, txUrl, type Meta, type PublicConversation } from "@/lib/api";
import { proveJoin, type ProveStage } from "@/lib/prove";
import {
  backupFile,
  clearSession,
  getSession,
  identityFor,
  markRegistered,
  newSessionKey,
  restoreFile,
  saveReceipt,
  saveSession,
  signAction,
} from "@/lib/vault";

type Stage = "loading" | "intro" | "registered" | "joining" | "vote";

export default function Participate({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [conv, setConv] = useState<PublicConversation | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [member, setMember] = useState<{ index?: number; txHash?: string | null }>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const c = await api<PublicConversation>(`/c/${slug}`);
    setConv(c);
    return c;
  }, [slug]);

  useEffect(() => {
    (async () => {
      try {
        await refresh();
        const id = await identityFor(slug);
        const session = await getSession(slug);
        setMember({ index: id.memberIndex, txHash: id.txHash });
        setStage(session ? "vote" : id.registered ? "registered" : "intro");
      } catch (e) {
        setError(friendly(e));
      }
    })();
  }, [slug, refresh]);

  // waiting room: keep counts fresh until voting can start
  useEffect(() => {
    if (stage !== "registered") return;
    const t = setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [stage, refresh]);

  if (error && !conv) return <p className="card text-disagree">{error}</p>;
  if (!conv || stage === "loading") return <p className="text-muted">Loading…</p>;

  return (
    <div className="participant-page mx-auto max-w-md space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-teal">Townsquare</p>
        <h1 className="mt-1 text-2xl font-bold">{conv.question}</h1>
        {conv.context && <p className="mt-2 text-base text-muted">{conv.context}</p>}
      </div>

      {(conv.phase === "closed" || conv.phase === "sealed") && stage !== "vote" ? (
        <div className="card">
          <p className="text-base">This conversation has {conv.phase === "sealed" ? "been sealed" : "closed"}.</p>
          <Link className="btn-primary mt-4 w-full" href={`/r/${slug}`}>
            See the results
          </Link>
        </div>
      ) : stage === "intro" ? (
        <Gate slug={slug} conv={conv} onDone={(index, txHash) => { setMember({ index, txHash }); setStage("registered"); void refresh(); }} />
      ) : stage === "registered" || stage === "joining" ? (
        <Registered
          slug={slug}
          conv={conv}
          member={member}
          joining={stage === "joining"}
          onJoin={() => setStage("joining")}
          onJoined={() => setStage("vote")}
          onFailed={() => setStage("registered")}
        />
      ) : (
        <Vote slug={slug} conv={conv} onStale={async () => { await clearSession(slug); setStage("registered"); }} />
      )}
    </div>
  );
}

function PrivacyCard() {
  return (
    <div className="rounded-2xl bg-teal-soft p-4">
      <h3 className="text-base font-semibold">What Townsquare knows about you</h3>
      <p className="mt-1 text-base text-muted">Nothing, except a proof that you're eligible and haven't joined before.</p>
    </div>
  );
}

function Gate({ slug, conv, onDone }: { slug: string; conv: PublicConversation; onDone: (index: number, txHash: string | null) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const m = window.location.hash.match(/code=([A-Za-z0-9-]+)/);
    if (m) {
      setCode(m[1]!);
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { identity } = await identityFor(slug);
      const r = await api<{ memberIndex: number; txHash: string | null }>(`/c/${slug}/gate/code`, {
        body: { code, commitment: identity.commitment.toString() },
      });
      await markRegistered(slug, r.memberIndex, r.txHash);
      onDone(r.memberIndex, r.txHash);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PrivacyCard />
      {conv.gate.type === "invite_code" ? (
        <div className="card space-y-3">
          <label className="label" htmlFor="code">
            Your invite code
          </label>
          <input id="code" className="input font-mono uppercase tracking-wider" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" autoComplete="off" />
          {error && <p className="text-base text-disagree">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || code.trim().length < 4} onClick={submit}>
            {busy ? "Registering…" : "Join with code"}
          </button>
          <p className="text-center text-sm text-muted">The code is used once. Afterwards nothing links it to your votes.</p>
        </div>
      ) : (
        <AadhaarGate slug={slug} conv={conv} onDone={onDone} />
      )}
      <RestoreLink slug={slug} />
    </div>
  );
}

function RestoreLink({ slug }: { slug: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <p className="text-center text-sm text-muted">
      Joined on another device?{" "}
      <button className="underline" onClick={() => input.current?.click()}>
        Restore from backup
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            await restoreFile(slug, f);
            window.location.reload();
          } catch (err) {
            setMsg(friendly(err));
          }
        }}
      />
      {msg && <span className="block text-disagree">{msg}</span>}
    </p>
  );
}

const STAGES: { key: ProveStage | "send"; label: string }[] = [
  { key: "group", label: "Loading the member list" },
  { key: "proving", label: "Generating your zero-knowledge proof" },
  { key: "send", label: "Joining anonymously" },
];

function Registered(p: {
  slug: string;
  conv: PublicConversation;
  member: { index?: number; txHash?: string | null };
  joining: boolean;
  onJoin: () => void;
  onJoined: () => void;
  onFailed: () => void;
}) {
  const { slug, conv } = p;
  const [stage, setStage] = useState<ProveStage | "send">("group");
  const [error, setError] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const ready = conv.phase === "open" && conv.counts.members >= conv.minMembers;

  async function backup() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await backupFile(slug));
    a.download = `townsquare-${slug}-identity.json`;
    a.click();
    setBackedUp(true);
  }

  async function join() {
    p.onJoin();
    setError(null);
    try {
      const { identity } = await identityFor(slug);
      const { commitments } = await api<{ commitments: string[] }>(`/c/${slug}/members`);
      const key = await newSessionKey();
      const proof = await proveJoin(
        { secret: identity.export(), commitments, message: joinMessage(key.spki).toString(), scope: joinScope(slug).toString() },
        setStage,
      );
      setStage("send");
      const r = await api<{ pid: string; keyVersion: number }>(`/c/${slug}/join`, { body: { proof, sessionKey: key.spki } });
      await saveSession(slug, { pid: r.pid, keyVersion: r.keyVersion, privateKey: key.privateKey, spki: key.spki, nonce: 0 });
      p.onJoined();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "ROOT_UNKNOWN" ? "New members joined while proving. Try again." : friendly(e));
      p.onFailed();
    }
  }

  if (p.joining) {
    const at = STAGES.findIndex((s) => s.key === stage);
    return (
      <div className="card space-y-4">
        <h2 className="font-semibold">Building your proof…</h2>
        <ul className="space-y-2 text-base">
          {STAGES.map((s, i) => (
            <li key={s.key} className={i < at ? "text-teal" : i === at ? "font-semibold" : "text-muted"}>
              {i < at ? "✓" : i === at ? "●" : "○"} {s.label}
            </li>
          ))}
        </ul>
        <p className="rounded-xl bg-warm-soft px-3 py-2 text-center text-sm text-warm">Please don't close this tab</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="text-base">
          You're member <b>#{p.member.index ?? "?"}</b>
          {p.member.txHash && (
            <>
              {" · "}
              <a className="text-teal underline" href={txUrl(p.member.txHash)} target="_blank" rel="noreferrer">
                on Base
              </a>
            </>
          )}
        </p>
        <p className="mt-2 text-sm text-muted">Your anonymous identity for this conversation lives only in this browser.</p>
        <button className="btn-outline mt-3 w-full" onClick={backup}>
          {backedUp ? "Backup downloaded ✓" : "Download a backup (to vote from another device)"}
        </button>
      </div>

      <div className="card">
        {conv.phase !== "open" ? (
          <p className="text-base text-muted">Voting hasn't opened yet. Keep this page; you can come back any time.</p>
        ) : !ready ? (
          <>
            <p className="text-base font-semibold">
              Voting opens at {conv.minMembers} members (now {conv.counts.members})
            </p>
            <div className="mt-3 h-2 rounded-full bg-line">
              <div className="h-2 rounded-full bg-teal transition-all" style={{ width: `${Math.min(100, (conv.counts.members / conv.minMembers) * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">Waiting keeps you anonymous: your vote hides among everyone who joined.</p>
          </>
        ) : (
          <>
            <p className="text-base">
              {conv.counts.members} people are in the group. Joining now proves you're one of them without saying which.
            </p>
            <button className="btn-primary mt-3 w-full" onClick={join}>
              Join anonymously
            </button>
          </>
        )}
        {error && <p className="mt-3 text-base text-disagree">{error}</p>}
      </div>
    </div>
  );
}

function Vote({ slug, conv, onStale }: { slug: string; conv: PublicConversation; onStale: () => void }) {
  const [next, setNext] = useState<{ statement: { sid: number; text: string } | null; seen: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    const s = await getSession(slug);
    if (!s) return onStale();
    setNext(await api(`/c/${slug}/next?pid=${s.pid}`));
  }, [slug, onStale]);

  useEffect(() => {
    void load().catch((e) => setError(friendly(e)));
  }, [load]);

  async function send(build: Parameters<typeof signAction>[1], label: string, kind: string) {
    setBusy(true);
    setError(null);
    try {
      const { action, sig } = await signAction(slug, build);
      const r = await api(`/c/${slug}/actions`, { body: { action, sig } });
      await saveReceipt(slug, r, kind, label);
      setReceipt(r.seq);
      await load();
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.code === "STALE_KEY" || e.code === "UNKNOWN_PID")) onStale();
      setError(friendly(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const vote = (value: -1 | 0 | 1) => {
    const s = next!.statement!;
    void send((b) => ({ ...b, kind: "vote", sid: s.sid, value }), `#${s.sid} ${value === 1 ? "agree" : value === -1 ? "disagree" : "pass"}`, "vote");
  };

  const clean = normalizeStatement(text);
  const textOk = clean.length >= STATEMENT_MIN && clean.length <= STATEMENT_MAX;

  if (!next) return <p className="text-muted">Loading…</p>;
  const closed = conv.phase !== "open";

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm text-muted">
          <span>
            {next.seen} of {next.total} seen
          </span>
          <Link href={`/r/${slug}`} className="underline">
            Live results
          </Link>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-line">
          <div className="h-1.5 rounded-full bg-teal" style={{ width: `${next.total ? (next.seen / next.total) * 100 : 0}%` }} />
        </div>
      </div>

      {closed ? (
        <div className="card text-base">Voting has closed.</div>
      ) : next.statement ? (
        <div className="card">
          <p className="min-h-28 text-xl font-medium leading-snug sm:text-2xl">{next.statement.text}</p>
          <p className="mt-3 text-sm text-muted">Statement #{next.statement.sid}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button className="btn py-4 px-2 sm:px-5 bg-agree text-white hover:opacity-90" disabled={busy} onClick={() => vote(1)}>
              Agree
            </button>
            <button className="btn py-4 px-2 sm:px-5 bg-disagree text-white hover:opacity-90" disabled={busy} onClick={() => vote(-1)}>
              Disagree
            </button>
            <button className="btn py-4 px-2 sm:px-5 bg-line text-ink hover:bg-line/70" disabled={busy} onClick={() => vote(0)}>
              Pass
            </button>
          </div>
        </div>
      ) : (
        <div className="card text-center">
          <p className="font-semibold">You've seen every statement.</p>
          <p className="mt-1 text-base text-muted">Add your own, or see where you stand.</p>
          <Link href={`/r/${slug}`} className="btn-primary mt-4 w-full">
            See the opinion map
          </Link>
        </div>
      )}

      {!closed &&
        (writing ? (
          <div className="card space-y-3">
            <textarea className="input min-h-24" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write something others can agree or disagree with" maxLength={STATEMENT_MAX + 20} />
            <div className="flex items-center justify-between">
              <span className={`text-sm ${text && !textOk ? "text-disagree" : "text-muted"}`}>
                {clean.length}/{STATEMENT_MAX}
              </span>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setWriting(false)}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  disabled={!textOk || busy}
                  onClick={async () => {
                    if (await send((b) => ({ ...b, kind: "statement", text: clean }), "your statement", "statement")) {
                      setText("");
                      setWriting(false);
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>
            {conv.moderation === "pre" && <p className="text-sm text-muted">The host reviews new statements before others see them.</p>}
          </div>
        ) : (
          <button className="btn-ghost w-full text-teal" onClick={() => setWriting(true)}>
            + Add your statement
          </button>
        ))}

      {error && <p className="text-center text-base text-disagree">{error}</p>}
      {receipt !== null && <p className="rounded-xl bg-indigo-soft py-2 text-center text-sm text-indigo">Receipt #{receipt} saved on this device</p>}
    </div>
  );
}

const AADHAAR_STAGES: { key: AadhaarStage; label: string }[] = [
  { key: "reading", label: "Reading the QR" },
  { key: "signature", label: "Checking the UIDAI signature" },
  { key: "fetching-zkey", label: "Downloading the proving key (large, first time only)" },
  { key: "proving", label: "Generating your zero-knowledge proof" },
  { key: "done", label: "Joining the group" },
];

function AadhaarGate({ slug, conv, onDone }: { slug: string; conv: PublicConversation; onDone: (index: number, txHash: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<AadhaarStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Meta["aadhaarMode"] | null>(null);

  useEffect(() => {
    void api<Meta>("/meta").then((m) => setMode(m.aadhaarMode)).catch(() => setMode("test"));
  }, []);

  async function run(file: File) {
    setError(null);
    try {
      setStage("reading");
      const qrData = await readQrImage(file);
      const certificate = await (await fetch("/anon-aadhaar-test-certificate.pem")).text();
      const { identity } = await identityFor(slug);
      const proof = await proveAadhaar(
        { qrData, certificate, nullifierSeed: conv.gate.nullifierSeed!, signal: identity.commitment.toString(), reveal: conv.gate.reveal },
        (s) => setStage(s === "fetching-wasm" ? "fetching-zkey" : s),
      );
      const r = await api<{ memberIndex: number; txHash: string | null }>(`/c/${slug}/gate/aadhaar`, {
        body: { proof, commitment: identity.commitment.toString() },
      });
      await markRegistered(slug, r.memberIndex, r.txHash);
      onDone(r.memberIndex, r.txHash);
    } catch (e) {
      setError(friendly(e));
      setStage(null);
    }
  }

  if (mode === "production") {
    return <div className="card text-base text-muted">This build runs Anon Aadhaar in test mode only. Ask the host for an invite code.</div>;
  }

  if (stage) {
    const at = AADHAAR_STAGES.findIndex((s) => s.key === stage);
    return (
      <div className="card space-y-4">
        <h2 className="font-semibold">Building your proof…</h2>
        <ul className="space-y-2 text-base">
          {AADHAAR_STAGES.map((s, i) => (
            <li key={s.key} className={i < at ? "text-teal" : i === at ? "font-semibold" : "text-muted"}>
              {i < at ? "✓" : i === at ? "●" : "○"} {s.label}
            </li>
          ))}
        </ul>
        <p className="rounded-xl bg-warm-soft px-3 py-2 text-center text-sm text-warm">Please don't close this tab. This can take a few minutes on a phone.</p>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <button className="btn-primary w-full" onClick={() => input.current?.click()}>
        Verify with Aadhaar (ZK)
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(f);
          e.target.value = "";
        }}
      />
      <p className="text-center text-sm text-muted">
        Upload a screenshot of the Secure QR. It never leaves this phone; only a zero-knowledge proof does.
        {conv.gate.reveal.includes("ageAbove18") && " The proof shows you're over 18 and nothing else."}
      </p>
      <p className="rounded-xl bg-indigo-soft px-3 py-2 text-center text-sm text-indigo">
        Test mode: use a test QR from the Anon Aadhaar test QR generator, not a real Aadhaar.
      </p>
      {error && <p className="text-base text-disagree">{error}</p>}
    </div>
  );
}
