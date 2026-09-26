"use client";

export const GROUP_COLORS = ["#1b7a6a", "#c05a1b", "#3c4bb0", "#8a3ea8", "#6b7d12"];

interface Point {
  x: number;
  y: number;
  group: number;
}

// Participants projected on the first two principal components, one convex hull per group.
export function OpinionMap({ points, you }: { points: Point[]; you?: Point | null }) {
  const all = you ? [...points, you] : points;
  if (all.length === 0) {
    return <div className="flex h-64 items-center justify-center rounded-2xl bg-paper text-sm text-muted">The map appears once people have voted.</div>;
  }
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 400;
  const H = 280;
  const pad = 28;
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const sy = (y: number) => pad + ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad);

  const groups = [...new Set(points.map((p) => p.group))];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="max-h-[22rem] w-full rounded-2xl bg-paper" role="img" aria-label="Opinion map">
      {groups.map((g) => {
        const hull = convexHull(points.filter((p) => p.group === g).map((p) => [sx(p.x), sy(p.y)] as [number, number]));
        const color = GROUP_COLORS[g % GROUP_COLORS.length];
        return hull.length >= 3 ? (
          <polygon key={`h${g}`} points={hull.map((p) => p.join(",")).join(" ")} fill={color} fillOpacity={0.1} stroke={color} strokeOpacity={0.4} strokeLinejoin="round" strokeWidth={14} />
        ) : null;
      })}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={5} fill={GROUP_COLORS[p.group % GROUP_COLORS.length]} fillOpacity={0.85} />
      ))}
      {you && (
        <g>
          <circle cx={sx(you.x)} cy={sy(you.y)} r={10} fill="white" stroke="#13201f" strokeWidth={2.5} />
          <text x={sx(you.x)} y={sy(you.y) - 15} textAnchor="middle" fontSize="12" fontWeight="600" fill="#13201f">
            you
          </text>
        </g>
      )}
    </svg>
  );
}

function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
