"use client";

import { STATEMENT_MAX, STATEMENT_MIN, normalizeStatement } from "@townsquare/core";
import Link from "next/link";
import { useState } from "react";
import { CodeSheet } from "@/components/CodeSheet";
import { api, friendly, txUrl } from "@/lib/api";

type Step = 0 | 1 | 2 | 3;
const STEPS = ["Question", "Seed statements", "Gate", "Rules"];

interface Created {
  slug: string;
  adminToken: string;
  inviteCodes: string[];
  chain: { convId: string; txHash: string } | null;
}

export default function NewConversation() {
  const [step, setStep] = useState<Step>(0);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [seeds, setSeeds] = useState<string[]>(["", "", "", "", ""]);
  const [gate, setGate] = useState<"invite_code" | "anon_aadhaar">("invite_code");
  const [codeCount, setCodeCount] = useState(60);
  const [minMembers, setMinMembers] = useState(10);
  const [moderation, setModeration] = useState<"pre" | "post">("post");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const cleanSeeds = seeds.map(normalizeStatement).filter(Boolean);
  const seedsOk = cleanSeeds.length >= 3 && cleanSeeds.every((s) => s.length >= STATEMENT_MIN && s.length <= STATEMENT_MAX);
  const canNext = [title.trim().length >= 3 && question.trim().length >= 5, seedsOk, true, minMembers >= 2][step];

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        question,
        context,
        seedStatements: cleanSeeds,
        gate: gate === "invite_code" ? { type: gate, codeCount } : { type: gate },
        minMembers,
        moderation,
      };
      setCreated(await api<Created>("/conversations", { body }));
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) return <CreatedView c={created} title={title} />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold">New conversation</h1>
      <ol className="mt-6 flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex-1 border-t-4 pt-2 ${i <= step ? "border-teal text-ink" : "border-line text-muted"}`}>
            {i + 1} · {s}
          </li>
        ))}
      </ol>

      <div className="card mt-6 space-y-5">
        {step === 0 && (
          <>
            <div>
              <label className="label" htmlFor="f-title">Title</label>
              <input id="f-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Library hours during exams" maxLength={120} />
            </div>
            <div>
              <label className="label" htmlFor="f-question">The question</label>
              <input id="f-question" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How should the library work during exam weeks?" maxLength={280} />
            </div>
            <div>
              <label className="label" htmlFor="f-context">Context (optional)</label>
              <textarea id="f-context" className="input min-h-28" value={context} onChange={(e) => setContext(e.target.value)} maxLength={2000} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-sm text-muted">
              Write 3–15 short statements people can agree or disagree with ({STATEMENT_MIN}–{STATEMENT_MAX} characters). Participants can add their own later.
            </p>
            {seeds.map((s, i) => {
              const n = normalizeStatement(s).length;
              const bad = n > 0 && (n < STATEMENT_MIN || n > STATEMENT_MAX);
              return (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={`input ${bad ? "border-disagree" : ""}`}
                    value={s}
                    onChange={(e) => setSeeds(seeds.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={i === 0 ? "The library should stay open till 10 pm during exams." : ""}
                  />
                  <span className={`w-10 text-right text-xs ${bad ? "text-disagree" : "text-muted"}`}>{n}</span>
                </div>
              );
            })}
            {seeds.length < 15 && (
              <button className="btn-ghost px-0" onClick={() => setSeeds([...seeds, ""])}>
                + Add another
              </button>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <GateOption
                active={gate === "invite_code"}
                onClick={() => setGate("invite_code")}
                title="One-time invite codes"
                body="You hand out printed codes. Their fingerprint is fixed on Ethereum now, so no codes can be added later."
              />
              <GateOption
                active={gate === "anon_aadhaar"}
                onClick={() => setGate("anon_aadhaar")}
                title="Anon Aadhaar"
                body="Participants prove they hold an Aadhaar with a zero-knowledge proof. Reveals nothing about them."
                note="Coming next"
                disabled
              />
            </div>
            {gate === "invite_code" && (
              <div>
                <label className="label" htmlFor="f-codes">How many codes</label>
                <input id="f-codes"
                  type="number"
                  className="input"
                  min={1}
                  max={2000}
                  value={codeCount}
                  onChange={(e) => setCodeCount(Math.max(1, Math.min(2000, Number(e.target.value))))}
                />
                <p className="mt-1.5 text-xs text-muted">One per person. You'll see them once, as a printable sheet.</p>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div>
              <label className="label" htmlFor="f-min">Minimum anonymity set</label>
              <input id="f-min" type="number" className="input" min={2} max={1000} value={minMembers} onChange={(e) => setMinMembers(Math.max(2, Number(e.target.value)))} />
              <p className="mt-1.5 text-xs text-muted">Voting opens once this many people have registered. 10 is the default; use 25+ for sensitive topics.</p>
            </div>
            <div>
              <label className="label">New statements from participants</label>
              <div className="flex gap-2">
                {(["post", "pre"] as const).map((m) => (
                  <button key={m} className={moderation === m ? "btn-primary" : "btn-outline"} onClick={() => setModeration(m)}>
                    {m === "post" ? "Publish, moderate after" : "Review before publishing"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {error && <p className="rounded-xl bg-disagree/10 px-4 py-3 text-sm text-disagree">{error}</p>}

        <div className="flex justify-between pt-2">
          <button className="btn-ghost" disabled={step === 0 || busy} onClick={() => setStep((step - 1) as Step)}>
            Back
          </button>
          {step < 3 ? (
            <button className="btn-primary" disabled={!canNext} onClick={() => setStep((step + 1) as Step)}>
              Next
            </button>
          ) : (
            <button className="btn-primary" disabled={!canNext || busy} onClick={publish}>
              {busy ? "Publishing to Base…" : "Publish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GateOption(p: { active: boolean; onClick: () => void; title: string; body: string; note?: string; disabled?: boolean }) {
  return (
    <button
      disabled={p.disabled}
      onClick={p.onClick}
      className={`rounded-2xl border p-4 text-left transition disabled:opacity-50 ${p.active ? "border-teal bg-teal-soft" : "border-line bg-white hover:border-teal/50"}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{p.title}</span>
        {p.note && <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">{p.note}</span>}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{p.body}</p>
    </button>
  );
}

function CreatedView({ c, title }: { c: Created; title: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const adminLink = `${origin}/host/${c.slug}#${c.adminToken}`;
  return (
    <div className="space-y-6">
      <div className="card border-warm bg-warm-soft">
        <h2 className="text-lg font-semibold">Save your admin link now</h2>
        <p className="mt-1 text-sm text-muted">It's the only way to moderate, open and seal this conversation. Anyone with it is the host.</p>
        <p className="mono mt-3 rounded-lg bg-white p-3">{adminLink}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => navigator.clipboard.writeText(adminLink)}>
            Copy admin link
          </button>
          <Link className="btn-outline" href={`/host/${c.slug}#${c.adminToken}`}>
            Open dashboard
          </Link>
        </div>
        {c.chain && (
          <p className="mt-3 text-xs text-muted">
            Created on Base ·{" "}
            <a className="underline" href={txUrl(c.chain.txHash)} target="_blank" rel="noreferrer">
              view transaction
            </a>
          </p>
        )}
      </div>
      {c.inviteCodes.length > 0 && <CodeSheet slug={c.slug} title={title} codes={c.inviteCodes} />}
    </div>
  );
}
