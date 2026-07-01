import type { Request, Response, NextFunction } from "express";

/**
 * Format timing marks into a `Server-Timing` header value.
 * e.g. { db: 4, total: 12.34 } → "db;dur=4.0, total;dur=12.3"
 */
export function formatServerTiming(marks: Record<string, number>): string {
  return Object.entries(marks)
    .map(([name, dur]) => `${name};dur=${dur.toFixed(1)}`)
    .join(", ");
}

/**
 * Express middleware that measures total handler time and emits it as a
 * `Server-Timing` header, visible in the browser Network panel. The header is
 * set from a patched `res.end` so it lands before headers are flushed.
 */
export function serverTiming(_req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);

  res.end = function patchedEnd(this: Response, ...args: unknown[]): Response {
    if (!res.headersSent) {
      const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
      res.setHeader("Server-Timing", formatServerTiming({ total: totalMs }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalEnd as any)(...args);
  } as Response["end"];

  next();
}
