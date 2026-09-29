import { Router } from "express";
import { db } from "../db.js";
import { HttpError, asyncHandler } from "../util.js";
import { requireAuth } from "../auth.js";
import { AUDIO_SELECT, type AudioRow } from "../serialize.js";
import { rateLimit } from "../ratelimit.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);
analyticsRouter.use(rateLimit({ name: "analytics", max: 120, windowMs: 60_000 }));

/** Day strings are UTC; the client labels them as such. */
function dayList(days: number): string[] {
  const out: string[] = [];
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) out.push(new Date(d.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}
function parseDays(q: unknown): number {
  const n = parseInt(String(q ?? "30")) || 30;
  return Math.min(365, Math.max(7, n));
}
type DayRow = { day: string; n: number };
function series(rows: DayRow[], days: string[]): number[] {
  const m = new Map(rows.map((r) => [r.day, Number(r.n)]));
  return days.map((d) => m.get(d) ?? 0);
}

/** Aggregate stats for one or many audio ids over a window. Uses a temp id set to keep IN lists bounded. */
function windowStats(ids: string[], since: string) {
  if (!ids.length) return { plays: 0, uniques: 0, downloads: 0, listenSeconds: 0, sessions: 0 };
  const ph = ids.map(() => "?").join(",");
  const p = db.prepare(`SELECT COUNT(*) plays, COUNT(DISTINCT fingerprint) uniques FROM play_events WHERE audio_id IN (${ph}) AND day >= ?`).get(...ids, since) as any;
  const d = db.prepare(`SELECT COUNT(*) n FROM download_events WHERE audio_id IN (${ph}) AND day >= ?`).get(...ids, since) as any;
  const l = db.prepare(`SELECT COALESCE(SUM(seconds),0) s, COUNT(*) n FROM listens WHERE audio_id IN (${ph}) AND day >= ?`).get(...ids, since) as any;
  return { plays: p.plays, uniques: p.uniques, downloads: d.n, listenSeconds: l.s, sessions: l.n };
}

const MAX_IDS = 900; // SQLite's default bound-parameter limit is 999 (32766 on newer builds); stay well under

// Creator overview: everything you've uploaded
analyticsRouter.get(
  "/overview",
  asyncHandler((req, res) => {
    const days = parseDays(req.query.days);
    const dl = dayList(days); const since = dl[0];
    const uid = req.user!.id;
    const audios = db.prepare(`SELECT ${AUDIO_SELECT} WHERE a.user_id = ? AND a.status = 'ready' ORDER BY a.created_at DESC LIMIT ?`).all(uid, MAX_IDS) as AudioRow[];
    const ids = audios.map((a) => a.id);
    const ph = ids.map(() => "?").join(",") || "''";

    const lifetime = {
      audios: audios.length,
      plays: audios.reduce((s, a) => s + a.plays, 0),
      downloads: audios.reduce((s, a) => s + a.downloads, 0),
      likes: audios.reduce((s, a) => s + a.likes_count, 0),
      comments: audios.reduce((s, a) => s + a.comments_count, 0),
      followers: (db.prepare("SELECT COUNT(*) c FROM follows WHERE followee_id = ?").get(uid) as any).c,
      listenSeconds: ids.length ? (db.prepare(`SELECT COALESCE(SUM(seconds),0) s FROM listens WHERE audio_id IN (${ph})`).get(...ids) as any).s : 0,
    };
    const period = windowStats(ids, since);
    const daily = ids.length ? {
      plays: series(db.prepare(`SELECT day, COUNT(*) n FROM play_events WHERE audio_id IN (${ph}) AND day >= ? GROUP BY day`).all(...ids, since) as DayRow[], dl),
      downloads: series(db.prepare(`SELECT day, COUNT(*) n FROM download_events WHERE audio_id IN (${ph}) AND day >= ? GROUP BY day`).all(...ids, since) as DayRow[], dl),
      listenSeconds: series(db.prepare(`SELECT day, COALESCE(SUM(seconds),0) n FROM listens WHERE audio_id IN (${ph}) AND day >= ? GROUP BY day`).all(...ids, since) as DayRow[], dl),
    } : { plays: dl.map(() => 0), downloads: dl.map(() => 0), listenSeconds: dl.map(() => 0) };

    // Per-audio rows for the table, ranked by plays in the window
    const perPlays = new Map((ids.length ? db.prepare(`SELECT audio_id, COUNT(*) n FROM play_events WHERE audio_id IN (${ph}) AND day >= ? GROUP BY audio_id`).all(...ids, since) as any[] : []).map((r) => [r.audio_id, r.n]));
    const perDl = new Map((ids.length ? db.prepare(`SELECT audio_id, COUNT(*) n FROM download_events WHERE audio_id IN (${ph}) AND day >= ? GROUP BY audio_id`).all(...ids, since) as any[] : []).map((r) => [r.audio_id, r.n]));
    const perListen = new Map((ids.length ? db.prepare(
      `SELECT l.audio_id, AVG(l.seconds) avg, COUNT(*) n,
              SUM(CASE WHEN l.max_pos >= 0.9 * a.duration_sec THEN 1 ELSE 0 END) done
       FROM listens l JOIN audios a ON a.id = l.audio_id
       WHERE l.audio_id IN (${ph}) AND l.day >= ? GROUP BY l.audio_id`,
    ).all(...ids, since) as any[] : []).map((r) => [r.audio_id, r]));
    const table = audios.map((a) => {
      const l = perListen.get(a.id);
      return {
        id: a.id, slug: a.slug, title: a.title, duration: a.duration_sec, createdAt: a.created_at, visibility: a.visibility,
        plays: perPlays.get(a.id) ?? 0, lifetimePlays: a.plays, downloads: perDl.get(a.id) ?? 0, likes: a.likes_count, comments: a.comments_count,
        avgListen: l ? l.avg : null, completion: l && l.n ? l.done / l.n : null, sessions: l?.n ?? 0,
      };
    }).sort((x, y) => y.plays - x.plays || y.lifetimePlays - x.lifetimePlays);

    res.json({ days: dl, timezone: "UTC", lifetime, period, daily, audios: table, truncated: audios.length >= MAX_IDS });
  }),
);

// One audio in depth
analyticsRouter.get(
  "/audio/:id",
  asyncHandler((req, res) => {
    const a = db.prepare(`SELECT ${AUDIO_SELECT} WHERE a.id = ?`).get(req.params.id) as AudioRow | undefined;
    if (!a) throw new HttpError(404, "Audio not found");
    if (a.user_id !== req.user!.id && !req.user!.is_admin) throw new HttpError(403, "Not yours");
    const days = parseDays(req.query.days);
    const dl = dayList(days); const since = dl[0];
    const dur = a.duration_sec || 1;

    const period = windowStats([a.id], since);
    const lifetime = {
      plays: a.plays, downloads: a.downloads, likes: a.likes_count, comments: a.comments_count,
      uniques: (db.prepare("SELECT COUNT(DISTINCT fingerprint) c FROM play_events WHERE audio_id = ?").get(a.id) as any).c,
      ...(db.prepare("SELECT COALESCE(SUM(seconds),0) listenSeconds, COUNT(*) sessions, COALESCE(AVG(seconds),0) avgListen, COALESCE(AVG(max_pos),0) avgReach FROM listens WHERE audio_id = ?").get(a.id) as any),
    };
    const daily = {
      plays: series(db.prepare("SELECT day, COUNT(*) n FROM play_events WHERE audio_id = ? AND day >= ? GROUP BY day").all(a.id, since) as DayRow[], dl),
      downloads: series(db.prepare("SELECT day, COUNT(*) n FROM download_events WHERE audio_id = ? AND day >= ? GROUP BY day").all(a.id, since) as DayRow[], dl),
      listenSeconds: series(db.prepare("SELECT day, COALESCE(SUM(seconds),0) n FROM listens WHERE audio_id = ? AND day >= ? GROUP BY day").all(a.id, since) as DayRow[], dl),
    };
    // Retention: share of sessions whose furthest position reached each 5% of the file, bucketed in SQL
    // so the cost is one aggregate query regardless of how many sessions exist.
    const buckets = db.prepare(
      `SELECT MIN(20, CAST(max_pos / ? * 20 AS INTEGER)) b, COUNT(*) n FROM listens WHERE audio_id = ? GROUP BY b`,
    ).all(dur, a.id) as { b: number; n: number }[];
    const total = buckets.reduce((s, r) => s + r.n, 0);
    const counts = new Array(21).fill(0);
    for (const r of buckets) counts[Math.max(0, Math.min(20, r.b))] += r.n;
    // retention[i] = share of sessions with bucket >= i
    const retention: (number | null)[] = [];
    let cum = 0;
    for (let i = 20; i >= 0; i--) { cum += counts[i]; retention[i] = total ? cum / total : null; }
    const completion = total ? (counts.slice(18).reduce((s, n) => s + n, 0)) / total : null; // >= 90%
    const periodListen = db.prepare("SELECT COALESCE(AVG(seconds),0) avgListen, COUNT(*) sessions FROM listens WHERE audio_id = ? AND day >= ?").get(a.id, since) as any;

    res.json({
      audio: { id: a.id, slug: a.slug, title: a.title, duration: a.duration_sec, createdAt: a.created_at, visibility: a.visibility, username: a.username },
      days: dl, timezone: "UTC", lifetime: { ...lifetime, completion }, period: { ...period, avgListen: periodListen.avgListen }, daily, retention,
    });
  }),
);
