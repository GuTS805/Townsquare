import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Townsquare · Proof that real people agree",
  description:
    "Anonymous, one-person-one-voice deliberation. Every participant is a verified unique human, nobody can see who they are, and anyone can re-check the result against Ethereum.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d3b37",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh">
        <header className="site-header border-b border-line bg-white/80 backdrop-blur">
          <div className="mx-auto flex min-h-[59px] max-w-[1380px] items-center justify-between gap-5 px-5 py-2 sm:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-display text-lg font-bold text-deep">
              <Logo />
              Townsquare
            </Link>
            <nav className="site-nav flex items-center gap-1 text-[14px] font-medium" aria-label="Main navigation">
              <Link href="/" className="site-nav-home">Home</Link>
              <Link href="/#how-it-works">How it works</Link>
              <Link href="/#verification">Verify</Link>
              <Link href="/#explore">Explore</Link>
            </nav>
            <Link href="/new" className="site-header-action">Start a conversation <span aria-hidden="true">→</span></Link>
          </div>
        </header>
        <main className="site-main mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-muted">
          Open source (MIT). Built on Semaphore, Anon Aadhaar and the Pocket Polis math.
        </footer>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#0d3b37" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#5fb8a6" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="3.2" fill="#fff" />
      <circle cx="9.5" cy="10" r="2" fill="#5fcfb4" />
      <circle cx="23.5" cy="13" r="2" fill="#f2a45c" />
      <circle cx="15" cy="24.5" r="2" fill="#9aa6ff" />
    </svg>
  );
}
