import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { db, now } from "../db.js";
import { config, paths } from "../config.js";
import { id, slugify, parseTags, extractTags, stripTags, HttpError, asyncHandler, fmtBytes, RESERVED_SLUGS } from "../util.js";
import { requireAuth } from "../auth.js";
import { enqueueProcessing } from "../media.js";
import { indexAudio, unindexAudio } from "../search.js";
import { AUDIO_SELECT, serializeAudio, canView, type AudioRow, avatarUrl } from "../serialize.js";
import { isBunnyPath, bunnyKey, signedCdnUrl, getObject, deleteObject } from "../storage.js";
import { Readable } from "node:stream";
import { rateLimit, hit, keyFor, humanize } from "../ratelimit.js";
import { quotaFor } from "./auth.js";
import { fingerprint } from "../fingerprint.js";
import { recordAction } from "../accountability.js";
import { storageDown } from "../health.js";
import { linkVersions, detachVersion, makeMainVersion, setVersionLabel, versionsView } from "../versions.js";

export const audiosRouter = Router();

const ALLOWED_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif", ".mp4", ".webm", ".mka"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: paths.uploads,
    filename: (_req, file, cb) => cb(null, `${id(16)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  // Text parts are buffered in memory by multer, so bound them too (description max is 10k chars)
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 64 * 1024, fieldNameSize: 50, parts: 12, headerPairs: 100 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, `Unsupported file type ${ext || "(none)"}`));
    cb(null, true);
  },
});

const metaSchema = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().max(10000).optional().default(""),
  visibility: z.enum(["public", "unlisted", "private"]).optional().default("public"),
  tags: z.any().optional(),
  downloadable: z.preprocess((v) => (v === undefined ? undefined : v === true || v === "true" || v === "1" || v === 1), z.boolean().optional()),
});

const getById = db.prepare(`SELECT ${AUDIO_SELECT} WHERE a.id = ?`);
const getBySlug = db.prepare(`SELECT ${AUDIO_SELECT} WHERE u.username = ? AND a.slug = ?`);

function loadAudio(idOrSlug: string, username?: string): AudioRow {
  const row = (username ? getBySlug.get(username, idOrSlug) : getById.get(idOrSlug)) as AudioRow | undefined;
  if (!row) throw new HttpError(404, "Audio not found");
  return row;
}

function uniqueSlug(userId: string, title: string, excludeId?: string): string {
  const base = slugify(title);
  const taken = db.prepare("SELECT 1 FROM audios WHERE user_id = ? AND slug = ? AND id != ?");
  let slug = RESERVED_SLUGS.has(base) ? `${base}-${id(4)}` : base;
  while (taken.get(userId, slug, excludeId ?? "")) slug = `${base}-${id(4)}`;
  return slug;
}

const setTags = db.transaction((audioId: string, tags: string[]) => {
  db.prepare("DELETE FROM audio_tags WHERE audio_id = ?").run(audioId);
  const insTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
  const getTag = db.prepare("SELECT id FROM tags WHERE name = ?");
  const link = db.prepare("INSERT OR IGNORE INTO audio_tags (audio_id, tag_id) VALUES (?, ?)");
  for (const t of tags) {
    insTag.run(t);
    const { id: tagId } = getTag.get(t) as { id: number };
    link.run(audioId, tagId);
  }
});

// ---- Create ---------------------------------------------------------------
const writeLimit = rateLimit({ name: "writes", max: config.limits.writesPerHour, windowMs: 3_600_000 });

const storageUp = (_req: unknown, _res: unknown, next: (e?: unknown) => void) =>
  next(storageDown() ? new HttpError(503, "Uploads are paused: our file storage is having problems. Nothing is lost, please try again in a few minutes.") : undefined);

audiosRouter.post(
  "/",
  requireAuth,
  storageUp,
  rateLimit({ name: "upload-burst", max: config.limits.uploadBurstPer10Min, windowMs: 10 * 60_000, message: "You're uploading very quickly. Wait a few minutes." }),
  (req, _res, next) => {
    // Daily count + storage quota, checked before we accept the body
    if (req.user!.is_admin) return next();
    const q = quotaFor(req.user!.id);
    if (q.uploadsToday >= q.uploadsPerDay) return next(new HttpError(429, `Daily upload limit reached (${q.uploadsPerDay} per day).`));
    const declared = Number(req.headers["content-length"] ?? 0);
    if (q.usedBytes + declared > q.quotaBytes) return next(new HttpError(413, `Storage quota exceeded: ${fmtBytes(q.usedBytes)} of ${fmtBytes(q.quotaBytes)} used. Delete something first.`));
    next();
  },
  (req, res, next) =>
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // Multer already discarded the partial file on LIMIT_FILE_SIZE; other limits abort before writing
        if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, `File too large (max ${config.maxUploadBytes / 1024 / 1024} MB)`));
        return next(new HttpError(400, "Upload request is malformed or too large"));
      }
      next(err);
    }),
  asyncHandler((req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const parsed = metaSchema.safeParse(req.body);
    if (!parsed.success) {
      fs.rmSync(req.file.path, { force: true });
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (!req.user!.is_admin) {
      const q = quotaFor(req.user!.id);
      if (q.usedBytes + req.file.size > q.quotaBytes) {
        fs.rmSync(req.file.path, { force: true });
        throw new HttpError(413, `Storage quota exceeded: ${fmtBytes(q.usedBytes)} of ${fmtBytes(q.quotaBytes)} used.`);
      }
    }
    const { description, visibility } = parsed.data;
    const downloadable = parsed.data.downloadable ?? true;
    // "[F4M] Title [tags]" habits from Soundgasm: bracketed parts become tags and leave the title
    const title = (stripTags(parsed.data.title) || parsed.data.title).slice(0, 140);
    const tags = parseTags([...parseTags(parsed.data.tags), ...extractTags(parsed.data.title)]);
    const audioId = id();
    const t = now();
    db.prepare(
      `INSERT INTO audios (id, user_id, slug, title, description, visibility, downloadable, status, original_filename, original_path, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`,
    ).run(audioId, req.user!.id, uniqueSlug(req.user!.id, title), title, description, visibility, downloadable ? 1 : 0, req.file.originalname, req.file.path, req.file.size, t, t);
    setTags(audioId, tags);
    enqueueProcessing(audioId);
    recordAction(req, req.user!.id, "upload");
    res.status(201).json({ audio: serializeAudio(loadAudio(audioId), req.user) });
  }),
);

// ---- Read -----------------------------------------------------------------
audiosRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    if (!canView(a, req.user)) throw new HttpError(404, "Audio not found");
    res.json({ audio: serializeAudio(a, req.user, { peaks: true }) });
  }),
);

audiosRouter.get(
  "/by/:username/:slug",
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.slug as string, req.params.username as string);
    if (!canView(a, req.user)) throw new HttpError(404, "Audio not found");
    res.json({ audio: serializeAudio(a, req.user, { peaks: true }) });
  }),
);

// ---- Update / delete ------------------------------------------------------
// Editing keeps the slug, so links people have already shared stay valid.
audiosRouter.patch(
  "/:id",
  requireAuth,
  writeLimit,
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    if (a.user_id !== req.user!.id && !req.user!.is_admin) throw new HttpError(403, "Not yours");
    const parsed = metaSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
    const d = parsed.data;
    const titleTags = d.title !== undefined ? extractTags(d.title) : [];
    const title = d.title !== undefined ? (stripTags(d.title) || d.title).slice(0, 140) : a.title;
    db.prepare("UPDATE audios SET title=?, description=?, visibility=?, downloadable=?, updated_at=? WHERE id=?").run(
      title, d.description ?? a.description, d.visibility ?? a.visibility, (d.downloadable ?? !!a.downloadable) ? 1 : 0, now(), a.id,
    );
    if (d.tags !== undefined || titleTags.length) {
      const current = d.tags !== undefined ? parseTags(d.tags) : (db.prepare("SELECT t.name FROM tags t JOIN audio_tags at ON at.tag_id = t.id WHERE at.audio_id = ?").all(a.id) as { name: string }[]).map((r) => r.name);
      setTags(a.id, parseTags([...current, ...titleTags]));
    }
    indexAudio(a.id);
    res.json({ audio: serializeAudio(loadAudio(a.id), req.user, { peaks: true }) });
  }),
);

/** Remove stored media for a row that's already gone from the DB. Retries Bunny once; logs anything left behind. */
export async function removeStoredFiles(a: Pick<AudioRow, "id" | "stream_path" | "original_path">) {
  for (const p of [a.stream_path, a.original_path]) {
    if (!p) continue;
    if (isBunnyPath(p)) {
      const key = bunnyKey(p);
      try { await deleteObject(key); }
      catch { try { await deleteObject(key); } catch (e) { console.error(`[storage] ORPHAN bunny object ${key} for audio ${a.id}:`, e); } }
    } else {
      fs.rmSync(p, { force: true });
    }
  }
}

audiosRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = loadAudio(req.params.id as string);
    if (a.user_id !== req.user!.id && !req.user!.is_admin) throw new HttpError(403, "Not yours");
    db.transaction(() => {
      const { rowid } = db.prepare("SELECT rowid FROM audios WHERE id = ?").get(a.id) as { rowid: number };
      detachVersion(a.id); // promote another main version / dissolve a group of one
      unindexAudio(rowid);
      db.prepare("DELETE FROM audios WHERE id = ?").run(a.id);
    })();
    // If it was still processing, media.ts notices the missing row and cleans up its own files.
    await removeStoredFiles(a);
    res.json({ ok: true });
  }),
);

// ---- Versions (unreleased: off unless FEATURE_VERSIONS=1) ------------------------------------------------------
const versionsOn = (_req: any, _res: any, next: any) => (config.features.versions ? next() : next(new HttpError(404, "Not found")));
function ownAudio(req: any) {
  const a = loadAudio(req.params.id as string);
  if (a.user_id !== req.user!.id && !req.user!.is_admin) throw new HttpError(403, "Not yours");
  return a;
}
audiosRouter.get("/:id/versions", versionsOn, requireAuth, asyncHandler((req, res) => {
  const a = ownAudio(req);
  res.json(versionsView(a.id, String(req.query.q ?? "").slice(0, 80)));
}));
audiosRouter.post("/:id/versions", versionsOn, requireAuth, writeLimit, asyncHandler((req, res) => {
  const a = ownAudio(req);
  const other = z.object({ with: z.string().min(1).max(40) }).safeParse(req.body);
  if (!other.success) throw new HttpError(400, "Pick an audio to link");
  linkVersions(a.id, other.data.with);
  res.json(versionsView(a.id));
}));
audiosRouter.post("/:id/versions/main", versionsOn, requireAuth, writeLimit, asyncHandler((req, res) => {
  const a = ownAudio(req);
  makeMainVersion(a.id);
  res.json(versionsView(a.id));
}));
audiosRouter.patch("/:id/versions/label", versionsOn, requireAuth, writeLimit, asyncHandler((req, res) => {
  const a = ownAudio(req);
  const b = z.object({ label: z.string().max(40) }).safeParse(req.body);
  if (!b.success) throw new HttpError(400, "Label too long");
  setVersionLabel(a.id, b.data.label);
  res.json({ ok: true });
}));
audiosRouter.delete("/:id/versions", versionsOn, requireAuth, writeLimit, asyncHandler((req, res) => {
  const a = ownAudio(req);
  detachVersion(a.id);
  res.json({ ok: true }); // the page refreshes its own view afterwards
}));

// ---- Likes ----------------------------------------------------------------
const toggleLike = db.transaction((userId: string, audioId: string) => {
  const existing = db.prepare("SELECT 1 FROM likes WHERE user_id = ? AND audio_id = ?").get(userId, audioId);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE user_id = ? AND audio_id = ?").run(userId, audioId);
    db.prepare("UPDATE audios SET likes_count = MAX(0, likes_count - 1) WHERE id = ?").run(audioId);
    return false;
  }
  db.prepare("INSERT INTO likes (user_id, audio_id, created_at) VALUES (?, ?, ?)").run(userId, audioId, now());
  db.prepare("UPDATE audios SET likes_count = likes_count + 1 WHERE id = ?").run(audioId);
  return true;
});

audiosRouter.post(
  "/:id/like",
  requireAuth,
  writeLimit,
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    if (!canView(a, req.user)) throw new HttpError(404, "Audio not found");
    const liked = toggleLike(req.user!.id, a.id);
    const { likes_count } = db.prepare("SELECT likes_count FROM audios WHERE id = ?").get(a.id) as { likes_count: number };
    res.json({ liked, likes: likes_count });
  }),
);

// ---- Plays (deduped per fingerprint per day) ------------------------------
audiosRouter.post(
  "/:id/play",
  rateLimit({ name: "plays", max: 600, windowMs: 3_600_000 }),
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    if (!canView(a, req.user)) throw new HttpError(404, "Audio not found");
    // Admin activity never shows up in creators' stats (same as admin downloads)
    if (req.user?.is_admin) return res.json({ ok: true });
    const day = new Date().toISOString().slice(0, 10);
    const fp = req.user?.id ?? fingerprint(req);
    const r = db.prepare("INSERT OR IGNORE INTO play_events (audio_id, fingerprint, day) VALUES (?, ?, ?)").run(a.id, fp, day);
    if (r.changes > 0) db.prepare("UPDATE audios SET plays = plays + 1 WHERE id = ?").run(a.id);
    res.json({ ok: true });
  }),
);

// ---- Listen heartbeats (drive average-listen-time analytics) ---------------
const listenSchema = z.object({
  sid: z.string().regex(/^[a-z0-9]{8,24}$/),
  seconds: z.number().min(0),
  position: z.number().min(0),
});
const getListen = db.prepare("SELECT seconds, started_at FROM listens WHERE id = ?");
const countSessions = db.prepare("SELECT COUNT(*) c FROM listens WHERE audio_id = ? AND fingerprint = ? AND day = ?");
const upsertListen = db.prepare(
  `INSERT INTO listens (id, audio_id, fingerprint, day, seconds, max_pos, started_at, updated_at)
   VALUES (@id, @audio_id, @fingerprint, @day, @seconds, @max_pos, @now, @now)
   ON CONFLICT(id) DO UPDATE SET
     seconds = MAX(listens.seconds, MIN(excluded.seconds, @cap)),
     max_pos = MAX(listens.max_pos, excluded.max_pos),
     updated_at = excluded.updated_at`,
);
const MAX_SESSIONS_PER_LISTENER_PER_DAY = 30;
audiosRouter.post(
  "/:id/listen",
  rateLimit({ name: "listen", max: 1200, windowMs: 3_600_000 }),
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    if (!canView(a, req.user) || a.status !== "ready") throw new HttpError(404, "Audio not found");
    const parsed = listenSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid heartbeat");
    if (req.user?.is_admin) return res.json({ ok: true }); // not counted, like admin plays and downloads
    const dur = a.duration_sec || 0;
    const fp = req.user?.id ?? fingerprint(req);
    const day = new Date().toISOString().slice(0, 10);
    const sessionId = `${a.id}:${parsed.data.sid}`;
    const existing = getListen.get(sessionId) as { seconds: number; started_at: number } | undefined;
    // A brand-new session per heartbeat is the obvious way to inflate numbers: cap sessions per listener per day
    if (!existing && (countSessions.get(a.id, fp, day) as { c: number }).c >= MAX_SESSIONS_PER_LISTENER_PER_DAY) return res.json({ ok: true });
    // Listened seconds can't exceed wall-clock time since the session began (at 2x speed, plus slack for the first beat)
    const elapsed = existing ? (now() - existing.started_at) / 1000 : 0;
    const cap = Math.min(dur * 3 + 60, elapsed * 2.2 + 30);
    const seconds = Math.min(parsed.data.seconds, cap);
    const max_pos = Math.min(parsed.data.position, dur);
    upsertListen.run({ id: sessionId, audio_id: a.id, fingerprint: fp, day, seconds, max_pos, now: now(), cap });
    res.json({ ok: true });
  }),
);

// ---- Comments -------------------------------------------------------------
audiosRouter.get(
  "/:id/comments",
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    if (!canView(a, req.user)) throw new HttpError(404, "Audio not found");
    const rows = db
      .prepare(
        `SELECT c.id, c.body, c.created_at, u.id AS user_id, u.username, u.display_name, u.avatar
         FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.audio_id = ? AND (u.banned = 0 OR ?) ORDER BY c.created_at ASC LIMIT 500`,
      )
      .all(a.id, req.user?.is_admin ? 1 : 0) as any[];
    res.json({
      comments: rows.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        user: { id: c.user_id, username: c.username, displayName: c.display_name, avatarUrl: avatarUrl(c.avatar) },
        canDelete: req.user?.id === c.user_id || req.user?.id === a.user_id || !!req.user?.is_admin,
      })),
    });
  }),
);

audiosRouter.post(
  "/:id/comments",
  requireAuth,
  rateLimit({ name: "comments", max: config.limits.commentsPerHour, windowMs: 3_600_000, message: "You're commenting too fast. Take a break for a bit." }),
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    if (!canView(a, req.user)) throw new HttpError(404, "Audio not found");
    const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Comment can't be empty");
    const cid = id();
    db.transaction(() => {
      db.prepare("INSERT INTO comments (id, audio_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)").run(cid, a.id, req.user!.id, parsed.data.body, now());
      recordAction(req, req.user!.id, "comment");
      db.prepare("UPDATE audios SET comments_count = comments_count + 1 WHERE id = ?").run(a.id);
    })();
    res.status(201).json({
      comment: {
        id: cid, body: parsed.data.body, createdAt: now(),
        user: { id: req.user!.id, username: req.user!.username, displayName: req.user!.display_name, avatarUrl: avatarUrl(req.user!.avatar) },
        canDelete: true,
      },
    });
  }),
);

audiosRouter.delete(
  "/:id/comments/:cid",
  requireAuth,
  asyncHandler((req, res) => {
    const a = loadAudio(req.params.id as string);
    const c = db.prepare("SELECT user_id FROM comments WHERE id = ? AND audio_id = ?").get(req.params.cid, a.id) as { user_id: string } | undefined;
    if (!c) throw new HttpError(404, "Comment not found");
    if (c.user_id !== req.user!.id && a.user_id !== req.user!.id && !req.user!.is_admin) throw new HttpError(403, "Not allowed");
    db.transaction(() => {
      db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.cid);
      db.prepare("UPDATE audios SET comments_count = MAX(0, comments_count - 1) WHERE id = ?").run(a.id);
    })();
    res.json({ ok: true });
  }),
);

// ---- Streaming (mounted separately at /media) -----------------------------
export const mediaRouter = Router();
// Locally stored profile photos (on Bunny they're served from the CDN instead). Names are ours: <uid>-<rand>.webp
mediaRouter.get("/avatars/:file", (req, res) => {
  const f = req.params.file as string;
  if (!/^[a-z0-9]+-[a-z0-9]+\.webp$/.test(f)) return res.status(404).json({ error: "Not found" });
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.sendFile(path.join(paths.avatars, f), (err) => { if (err && !res.headersSent) res.status(404).json({ error: "Not found" }); });
});
mediaRouter.get(
  "/:file",
  asyncHandler(async (req, res) => {
    const m = /^([a-z0-9]+)\.m4a$/.exec(req.params.file as string);
    if (!m) throw new HttpError(404, "Not found");
    const a = getById.get(m[1]) as AudioRow | undefined;
    if (!a || !canView(a, req.user) || a.status !== "ready" || !a.stream_path) throw new HttpError(404, "Not found");
    const download = req.query.download === "1";
    const privileged = req.user?.id === a.user_id || !!req.user?.is_admin;
    if (download && !a.downloadable && !privileged) throw new HttpError(403, "The creator has disabled downloads for this audio");
    if (download && !privileged) {
      const r = hit("downloads", keyFor(req), config.limits.downloadsPerHour, 3_600_000);
      if (!r.ok) { res.setHeader("Retry-After", String(r.retryAfterSec)); throw new HttpError(429, `Download limit reached (${config.limits.downloadsPerHour} per hour). Try again in ${humanize(r.retryAfterSec)}.`); }
      // Count one download per listener per day (range requests for a single download share a row)
      const ins = db.prepare("INSERT OR IGNORE INTO download_events (audio_id, fingerprint, day) VALUES (?, ?, ?)")
        .run(a.id, req.user?.id ?? fingerprint(req), new Date().toISOString().slice(0, 10));
      if (ins.changes > 0) db.prepare("UPDATE audios SET downloads = downloads + 1 WHERE id = ?").run(a.id);
    }
    const filename = `${slugify(a.title)}.m4a`;

    if (isBunnyPath(a.stream_path)) {
      const key = bunnyKey(a.stream_path);
      // Streaming: hand off to the CDN with a signed URL. Downloads: proxy from storage so we can
      // set a proper filename and enforce the per-file download switch.
      if (!download) return res.redirect(302, signedCdnUrl(key));
      // Abort the upstream fetch if the client goes away so we don't keep pulling from storage
      const ac = new AbortController();
      res.on("close", () => { if (!res.writableFinished) ac.abort(); });
      const upstream = await getObject(key, req.headers.range as string | undefined, ac.signal);
      if (!upstream.ok && upstream.status !== 206) throw new HttpError(502, "Storage unavailable");
      res.status(upstream.status);
      for (const h of ["content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
        const v = upstream.headers.get(h); if (v) res.setHeader(h, v);
      }
      res.setHeader("Content-Type", "audio/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, max-age=0");
      if (!upstream.body) return res.end();
      const body = Readable.fromWeb(upstream.body as any);
      body.on("error", () => res.destroy());
      body.pipe(res);
      return;
    }

    res.sendFile(path.resolve(a.stream_path), {
      acceptRanges: true,
      cacheControl: true,
      maxAge: "7d",
      headers: {
        "Content-Type": "audio/mp4",
        ...(download ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}),
      },
    });
  }),
);
