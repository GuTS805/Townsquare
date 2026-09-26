import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { TsError } from "@townsquare/core";

// In-memory token buckets. Keys are a salted hash of the connection address, and the
// salt rotates every hour, so nothing here can be turned back into an IP later.
let salt = randomBytes(16);
setInterval(() => (salt = randomBytes(16)), 60 * 60 * 1000).unref();

const buckets = new Map<string, { tokens: number; at: number }>();
setInterval(() => buckets.clear(), 10 * 60 * 1000).unref();

const MULTIPLIER = Number(process.env.RATE_LIMIT_MULTIPLIER ?? "1") || 1;

// Keys default to the (hashed) connection. A whole class often shares one campus IP,
// so connection-keyed limits are generous and per-participant limits use the pid.
export function rateLimit(name: string, perMinute: number, burst = perMinute, keyOf?: (req: Request) => string | undefined) {
  const rate = perMinute * MULTIPLIER;
  const cap = burst * MULTIPLIER;
  return (req: Request, _res: Response, next: NextFunction) => {
    const custom = keyOf?.(req);
    const who = custom ?? createHash("sha256").update(salt).update(req.socket.remoteAddress ?? "").digest("hex").slice(0, 24);
    const key = `${name}:${who}`;
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: cap, at: now };
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) / 60_000) * rate);
    b.at = now;
    if (b.tokens < 1) return next(new TsError("RATE_LIMITED", "slow down"));
    b.tokens -= 1;
    buckets.set(key, b);
    next();
  };
}
