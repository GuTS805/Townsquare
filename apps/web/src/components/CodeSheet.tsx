"use client";

import { QRCodeSVG } from "qrcode.react";

// Codes travel in the URL fragment (#code=…), which browsers never send to any server.
export function CodeSheet({ slug, title, codes }: { slug: string; title: string; codes: string[] }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = (code: string) => `${origin}/c/${slug}#code=${code}`;

  function downloadCsv() {
    const blob = new Blob([["code,link", ...codes.map((c) => `${c},${link(c)}`)].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}-invite-codes.csv`;
    a.click();
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h2 className="text-lg font-semibold">{codes.length} invite codes</h2>
          <p className="text-sm text-muted">Shown once. Print them or download the list; Townsquare only keeps their hashes.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={downloadCsv}>
            Download CSV
          </button>
          <button className="btn-primary" onClick={() => window.print()}>
            Print slips
          </button>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        {codes.map((c) => (
          <div key={c} className="flex flex-col items-center rounded-xl border border-dashed border-line p-3 text-center break-inside-avoid">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</span>
            <QRCodeSVG value={link(c)} size={96} className="my-2" />
            <span className="font-mono text-sm font-semibold tracking-wider">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
