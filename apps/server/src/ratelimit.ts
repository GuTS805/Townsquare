import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { TsError } from "@townsquare/core";

// In-memory token buckets. Keys are a salted hash of the connection address, and the
// salt rotates every hour, so nothing here can be turned back into an IP later.
let salt = randomBytes(16);
setInterval(() => (salt = randomBytes(16)), 60 * 60 * 1000).unref();

const buckets = new Map<string, { tokens: number; at: number }>();
setInterval(() => buckets.clear(), 10 * 60 * 1000).unref();

export function rateLimit(name: string, perMinute: number, burst = perMinute) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const who = createHash("sha256").update(salt).update(req.socket.remoteAddress ?? "").digest("hex").slice(0, 24);
    const key = `${name}:${who}`;
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60_000) * perMinute);
    b.at = now;
    if (b.tokens < 1) return next(new TsError("RATE_LIMITED", "slow down"));
    b.tokens -= 1;
    buckets.set(key, b);
    next();
  };
}
