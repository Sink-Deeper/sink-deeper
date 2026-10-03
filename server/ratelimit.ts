/**
 * In-memory fixed-window rate limiter (single process). Keys default to the logged-in user id,
 * falling back to the client IP (Caddy sets X-Forwarded-For; Express trusts one hop). Admins are exempt.
 * Returns 429 with Retry-After.
 */
import type { Request, Response, NextFunction } from "express";
import { HttpError } from "./util.js";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 200_000; // hard cap on memory; beyond this, oldest-expiring entries are evicted
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
}, 60_000).unref();

export type LimitOpts = {
  name: string;
  max: number;
  windowMs: number;
  /** "ip" keys purely by client IP (registration, login); default "actor" is user id, else IP */
  by?: "ip" | "actor";
  message?: string;
};

export function keyFor(req: Request, by: LimitOpts["by"] = "actor"): string {
  if (by === "ip") return `ip:${req.ip ?? "unknown"}`;
  return req.user ? `u:${req.user.id}` : `ip:${req.ip ?? "unknown"}`;
}

function bucket(name: string, key: string, windowMs: number): Bucket {
  const t = Date.now();
  const k = `${name}:${key}`;
  let b = buckets.get(k);
  if (!b || b.resetAt <= t) {
    if (buckets.size >= MAX_BUCKETS) {
      // evict a slice of the oldest entries rather than growing without bound
      let n = 0;
      for (const key of buckets.keys()) { buckets.delete(key); if (++n > 1000) break; }
    }
    b = { count: 0, resetAt: t + windowMs };
    buckets.set(k, b);
  }
  return b;
}

/** Count one event against the bucket. */
export function hit(name: string, key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number; remaining: number } {
  const b = bucket(name, key, windowMs);
  if (b.count >= max) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - Date.now()) / 1000), remaining: 0 };
  b.count++;
  return { ok: true, retryAfterSec: 0, remaining: max - b.count };
}

/** Check the bucket without counting (for "only count failures / successes" flows). */
export function peek(name: string, key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const b = bucket(name, key, windowMs);
  if (b.count >= max) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - Date.now()) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}

export function rateLimit(o: LimitOpts) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.is_admin) return next();
    const r = hit(o.name, keyFor(req, o.by), o.max, o.windowMs);
    res.setHeader("X-RateLimit-Limit", String(o.max));
    res.setHeader("X-RateLimit-Remaining", String(r.remaining));
    if (!r.ok) {
      res.setHeader("Retry-After", String(r.retryAfterSec));
      return next(new HttpError(429, o.message ?? `Too many requests. Try again in ${humanize(r.retryAfterSec)}.`));
    }
    next();
  };
}

export function humanize(sec: number): string {
  if (sec < 90) return `${sec} seconds`;
  if (sec < 5400) return `${Math.ceil(sec / 60)} minutes`;
  return `${Math.ceil(sec / 3600)} hours`;
}

/** The network an address sits in: IPv4 /24 (or /16 when wide), IPv6 /48 (or /32). */
export function networkOf(ip: string | undefined, wide = false): string {
  if (!ip) return "unknown";
  const v4 = ip.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.split(".").slice(0, wide ? 2 : 3).join(".");
  const [h, t] = ip.toLowerCase().split("::");
  const head = h ? h.split(":") : [], tail = t ? t.split(":") : [];
  const groups = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  return groups.slice(0, wide ? 2 : 3).map((g) => g.padStart(4, "0")).join(":");
}
