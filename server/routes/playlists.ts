import { Router } from "express";
import { z } from "zod";
import { db, now } from "../db.js";
import { id, slugify, HttpError, asyncHandler } from "../util.js";
import { requireAuth, type User } from "../auth.js";
import { AUDIO_SELECT, serializeAudio, canView, type AudioRow, avatarUrl } from "../serialize.js";
import { rateLimit } from "../ratelimit.js";
import { config } from "../config.js";

const writeLimit = rateLimit({ name: "writes", max: config.limits.writesPerHour, windowMs: 3_600_000 });

export const playlistsRouter = Router();

type PlaylistRow = {
  id: string; user_id: string; slug: string; title: string; description: string; is_public: number; created_at: number;
  username: string; display_name: string; banned: number; item_count: number; user_avatar: string | null;
};
const PL_SELECT = `p.*, u.username, u.display_name, u.banned, u.avatar AS user_avatar, (SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id) AS item_count
  FROM playlists p JOIN users u ON u.id = p.user_id`;

function serialize(p: PlaylistRow, viewer: User | null) {
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description, isPublic: !!p.is_public,
    createdAt: p.created_at, itemCount: p.item_count,
    user: { id: p.user_id, username: p.username, displayName: p.display_name, avatarUrl: avatarUrl(p.user_avatar) },
    isOwner: viewer?.id === p.user_id || !!viewer?.is_admin,
  };
}
/** Visible if public and the owner isn't banned, or if the viewer is the owner or an admin. */
function load(idOrSlug: string, username: string | undefined, viewer: User | null): PlaylistRow {
  const p = (username
    ? db.prepare(`SELECT ${PL_SELECT} WHERE u.username = ? AND p.slug = ?`).get(username, idOrSlug)
    : db.prepare(`SELECT ${PL_SELECT} WHERE p.id = ?`).get(idOrSlug)) as PlaylistRow | undefined;
  const privileged = !!viewer && (viewer.id === p?.user_id || !!viewer.is_admin);
  if (!p || (!privileged && (!p.is_public || p.banned))) throw new HttpError(404, "Playlist not found");
  return p;
}
function mustOwn(p: PlaylistRow, viewer: User) {
  if (p.user_id !== viewer.id && !viewer.is_admin) throw new HttpError(403, "Not yours");
}

const schema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional().default(""),
  isPublic: z.boolean().optional().default(true),
});

playlistsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler((req, res) => {
    const rows = db.prepare(`SELECT ${PL_SELECT} WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(req.user!.id) as PlaylistRow[];
    const audioId = typeof req.query.audio === "string" ? req.query.audio.slice(0, 40) : null;
    const contains = audioId
      ? new Set((db.prepare("SELECT playlist_id FROM playlist_items WHERE audio_id = ?").all(audioId) as any[]).map((r) => r.playlist_id))
      : null;
    res.json({ playlists: rows.map((p) => ({ ...serialize(p, req.user), contains: contains ? contains.has(p.id) : undefined })) });
  }),
);

playlistsRouter.get(
  "/user/:username",
  asyncHandler((req, res) => {
    const rows = db
      .prepare(`SELECT ${PL_SELECT} WHERE u.username = ? ORDER BY p.created_at DESC`)
      .all(req.params.username) as PlaylistRow[];
    const visible = rows.filter((p) => {
      const privileged = !!req.user && (req.user.id === p.user_id || !!req.user.is_admin);
      return privileged || (p.is_public && !p.banned);
    });
    res.json({ playlists: visible.map((p) => serialize(p, req.user)) });
  }),
);

playlistsRouter.post(
  "/",
  requireAuth,
  writeLimit,
  asyncHandler((req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Title required");
    const { c } = db.prepare("SELECT COUNT(*) c FROM playlists WHERE user_id = ?").get(req.user!.id) as { c: number };
    if (c >= config.limits.playlistsPerUser && !req.user!.is_admin) throw new HttpError(429, `Playlist limit reached (${config.limits.playlistsPerUser}).`);
    const pid = id();
    const base = slugify(parsed.data.title, "playlist");
    let slug = base;
    while (db.prepare("SELECT 1 FROM playlists WHERE user_id = ? AND slug = ?").get(req.user!.id, slug)) slug = `${base}-${id(4)}`;
    db.prepare("INSERT INTO playlists (id, user_id, slug, title, description, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      pid, req.user!.id, slug, parsed.data.title, parsed.data.description, parsed.data.isPublic ? 1 : 0, now(),
    );
    res.status(201).json({ playlist: serialize(load(pid, undefined, req.user), req.user) });
  }),
);

// Items the viewer can't see (private, still processing, creator banned, or deleted) are hidden from
// listeners; the owner gets a count and can prune them.
playlistsRouter.get(
  "/by/:username/:slug",
  asyncHandler((req, res) => {
    const p = load(req.params.slug as string, req.params.username as string, req.user);
    const rows = db
      .prepare(`SELECT ${AUDIO_SELECT} JOIN playlist_items pi ON pi.audio_id = a.id WHERE pi.playlist_id = ? ORDER BY pi.position ASC`)
      .all(p.id) as AudioRow[];
    const visible = rows.filter((a) => canView(a, req.user) && a.status === "ready");
    const isOwner = !!req.user && (req.user.id === p.user_id || !!req.user.is_admin);
    res.json({
      playlist: serialize(p, req.user),
      audios: visible.map((a) => serializeAudio(a, req.user)),
      unavailable: isOwner ? p.item_count - visible.length : 0,
    });
  }),
);

playlistsRouter.patch(
  "/:id",
  requireAuth,
  writeLimit,
  asyncHandler((req, res) => {
    const p = load(req.params.id as string, undefined, req.user);
    mustOwn(p, req.user!);
    const parsed = schema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid input");
    const d = parsed.data;
    db.prepare("UPDATE playlists SET title=?, description=?, is_public=? WHERE id=?").run(
      d.title ?? p.title, d.description ?? p.description, d.isPublic === undefined ? p.is_public : d.isPublic ? 1 : 0, p.id,
    );
    res.json({ playlist: serialize(load(p.id, undefined, req.user), req.user) });
  }),
);

playlistsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler((req, res) => {
    const p = load(req.params.id as string, undefined, req.user);
    mustOwn(p, req.user!);
    db.prepare("DELETE FROM playlists WHERE id = ?").run(p.id);
    res.json({ ok: true });
  }),
);

// Toggle an audio in a playlist. Removal never requires the audio to still be visible.
playlistsRouter.post(
  "/:id/items",
  requireAuth,
  writeLimit,
  asyncHandler((req, res) => {
    const p = load(req.params.id as string, undefined, req.user);
    mustOwn(p, req.user!);
    const parsed = z.object({ audioId: z.string().max(40) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "audioId required");
    const existing = db.prepare("SELECT 1 FROM playlist_items WHERE playlist_id = ? AND audio_id = ?").get(p.id, parsed.data.audioId);
    if (existing) {
      db.prepare("DELETE FROM playlist_items WHERE playlist_id = ? AND audio_id = ?").run(p.id, parsed.data.audioId);
      return res.json({ contains: false });
    }
    const a = db.prepare(`SELECT ${AUDIO_SELECT} WHERE a.id = ?`).get(parsed.data.audioId) as AudioRow | undefined;
    if (!a || !canView(a, req.user)) throw new HttpError(404, "Audio not found");
    const { n } = db.prepare("SELECT COUNT(*) n FROM playlist_items WHERE playlist_id = ?").get(p.id) as { n: number };
    if (n >= config.limits.playlistItems) throw new HttpError(429, `A playlist can hold at most ${config.limits.playlistItems} audios.`);
    const { m } = db.prepare("SELECT COALESCE(MAX(position), 0) m FROM playlist_items WHERE playlist_id = ?").get(p.id) as { m: number };
    db.prepare("INSERT INTO playlist_items (playlist_id, audio_id, position, added_at) VALUES (?, ?, ?, ?)").run(p.id, parsed.data.audioId, m + 1, now());
    res.json({ contains: true });
  }),
);

// Remove every item the owner can no longer see (deleted, private, failed, banned creator)
playlistsRouter.post(
  "/:id/prune",
  requireAuth,
  writeLimit,
  asyncHandler((req, res) => {
    const p = load(req.params.id as string, undefined, req.user);
    mustOwn(p, req.user!);
    const rows = db
      .prepare(`SELECT ${AUDIO_SELECT} JOIN playlist_items pi ON pi.audio_id = a.id WHERE pi.playlist_id = ?`)
      .all(p.id) as AudioRow[];
    const keep = new Set(rows.filter((a) => canView(a, req.user) && a.status === "ready").map((a) => a.id));
    const r = db.prepare(`DELETE FROM playlist_items WHERE playlist_id = ? AND audio_id NOT IN (${[...keep].map(() => "?").join(",") || "''"})`).run(p.id, ...keep);
    res.json({ removed: r.changes });
  }),
);

playlistsRouter.put(
  "/:id/order",
  requireAuth,
  writeLimit,
  asyncHandler((req, res) => {
    const p = load(req.params.id as string, undefined, req.user);
    mustOwn(p, req.user!);
    const parsed = z.object({ order: z.array(z.string().max(40)).max(config.limits.playlistItems) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "order required");
    const upd = db.prepare("UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND audio_id = ?");
    db.transaction(() => parsed.data.order.forEach((aid, i) => upd.run(i + 1, p.id, aid)))();
    res.json({ ok: true });
  }),
);
