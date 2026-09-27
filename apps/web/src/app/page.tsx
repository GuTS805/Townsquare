import Link from "next/link";
import "./home.css";

const promises = [
  {
    title: "One person, one voice",
    body: "Entry needs a zero-knowledge proof: Anon Aadhaar or a one-time invite code. Each credential can join a conversation once, enforced in the database and on Ethereum.",
    icon: "person",
  },
  {
    title: "Nobody knows who you are",
    body: "A Semaphore proof says “I'm one of the verified members” without saying which one. Your votes sit under a pseudonym that can't be traced back to you.",
    icon: "mask",
  },
  {
    title: "Nobody can quietly change the result",
    body: "Every action goes into a hash-chained log anchored on Base. Anyone can re-check members, votes and the math in their own browser.",
    icon: "shield",
  },
] as const;

const steps = [
  ["1", "Host", "Creates the question, picks a gate, shares a link. Moderation decisions are public."],
  ["2", "Participant", "Proves eligibility once, then votes from their phone. No wallet, no gas, no account."],
  ["3", "Anyone", "Opens the Verify page and re-checks every member, vote and number against the chain."],
] as const;

export default function Home() {
  return (
    <div className="home-page">
      <div className="home-scene" aria-hidden="true" />
      <div className="home-shell">
        <section className="home-intro" aria-labelledby="home-title">
          <div className="home-intro-copy">
            <p className="home-eyebrow">Deliberation you can verify</p>
            <h1 id="home-title">Proof that<br />real people<br /><span>agree.</span></h1>
            <p className="home-description">
              Ask a question, collect short statements, and let people vote agree, disagree or pass. Townsquare maps the
              opinion groups and finds what all of them agree on, without ever learning who anyone is.
            </p>
            <div className="home-actions">
              <Link href="/new" className="home-primary-action">Start a conversation <ArrowIcon /></Link>
              <a href="#how-it-works" className="home-secondary-action">See how it works <PlayIcon /></a>
            </div>
            <div className="home-trust" aria-label="Townsquare features">
              <span><TrustIcon type="wallet" />No wallet needed</span>
              <span><TrustIcon type="mask" />Anonymous</span>
              <span><TrustIcon type="shield" />Publicly verifiable</span>
              <span><TrustIcon type="source" />Open source</span>
            </div>
          </div>
          <div className="home-scene-note" aria-hidden="true">
            <span>Real discussions.</span>
            <span>Anonymous participants.</span>
            <span>Tamper-evident results.</span>
            <strong>A more rational internet.</strong>
          </div>
          <div className="home-vote-badges" aria-hidden="true">
            <span className="home-vote-badge home-vote-agree"><i />Agree</span>
            <span className="home-vote-badge home-vote-disagree"><i />Disagree</span>
            <span className="home-vote-badge home-vote-pass"><i />Pass</span>
          </div>
        </section>

        <section id="verification" className="home-promises" aria-label="Why Townsquare works">
          {promises.map((promise) => (
            <article className={`home-promise home-promise-${promise.icon}`} key={promise.title}>
              <div className="home-promise-icon"><FeatureIcon type={promise.icon} /></div>
              <h2>{promise.title}</h2>
              <p>{promise.body}</p>
            </article>
          ))}
        </section>

        <aside className="home-fcc-note">
          <span className="home-quote-icon" aria-hidden="true">“</span>
          <p>In 2017, about 18 million of the 22 million public comments sent to the US FCC were fake, and one 19-year-old submitted 7.7 million of them. Townsquare makes that impossible without asking anyone who they are.</p>
        </aside>

        <section id="how-it-works" className="home-steps" aria-label="How Townsquare works">
          {steps.map(([number, title, description]) => (
            <div className="home-step" key={number}>
              <span className="home-step-number">{number}</span>
              <div><h2>{title}</h2><p>{description}</p></div>
            </div>
          ))}
          <Link id="explore" href="/new" className="home-explore">Start a conversation <ArrowIcon /></Link>
        </section>
      </div>
    </div>
  );
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
}

function FeatureIcon({ type }: { type: "person" | "mask" | "shield" }) {
  if (type === "person") return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><circle cx="16" cy="10" r="5" /><path d="M5 28c0-6.2 4.5-10 11-10s11 3.8 11 10H5Z" /></svg>;
  if (type === "mask") return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M3 8.5c0-1 1-1.5 1.8-1.1A26 26 0 0 0 16 9.7a26 26 0 0 0 11.2-2.3c.8-.4 1.8.1 1.8 1.1V17c0 7.2-5.4 11-13 11S3 24.2 3 17V8.5Zm5.3 7.1c.7 2.4 2.3 3.8 4.4 3.8 1.6 0 2.6-1 3.3-2.4.7 1.4 1.7 2.4 3.3 2.4 2.1 0 3.7-1.4 4.4-3.8-1.8-.9-3.3-.8-4.5.2-1.5 1.3-3.9 1.3-5.4 0-1.2-1-2.7-1.1-4.5-.2Z" /></svg>;
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 2 28 7v9c0 7-4.5 11.5-12 14C8.5 27.5 4 23 4 16V7L16 2Z" fill="currentColor" /><path d="M16 6v20m0 0c5.4-2.1 8-5.1 8-10V9l-8-3Z" stroke="white" strokeWidth="2" /></svg>;
}

function TrustIcon({ type }: { type: "wallet" | "mask" | "shield" | "source" }) {
  if (type === "wallet") return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h13M3 7h16a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V7Zm18 6h-5a2 2 0 0 0 0 4h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="16" cy="15" r=".8" fill="currentColor" /></svg>;
  if (type === "mask") return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 6c6 2 14 2 20 0v7c0 5.5-4.2 8-10 8S2 18.5 2 13V6Zm4 6c.5 1.8 1.7 2.7 3.2 2.7 1.2 0 2-.7 2.8-1.8.8 1.1 1.6 1.8 2.8 1.8 1.5 0 2.7-.9 3.2-2.7-1.5-.7-2.9-.6-4 .3-1.2.9-2.8.9-4 0-1.1-.9-2.5-1-4-.3Z" /></svg>;
  if (type === "shield") return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 9 4v6c0 5.5-3 8.7-9 10-6-1.3-9-4.5-9-10V6l9-4Z" stroke="currentColor" strokeWidth="2" /><path d="m8 12 3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-2c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.4-1 .7-1.3-2.3-.3-4.8-1.2-4.8-5.2 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 2.9 1.1A10 10 0 0 1 12 6.2c.9 0 1.8.1 2.6.3 2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.8c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5Z" /></svg>;
}
