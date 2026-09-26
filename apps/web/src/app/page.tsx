import Link from "next/link";

const promises = [
  {
    title: "One person, one voice",
    body: "Entry needs a zero-knowledge proof: Anon Aadhaar or a one-time invite code. Each credential can join a conversation once, enforced in the database and on Ethereum.",
    tone: "border-t-teal",
  },
  {
    title: "Nobody knows who you are",
    body: "A Semaphore proof says “I'm one of the verified members” without saying which one. Your votes sit under a pseudonym that can't be traced back to you.",
    tone: "border-t-indigo",
  },
  {
    title: "Nobody can quietly change the result",
    body: "Every action goes into a hash-chained log anchored on Base. Anyone can re-check members, votes and the math in their own browser.",
    tone: "border-t-warm",
  },
];

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="overflow-hidden rounded-3xl bg-deep px-6 py-14 text-white sm:px-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-soft/70">Deliberation you can verify</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">Proof that real people agree.</h1>
        <p className="mt-5 max-w-xl text-teal-soft/90">
          Ask a question, collect short statements, and let people vote agree, disagree or pass. Townsquare maps the
          opinion groups and finds what all of them agree on, without ever learning who anyone is.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/new" className="btn bg-white text-deep hover:bg-teal-soft">
            Start a conversation
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {promises.map((p) => (
          <div key={p.title} className={`card border-t-4 ${p.tone}`}>
            <h3 className="font-semibold">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="card bg-warm-soft/60">
        <p className="text-sm leading-relaxed">
          In 2017, about 18 million of the 22 million public comments sent to the US FCC were fake, and one
          19-year-old submitted 7.7 million of them. Townsquare makes that impossible without asking anyone who they are.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          ["1", "Host", "Creates the question, picks a gate, shares a link. Moderation decisions are public."],
          ["2", "Participant", "Proves eligibility once, then votes from their phone. No wallet, no gas, no account."],
          ["3", "Anyone", "Opens the Verify page and re-checks every member, vote and number against the chain."],
        ].map(([n, t, d]) => (
          <div key={n} className="flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-bold text-white">{n}</span>
            <div>
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
