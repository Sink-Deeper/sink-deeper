import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { db, now } from "../db.js";
import { id, HttpError, asyncHandler } from "../util.js";
import { createSession, destroySession, hashPassword, verifyPassword, needsRehash, requireAuth, revokeOtherSessions } from "../auth.js";
import { serializeUser } from "../serialize.js";
import { rateLimit, hit, peek, keyFor, humanize } from "../ratelimit.js";
import { config, paths } from "../config.js";
import { AVATAR_EXT, AVATAR_MAX_BYTES, storeAvatar, removeAvatar } from "../avatar.js";
import { deleteAccount } from "../account.js";
import { recordAction } from "../accountability.js";

const USER_COLS = "id, username, display_name, avatar, bio, created_at, is_admin, banned";
const REG_WINDOW = 86_400_000;
const LOGIN_WINDOW = 15 * 60_000;

export const authRouter = Router();

const credentials = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscores only"),
  password: z.string().min(8).max(200),
});

// Registration: only *successful* signups count against the per-IP daily limit, so a typo or a taken
// username can't lock a legitimate person out for a day.
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const k = keyFor(req, "ip");
    const p = peek("register", k, config.limits.registrationsPerIpPerDay, REG_WINDOW);
    if (!p.ok) { res.setHeader("Retry-After", String(p.retryAfterSec)); throw new HttpError(429, "Too many accounts created from this network today. Try again tomorrow."); }
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    const { username, password } = parsed.data;
    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) throw new HttpError(409, "That username is taken");
    const uid = id();
    const hash = await hashPassword(password);
    try {
      db.prepare("INSERT INTO users (id, username, password_hash, display_name, bio, created_at) VALUES (?, ?, ?, ?, '', ?)").run(uid, username, hash, username, now());
    } catch (e: any) {
      if (String(e?.code).includes("CONSTRAINT")) throw new HttpError(409, "That username is taken");
      throw e;
    }
    hit("register", k, config.limits.registrationsPerIpPerDay, REG_WINDOW);
    createSession(res, uid);
    recordAction(req, uid, "register");
    const user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(uid) as any;
    res.status(201).json({ user: serializeUser(user, user) });
  }),
);

// Login: per-IP limit on attempts plus a per-account limit on *failed* attempts, so credential
// stuffing spread across many IPs is still throttled per target account.
authRouter.post(
  "/login",
  rateLimit({ name: "login", by: "ip", max: config.limits.loginAttemptsPer15Min, windowMs: LOGIN_WINDOW, message: "Too many login attempts. Wait 15 minutes." }),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ username: z.string().trim().max(24), password: z.string().max(200) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid input");
    const acctKey = `acct:${parsed.data.username.toLowerCase()}`;
    const acct = peek("login-account", acctKey, config.limits.loginFailuresPerAccountPer15Min, LOGIN_WINDOW);
    if (!acct.ok) { res.setHeader("Retry-After", String(acct.retryAfterSec)); throw new HttpError(429, `Too many failed logins for this account. Try again in ${humanize(acct.retryAfterSec)}.`); }
    const row = db.prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = ?`).get(parsed.data.username) as any;
    // Always run a hash comparison so unknown usernames take as long as wrong passwords
    const ok = row ? await verifyPassword(parsed.data.password, row.password_hash) : (await verifyPassword(parsed.data.password, "scrypt$00$00"), false);
    if (!ok) {
      hit("login-account", acctKey, config.limits.loginFailuresPerAccountPer15Min, LOGIN_WINDOW);
      throw new HttpError(401, "Wrong username or password");
    }
    if (row.banned) throw new HttpError(403, "This account has been suspended");
    if (needsRehash(row.password_hash)) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(parsed.data.password), row.id);
    }
    createSession(res, row.id);
    const { password_hash: _p, ...user } = row;
    res.json({ user: serializeUser(user, user) });
  }),
);

authRouter.post("/logout", (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

// Failed uploads are cleaned up (file removed, size zeroed) but still count toward the daily number,
// so repeatedly uploading junk can't be used to bypass the cap.
const usage = db.prepare(
  `SELECT COALESCE(SUM(size_bytes),0) AS used,
          SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS today
   FROM audios WHERE user_id = ?`,
);
export function quotaFor(userId: string) {
  const r = usage.get(Date.now() - 86_400_000, userId) as { used: number; today: number };
  return {
    usedBytes: r.used, quotaBytes: config.limits.userQuotaBytes,
    uploadsToday: r.today ?? 0, uploadsPerDay: config.limits.uploadsPerDay,
    maxUploadBytes: config.maxUploadBytes,
  };
}

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ? serializeUser(req.user, req.user) : null, quota: req.user ? quotaFor(req.user.id) : null, features: config.features });
});

authRouter.patch(
  "/me",
  requireAuth,
  rateLimit({ name: "writes", max: config.limits.writesPerHour, windowMs: 3_600_000 }),
  asyncHandler((req, res) => {
    const parsed = z
      .object({ displayName: z.string().trim().min(1).max(40).optional(), bio: z.string().max(2000).optional() })
      .safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid input");
    const { displayName, bio } = parsed.data;
    db.prepare("UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio) WHERE id = ?").run(
      displayName ?? null,
      bio ?? null,
      req.user!.id,
    );
    const user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user!.id) as any;
    res.json({ user: serializeUser(user, user) });
  }),
);

// Profile photo. Any common image in; a square WebP we encoded ourselves out.
const avatarUpload = multer({
  storage: multer.diskStorage({ destination: paths.uploads, filename: (_req, file, cb) => cb(null, `avatar-in-${id(12)}${path.extname(file.originalname).toLowerCase()}`) }),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 2, parts: 4, fieldSize: 1024 },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_EXT.has(path.extname(file.originalname).toLowerCase())) return cb(new HttpError(400, "Use a JPG, PNG, WebP or GIF image"));
    cb(null, true);
  },
});
authRouter.post(
  "/me/avatar",
  requireAuth,
  rateLimit({ name: "avatar", max: 20, windowMs: 3_600_000 }),
  avatarUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No image uploaded");
    let stored: string;
    try { stored = await storeAvatar(req.file.path, req.user!.id); }
    catch (e) { fs.rmSync(req.file.path, { force: true }); throw new HttpError(400, e instanceof Error ? e.message : "Couldn't process that image"); }
    const prev = (db.prepare("SELECT avatar FROM users WHERE id = ?").get(req.user!.id) as { avatar: string | null }).avatar;
    db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(stored, req.user!.id);
    recordAction(req, req.user!.id, "avatar");
    void removeAvatar(prev);
    const user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user!.id) as any;
    res.json({ user: serializeUser(user, user) });
  }),
);
authRouter.delete(
  "/me/avatar",
  requireAuth,
  rateLimit({ name: "writes", max: config.limits.writesPerHour, windowMs: 3_600_000 }),
  asyncHandler(async (req, res) => {
    const prev = (db.prepare("SELECT avatar FROM users WHERE id = ?").get(req.user!.id) as { avatar: string | null }).avatar;
    db.prepare("UPDATE users SET avatar = NULL WHERE id = ?").run(req.user!.id);
    await removeAvatar(prev);
    const user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user!.id) as any;
    res.json({ user: serializeUser(user, user) });
  }),
);

// Deleting your own account: password plus typing the username, so a stolen session alone can't wipe someone's work.
authRouter.post(
  "/me/delete",
  requireAuth,
  rateLimit({ name: "delete-account", max: 5, windowMs: LOGIN_WINDOW, message: "Too many attempts. Wait 15 minutes." }),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ password: z.string().max(200), confirm: z.string().max(60) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid input");
    if (req.user!.is_admin) throw new HttpError(403, "Admin accounts can't be deleted here");
    const row = db.prepare("SELECT password_hash, username FROM users WHERE id = ?").get(req.user!.id) as { password_hash: string; username: string };
    if (!(await verifyPassword(parsed.data.password, row.password_hash))) throw new HttpError(401, "Password is wrong");
    if (parsed.data.confirm.trim().toLowerCase() !== row.username.toLowerCase()) throw new HttpError(400, "Type your username exactly as it appears to confirm");
    const { audios } = await deleteAccount(req.user!.id);
    destroySession(req, res);
    res.json({ ok: true, audios });
  }),
);

// Password change: tightly limited (it's a hash per call and a brute-force surface for a stolen
// cookie), and it logs out every other session.
authRouter.post(
  "/password",
  requireAuth,
  rateLimit({ name: "pw-change", max: 5, windowMs: LOGIN_WINDOW, message: "Too many password attempts. Wait 15 minutes." }),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ current: z.string().max(200), next: z.string().min(8).max(200) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "New password must be at least 8 characters");
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id) as any;
    if (!(await verifyPassword(parsed.data.current, row.password_hash))) throw new HttpError(401, "Current password is wrong");
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(parsed.data.next), req.user!.id);
    revokeOtherSessions(req.user!.id, req.sessionId);
    res.json({ ok: true });
  }),
);
