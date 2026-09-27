import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app-page mx-auto max-w-2xl space-y-6">
      <div className="page-hero">
        <p className="page-kicker">Townsquare</p>
        <h1>Page not found</h1>
        <p className="mt-2 text-base text-muted">This link may have changed or the page may no longer be available.</p>
      </div>
      <Link href="/" className="btn-primary">Back to home</Link>
    </div>
  );
}
