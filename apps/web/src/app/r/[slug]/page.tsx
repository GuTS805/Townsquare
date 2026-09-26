"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { GROUP_COLORS, OpinionMap } from "@/components/OpinionMap";
import { api, friendly } from "@/lib/api";
import { subscribeToResults } from "@/lib/realtime";
import { getSession } from "@/lib/vault";

interface StatementStat {
  sid: number;
  agrees: number;
  disagrees: number;
  passes: number;
  seen: number;
}
interface MathResult {
  nParticipantsTotal: number;
  nVotes: number;
  k: number;
  points: { x: number; y: number; group: number }[];
  groups: { id: number; label: string; size: number; statsRedacted?: boolean; representative: { sid: number; direction: string; prob: number }[] }[];
  consensus: { agree: { sid: number; prob: number }[]; disagree: { sid: number; prob: number }[] };
  statementStats: StatementStat[];
  bridging?: { statements: { sid: number; score: number }[] } | null;
}
interface Synthesis {
  overview: string;
  themes: { title: string; sids: number[] }[];
  commonGround: { claim: string; sids: number[] }[];
  tensions: { groupA: string; groupB: string; claim: string; sids: number[] }[];
}
interface Results {
  title: string;
  question: string;
  phase: string;
  finalResultHash: string | null;
  statements: { sid: number; text: string; status: string; reason_code: string | null }[];
  result: { at_seq: number; math: MathResult; result_hash: string; created_at: string; synthesis: Synthesis | null; model: string | null } | null;
  lastAnchor: { batch_id: number; to_seq: number; tx_hash: string | null; created_at: string } | null;
}

export default function Report({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<Results | null>(null);
  const [you, setYou] = useState<{ x: number; y: number; group: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Results>(`/c/${slug}/results`));
      const s = await getSession(slug);
      if (s) setYou((await api<{ point: typeof you }>(`/c/${slug}/me?pid=${s.pid}`)).point);
    } catch (e) {
      setError(friendly(e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
    // Supabase Realtime when configured, otherwise a gentle poll
    const unsub = subscribeToResults(() => void load());
    const t = unsub ? null : setInterval(() => void load(), 10_000);
    return () => {
      unsub?.();
      if (t) clearInterval(t);
    };
  }, [load]);

  const text = useMemo(() => new Map(data?.statements.map((s) => [s.sid, s.text]) ?? []), [data]);
  const stats = useMemo(() => new Map(data?.result?.math.statementStats.map((s) => [s.sid, s]) ?? []), [data]);

  if (error && !data) return <p className="card text-disagree">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const math = data.result?.math;

  function exportCsv() {
    const rows = [["sid", "text", "agrees", "disagrees", "passes", "seen"]];
    for (const s of data!.statements.filter((x) => x.status === "approved")) {
      const st = stats.get(s.sid);
      rows.push([String(s.sid), `"${s.text.replace(/"/g, '""')}"`, String(st?.agrees ?? 0), String(st?.disagrees ?? 0), String(st?.passes ?? 0), String(st?.seen ?? 0)]);
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    a.download = `${slug}-statements.csv`;
    a.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-teal">{data.title}</p>
          <h1 className="mt-1 text-2xl font-bold">{data.question}</h1>
          {math && (
            <p className="mt-1 text-sm text-muted">
              {math.nParticipantsTotal} participants · {math.nVotes} votes · {math.k || "no"} opinion groups
            </p>
          )}
        </div>
        <AnchorBadge slug={slug} data={data} />
      </div>

      {!math ? (
        <div className="card text-sm text-muted">Results appear a few seconds after the first votes.</div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="card lg:col-span-3">
              <h2 className="mb-3 font-semibold">Opinion map</h2>
              <OpinionMap points={math.points} you={you} />
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {math.groups.map((g) => (
                  <span key={g.id} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLORS[g.id % GROUP_COLORS.length] }} />
                    Group {g.label} · {g.size}
                    {you?.group === g.id && <b> (you)</b>}
                  </span>
                ))}
              </div>
            </div>
            <div className="card lg:col-span-2">
              <h2 className="font-semibold">All groups agree</h2>
              <p className="text-xs text-muted">Every group leans agree on these.</p>
              <ul className="mt-3 space-y-3">
                {math.consensus.agree.slice(0, 6).map((c) => (
                  <StatRow key={c.sid} sid={c.sid} text={text.get(c.sid)} stat={stats.get(c.sid)} />
                ))}
                {math.consensus.agree.length === 0 && <li className="text-sm text-muted">No consensus yet.</li>}
              </ul>
            </div>
          </div>

          {data.result?.synthesis && <Summary s={data.result.synthesis} model={data.result.model} text={text} slug={slug} />}

          <div className="grid gap-4 md:grid-cols-2">
            {math.groups.map((g) => (
              <div key={g.id} className="card border-l-4" style={{ borderLeftColor: GROUP_COLORS[g.id % GROUP_COLORS.length] }}>
                <h3 className="font-semibold">
                  Group {g.label} <span className="text-sm font-normal text-muted">· {g.size} people</span>
                </h3>
                {g.statsRedacted ? (
                  <p className="mt-2 text-sm text-muted">Too small to show details without risking someone's privacy.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {g.representative.slice(0, 4).map((r) => (
                      <li key={r.sid}>
                        <span className={r.direction === "agree" ? "text-agree" : "text-disagree"}>
                          {Math.round(r.prob * 100)}% {r.direction}
                        </span>{" "}
                        · {text.get(r.sid)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {math.bridging && math.bridging.statements.length > 0 && (
            <div className="card">
              <h2 className="font-semibold">Bridging statements</h2>
              <p className="text-xs text-muted">Agreed with across opinion groups, not just within one.</p>
              <ul className="mt-3 space-y-3">
                {math.bridging.statements.slice(0, 5).map((b) => (
                  <StatRow key={b.sid} sid={b.sid} text={text.get(b.sid)} stat={stats.get(b.sid)} />
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="btn-outline" onClick={exportCsv}>
              Export CSV
            </button>
            <Link className="btn-outline" href={`/c/${slug}`}>
              Back to voting
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function StatRow({ sid, text, stat }: { sid: number; text?: string; stat?: StatementStat }) {
  const seen = stat?.seen || 1;
  return (
    <li>
      <p className="text-sm">
        <span className="text-muted">#{sid}</span> {text}
      </p>
      {stat && (
        <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line" title={`${stat.agrees} agree · ${stat.disagrees} disagree · ${stat.passes} pass`}>
          <div className="bg-agree" style={{ width: `${(stat.agrees / seen) * 100}%` }} />
          <div className="bg-disagree" style={{ width: `${(stat.disagrees / seen) * 100}%` }} />
        </div>
      )}
    </li>
  );
}

function AnchorBadge({ slug, data }: { slug: string; data: Results }) {
  const a = data.lastAnchor;
  const ago = a ? Math.max(0, Math.round((Date.now() - new Date(a.created_at).getTime()) / 60000)) : null;
  return (
    <Link href={`/verify/${slug}`} className="rounded-xl bg-teal-soft px-3 py-2 text-xs font-semibold text-teal hover:bg-teal-soft/70">
      {data.phase === "sealed" ? "Sealed ✓ · " : ""}
      {a ? `Anchored ${ago === 0 ? "just now" : `${ago} min ago`}` : "Not anchored yet"} · Verify it yourself →
    </Link>
  );
}

function Summary({ s, model, text, slug }: { s: Synthesis; model: string | null; text: Map<number, string>; slug: string }) {
  const n = s.themes.length + s.commonGround.length + s.tensions.length;
  const Cite = ({ sids }: { sids: number[] }) => (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {sids.map((sid) => (
        <span key={sid} title={text.get(sid)} className="cursor-help rounded-full bg-indigo-soft px-1.5 py-0.5 text-[10px] font-semibold text-indigo">
          #{sid}
        </span>
      ))}
    </span>
  );
  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">AI summary</h2>
        <Link href={`/verify/${slug}`} className="text-xs text-muted underline">
          {n} cited claims, each checked against the numbers (check F)
        </Link>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{s.overview}</p>
      {s.commonGround.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Common ground</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {s.commonGround.map((c, i) => (
              <li key={i}>
                {c.claim}
                <Cite sids={c.sids} />
              </li>
            ))}
          </ul>
        </>
      )}
      {s.tensions.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Where groups differ</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {s.tensions.map((t, i) => (
              <li key={i}>
                <span className="text-muted">
                  {t.groupA} vs {t.groupB}:
                </span>{" "}
                {t.claim}
                <Cite sids={t.sids} />
              </li>
            ))}
          </ul>
        </>
      )}
      {s.themes.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {s.themes.map((t, i) => (
            <span key={i} className="rounded-full border border-line px-3 py-1 text-xs">
              {t.title}
              <Cite sids={t.sids} />
            </span>
          ))}
        </div>
      )}
      {model && <p className="mt-4 text-[11px] text-muted">Written by {model}. Claims the vote numbers don't support are removed automatically.</p>}
    </div>
  );
}
