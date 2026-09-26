import pino from "pino";

export type Logger = pino.Logger;

// No IP logging anywhere: request logs never include remote address or forwarding headers.
export function createLogger(level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    level,
    redact: {
      paths: ["ip", "req.ip", "req.remoteAddress", "req.headers['x-forwarded-for']", "req.headers['x-real-ip']", "*.code", "code"],
      censor: "[redacted]",
    },
  });
}
