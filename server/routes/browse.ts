import { Router } from "express";
import { db } from "../db.js";
import { asyncHandler, normalizeTag, pageParam } from "../util.js";
import { ftsQuery } from "../search.js";
import { AUDIO_SELECT, PUBLIC_WHERE, listingSql, serializeAudio, type AudioRow, avatarUrl } from "../serialize.js";
import { rateLimit } from "../ratelimit.js";

export const browseRouter = Router();

const PAGE = 24;
type Sort = "new" | "top" | "liked";

function orderBy(sort: Sort) {
  return sort === "top" ? "a.plays DESC, a.created_at DESC" : sort === "liked" ? "a.likes_count DESC, a.created_at DESC" : "a.created_at DESC";
}
function pageArgs(q: Record<string, unknown>) {
  const page = pageParam(q.page);
  const sort: Sort = q.sort === "top" || q.sort === "liked" ? q.sort : "new";
  return { page, sort, limit: PAGE, offset: (page - 1) * PAGE };
}

// Latest public, ready audio
browseRouter.get(
  "/feed",
  asyncHandler((req, res) => {
    const { page, sort, limit, offset } = pageArgs(req.query);
    const rows = db
      .prepare(listingSql(PUBLIC_WHERE, orderBy(sort)))
      .all(limit + 1, offset) as AudioRow[];
    res.json({ audios: rows.slice(0, limit).map((a) => serializeAudio(a, req.user)), page, hasMore: rows.length > limit });
  }),
);

// Audio from people the viewer follows
browseRouter.get(
  "/following",
  asyncHandler((req, res) => {
    if (!req.user) return res.json({ audios: [], page: 1, hasMore: false });
    const { page, limit, offset } = pageArgs(req.query);
    const rows = db
      .prepare(listingSql(PUBLIC_WHERE, "a.created_at DESC", "JOIN follows f ON f.followee_id = a.user_id AND f.follower_id = ?"))
      .all(req.user.id, limit + 1, offset) as AudioRow[];
    res.json({ audios: rows.slice(0, limit).map((a) => serializeAudio(a, req.user)), page, hasMore: rows.length > limit });
  }),
);

browseRouter.get(
  "/search",
  rateLimit({ name: "search", by: "ip", max: 120, windowMs: 60_000 }),
  asyncHandler((req, res) => {
    const q = String(req.query.q ?? "").trim();
    const tags = String(req.query.tags ?? "").split(",").map(normalizeTag).filter(Boolean).slice(0, 10);
    const { page, sort, limit, offset } = pageArgs(req.query);
    const where: string[] = [PUBLIC_WHERE];
    const params: unknown[] = [];

    const match = q ? ftsQuery(q) : null;
    if (match) {
      where.push("a.rowid IN (SELECT rowid FROM audios_fts WHERE audios_fts MATCH ?)");
      params.push(match);
    }
    for (const t of tags) {
      where.push("a.id IN (SELECT at.audio_id FROM audio_tags at JOIN tags tg ON tg.id = at.tag_id WHERE tg.name = ?)");
      params.push(t);
    }
    const rows = db
      .prepare(listingSql(where.join(" AND "), orderBy(sort)))
      .all(...params, limit + 1, offset) as AudioRow[];

    // Users matching the query (only on first page)
    const users =
      q && page === 1
        ? (db
            .prepare(
              `SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at,
                 (SELECT COUNT(*) FROM audios a WHERE a.user_id = u.id AND a.visibility='public' AND a.status='ready') AS audio_count
               FROM users u WHERE u.banned = 0 AND (u.username LIKE ? OR u.display_name LIKE ?) ORDER BY audio_count DESC LIMIT 5`,
            )
            .all(`%${q}%`, `%${q}%`) as any[]).map((u) => ({
            id: u.id, username: u.username, displayName: u.display_name, avatarUrl: avatarUrl(u.avatar), bio: u.bio, audioCount: u.audio_count,
          }))
        : [];

    res.json({ audios: rows.slice(0, limit).map((a) => serializeAudio(a, req.user)), users, page, hasMore: rows.length > limit, q, tags });
  }),
);

browseRouter.get(
  "/creators",
  asyncHandler((req, res) => {
    const q = String(req.query.q ?? "").trim();
    const sort = req.query.sort === "new" ? "u.created_at DESC" : req.query.sort === "followers" ? "followers DESC, plays DESC" : "plays DESC, audio_count DESC";
    const page = Math.max(1, parseInt(String(req.query.page ?? "1")) || 1);
    const limit = 30;
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.created_at,
           COUNT(a.id) AS audio_count, COALESCE(SUM(a.plays),0) AS plays, COALESCE(SUM(a.likes_count),0) AS likes,
           (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
         FROM users u JOIN audios a ON a.user_id = u.id AND a.visibility='public' AND a.status='ready'
         WHERE u.banned = 0 AND (? = '' OR u.username LIKE ? OR u.display_name LIKE ?)
         GROUP BY u.id ORDER BY ${sort} LIMIT ? OFFSET ?`,
      )
      .all(q, `%${q}%`, `%${q}%`, limit + 1, (page - 1) * limit) as any[];
    res.json({
      creators: rows.slice(0, limit).map((u) => ({
        id: u.id, username: u.username, displayName: u.display_name, avatarUrl: avatarUrl(u.avatar), bio: u.bio, createdAt: u.created_at,
        audioCount: u.audio_count, plays: u.plays, likes: u.likes, followers: u.followers,
      })),
      page, hasMore: rows.length > limit,
    });
  }),
);

// Creators who arrived recently and haven't found an audience yet, for a homepage row. Established creators drop off once
// they pass NEW_CREATOR_MAX_PLAYS, and everyone leaves the row 30 days after their first public upload.
const NEW_CREATOR_DAYS = 30;
const NEW_CREATOR_MAX_PLAYS = 200;
browseRouter.get(
  "/new-creators",
  asyncHandler((_req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar,
           COUNT(a.id) AS audio_count, COALESCE(SUM(a.duration_sec), 0) AS secs, COALESCE(SUM(a.plays), 0) AS total_plays, MIN(a.created_at) AS first_at
         FROM users u JOIN audios a ON a.user_id = u.id AND ${PUBLIC_WHERE}
         WHERE u.is_admin = 0
         GROUP BY u.id
         HAVING first_at > ? AND total_plays < ?
         ORDER BY first_at DESC LIMIT 8`,
      )
      .all(Date.now() - NEW_CREATOR_DAYS * 86_400_000, NEW_CREATOR_MAX_PLAYS) as any[];
    const latest = db.prepare(`SELECT a.slug, a.title FROM audios a JOIN users u ON u.id = a.user_id WHERE a.user_id = ? AND ${PUBLIC_WHERE} ORDER BY (a.duration_sec >= 60) DESC, a.created_at DESC LIMIT 1`); // skip ownership-check clips when a real audio exists
    res.json({
      creators: rows.map((u) => ({
        id: u.id, username: u.username, displayName: u.display_name, avatarUrl: avatarUrl(u.avatar),
        audioCount: u.audio_count, hours: u.secs / 3600, since: u.first_at, latest: latest.get(u.id) ?? null,
      })),
    });
  }),
);

browseRouter.get(
  "/tags",
  asyncHandler((_req, res) => {
    const rows = db
      .prepare(
        `SELECT t.name, COUNT(*) AS count FROM tags t
         JOIN audio_tags at ON at.tag_id = t.id
         JOIN audios a ON a.id = at.audio_id JOIN users u ON u.id = a.user_id AND ${PUBLIC_WHERE}
         GROUP BY t.id ORDER BY count DESC, t.name LIMIT 100`,
      )
      .all();
    res.json({ tags: rows });
  }),
);

browseRouter.get(
  "/stats",
  asyncHandler((_req, res) => {
    const audios = (db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(a.duration_sec),0) d FROM audios a JOIN users u ON u.id = a.user_id WHERE ${PUBLIC_WHERE}`).get() as any);
    const users = (db.prepare("SELECT COUNT(*) c FROM users").get() as any).c;
    res.json({ audios: audios.c, hours: Math.round(audios.d / 3600), users });
  }),
);
