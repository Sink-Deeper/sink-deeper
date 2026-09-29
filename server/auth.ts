import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { db, now } from "./db.js";
import { id, HttpError } from "./util.js";
import { config } from "./config.js";

const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days
const COOKIE = "sid";
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
// Current cost. Hashes record their own N so this can be raised later without breaking old passwords.
const SCRYPT_N = 32768;
const SCRYPT_OPTS = (N: number): crypto.ScryptOptions => ({ N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

export type User = {
  id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  bio: string;
  created_at: number;
  is_admin: number;
  banned: number;
};

declare global {
  namespace Express {
    interface Request {
      user: User | null;
      sessionId: string | null;
    }
  }
}

/** Async (libuv threadpool) so a burst of logins can't stall the event loop. Format: scrypt2$N$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64, SCRYPT_OPTS(SCRYPT_N));
  return `scrypt2$${SCRYPT_N}$${salt}$${hash.toString("hex")}`;
}

/** Accepts both the current format and the original `scrypt$salt$hash` (Node default N=16384). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  let N = 16384, salt: string | undefined, hash: string | undefined;
  if (parts[0] === "scrypt2") { N = Number(parts[1]); salt = parts[2]; hash = parts[3]; }
  else { salt = parts[1]; hash = parts[2]; }
  if (!salt || !hash || !Number.isFinite(N)) return false;
  const candidate = await scrypt(password, salt, 64, SCRYPT_OPTS(N));
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/** True when a stored hash predates the current cost and should be re-hashed on next successful login. */
export const needsRehash = (stored: string) => !stored.startsWith(`scrypt2$${SCRYPT_N}$`);

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const raw = part.slice(i + 1).trim();
    let v = raw;
    try { v = decodeURIComponent(raw); } catch { /* malformed percent-encoding: use as-is */ }
    out[part.slice(0, i).trim()] = v;
  }
  return out;
}

const selectUser = db.prepare(
  `SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at, u.is_admin, u.banned, s.id AS sid
   FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.id = ? AND s.expires_at > ? AND u.banned = 0`,
);

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.user = null;
  req.sessionId = null;
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid && /^[a-z0-9]{32}$/.test(sid)) {
    const row = selectUser.get(sid, now()) as (User & { sid: string }) | undefined;
    if (row) {
      const { sid: _s, ...user } = row;
      req.user = user;
      req.sessionId = sid;
    }
  }
  next();
}

export function createSession(res: Response, userId: string) {
  const sid = id(32);
  const t = now();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    sid,
    userId,
    t,
    t + SESSION_TTL,
  );
  res.cookie(COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    maxAge: SESSION_TTL,
    path: "/",
  });
  return sid;
}

export function destroySession(req: Request, res: Response) {
  if (req.sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(req.sessionId);
  res.clearCookie(COOKIE, { path: "/" });
}

/** Log out every other device, e.g. after a password change. */
export function revokeOtherSessions(userId: string, keepSid: string | null) {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepSid ?? "");
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Login required"));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Login required"));
  if (!req.user.is_admin) return next(new HttpError(403, "Admins only"));
  next();
}

// Purge expired sessions occasionally
setInterval(() => db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now()), 1000 * 60 * 60).unref();
