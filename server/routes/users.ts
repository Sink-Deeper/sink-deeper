import { Router } from "express";
import { db, now } from "../db.js";
import { HttpError, asyncHandler, pageParam } from "../util.js";
import { requireAuth, type User } from "../auth.js";
import { AUDIO_SELECT, PUBLIC_WHERE, listingSql, serializeAudio, serializeUser, type AudioRow } from "../serialize.js";
import { rateLimit } from "../ratelimit.js";
import { config } from "../config.js";

export const usersRouter = Router();

const userByName = db.prepare(
  `SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at, u.is_admin, u.banned,
     (SELECT COUNT(*) FROM audios a WHERE a.user_id = u.id AND a.visibility='public' AND a.status='ready') AS audio_count,
     (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
     (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following
   FROM users u WHERE u.username = ?`,
);

function loadUser(username: string, viewer: User | null = null) {
  const u = userByName.get(username) as (User & { audio_count: number; followers: number; following: number }) | undefined;
  if (!u || (u.banned && !viewer?.is_admin)) throw new HttpError(404, "User not found");
  return u;
}

usersRouter.get(
  "/:username",
  asyncHandler((req, res) => {
    const u = loadUser(req.params.username as string, req.user);
    const isFollowing = req.user
      ? !!db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?").get(req.user.id, u.id)
      : false;
    const totals = db
      .prepare("SELECT COALESCE(SUM(plays),0) plays, COALESCE(SUM(likes_count),0) likes FROM audios WHERE user_id = ? AND visibility='public'")
      .get(u.id) as { plays: number; likes: number };
    res.json({ user: serializeUser(u, req.user, { isFollowing, totalPlays: totals.plays, totalLikes: totals.likes }) });
  }),
);

// A user's audio. Owner (or admin) sees everything incl. private/processing; others see public only.
usersRouter.get(
  "/:username/audios",
  asyncHandler((req, res) => {
    const u = loadUser(req.params.username as string, req.user);
    const isOwner = req.user?.id === u.id || !!req.user?.is_admin;
    const page = pageParam(req.query.page);
    const limit = 24;
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim().toLowerCase().slice(0, 40) : "";
    const sort = req.query.sort === "top" ? "a.plays DESC, a.created_at DESC" : req.query.sort === "liked" ? "a.likes_count DESC, a.created_at DESC" : req.query.sort === "old" ? "a.created_at ASC" : "a.created_at DESC";
    const params: unknown[] = [u.id];
    let where = `a.user_id = ? ${isOwner ? "" : `AND ${PUBLIC_WHERE}`}`;
    if (tag) { where += " AND a.id IN (SELECT at.audio_id FROM audio_tags at JOIN tags t ON t.id = at.tag_id WHERE t.name = ?)"; params.push(tag); }
    const rows = db
      .prepare(listingSql(where, sort))
      .all(...params, limit + 1, (page - 1) * limit) as AudioRow[];
    res.json({ audios: rows.slice(0, limit).map((a) => serializeAudio(a, req.user)), page, hasMore: rows.length > limit });
  }),
);

usersRouter.get(
  "/:username/tags",
  asyncHandler((req, res) => {
    const u = loadUser(req.params.username as string, req.user);
    const isOwner = req.user?.id === u.id || !!req.user?.is_admin;
    const rows = db
      .prepare(
        `SELECT t.name, COUNT(*) AS count FROM tags t
         JOIN audio_tags at ON at.tag_id = t.id
         JOIN audios a ON a.id = at.audio_id
         JOIN users u ON u.id = a.user_id
         WHERE a.user_id = ? ${isOwner ? "" : `AND ${PUBLIC_WHERE}`}
         GROUP BY t.id ORDER BY count DESC, t.name LIMIT 60`,
      )
      .all(u.id);
    res.json({ tags: rows });
  }),
);

// Public likes: only public audio from non-banned creators. Unlisted stays unlisted even if liked.
usersRouter.get(
  "/:username/likes",
  asyncHandler((req, res) => {
    const u = loadUser(req.params.username as string, req.user);
    const page = pageParam(req.query.page);
    const limit = 24;
    const isSelf = req.user?.id === u.id;
    const rows = db
      .prepare(
        `SELECT ${AUDIO_SELECT} JOIN likes l ON l.audio_id = a.id AND l.user_id = ?
         WHERE ${isSelf ? "a.visibility != 'private' AND a.status='ready' AND u.banned = 0" : PUBLIC_WHERE}
         ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(u.id, limit + 1, (page - 1) * limit) as AudioRow[];
    res.json({ audios: rows.slice(0, limit).map((a) => serializeAudio(a, req.user)), page, hasMore: rows.length > limit });
  }),
);

usersRouter.post(
  "/:username/follow",
  requireAuth,
  rateLimit({ name: "writes", max: config.limits.writesPerHour, windowMs: 3_600_000 }),
  asyncHandler((req, res) => {
    const u = loadUser(req.params.username as string, req.user);
    if (u.id === req.user!.id) throw new HttpError(400, "You can't follow yourself");
    const existing = db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?").get(req.user!.id, u.id);
    if (existing) db.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").run(req.user!.id, u.id);
    else db.prepare("INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(req.user!.id, u.id, now());
    const followers = (db.prepare("SELECT COUNT(*) c FROM follows WHERE followee_id = ?").get(u.id) as any).c;
    res.json({ isFollowing: !existing, followers });
  }),
);
