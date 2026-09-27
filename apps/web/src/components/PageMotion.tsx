"use client";

import { usePathname } from "next/navigation";

export function PageMotion({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="route-content">{children}</div>;
}
