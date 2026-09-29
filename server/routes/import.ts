import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { HttpError, asyncHandler } from "../util.js";
import { requireAuth } from "../auth.js";
import { rateLimit } from "../ratelimit.js";
import { parseProfileUrl, getOrCreateVerifyCode, verifyOwnership, createImport, getImport, cancelImport, type ImportRow } from "../importer.js";
import { recordAction } from "../accountability.js";
import { storageDown } from "../health.js";
import { now } from "../db.js";

export const importRouter = Router();
importRouter.use(requireAuth);

/** A successful check is good for 24 h; after that the code must still be on the profile to start an import. */
const VERIFY_TTL = 24 * 3_600_000;
const canonical = (url: string) => { const p = parseProfileUrl(url); return p ? `${p.base}/u/${p.user}` : url; };
function markVerified(userId: string, url: string) {
  db.prepare("UPDATE users SET verified_source = ?, verified_at = ? WHERE id = ?").run(canonical(url), now(), userId);
}
function recentlyVerified(userId: string, url: string): boolean {
  const r = db.prepare("SELECT verified_source, verified_at FROM users WHERE id = ?").get(userId) as { verified_source: string | null; verified_at: number | null };
  return r.verified_source === canonical(url) && !!r.verified_at && now() - r.verified_at < VERIFY_TTL;
}

// An import copies files quickly, then each still has to be prepared for playback. Report both, so the page only says
// "finished" once everything is playable, plus how many imports are ahead in the (one-at-a-time) queue.
const jobAudio = db.prepare(
  "SELECT SUM(status = 'ready') ready, SUM(status = 'processing') processing, SUM(status = 'failed') failed FROM audios WHERE user_id = ? AND source_url IS NOT NULL AND created_at >= ? AND created_at <= ?",
);
const importsAhead = db.prepare("SELECT COUNT(*) c FROM imports WHERE status IN ('queued', 'running') AND created_at < ?");
const serialize = (r: ImportRow) => {
  const live = r.status === "queued" || r.status === "running";
  const c = jobAudio.get(r.user_id, r.created_at, live ? now() : r.updated_at + 60_000) as { ready: number | null; processing: number | null; failed: number | null };
  return {
    id: r.id, sourceUrl: r.source_url, status: r.status, total: r.total, done: r.done, skipped: r.skipped, failed: r.failed,
    visibility: r.visibility, downloadable: !!r.downloadable, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at,
    ready: c.ready ?? 0, processing: c.processing ?? 0, failedProcessing: c.failed ?? 0,
    queueAhead: r.status === "queued" ? (importsAhead.get(r.created_at) as { c: number }).c : 0,
    log: (JSON.parse(r.log) as unknown[]).slice(-100),
  };
};

importRouter.get("/verification", (req, res) => {
  res.json({ code: getOrCreateVerifyCode(req.user!.id) });
});

// Look at a profile: how many audios, and is it verified as yours?
importRouter.post(
  "/preview",
  rateLimit({ name: "import-preview", max: 20, windowMs: 3_600_000 }),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ url: z.string().url() }).safeParse(req.body);
    if (!parsed.success || !parseProfileUrl(parsed.data.url)) {
      throw new HttpError(400, "That doesn't look like a Soundgasm profile URL (https://soundgasm.net/u/yourname)");
    }
    const code = getOrCreateVerifyCode(req.user!.id);
    let r;
    try { r = await verifyOwnership(parsed.data.url, code); } catch (e) { throw new HttpError(502, `Couldn't read that profile: ${e instanceof Error ? e.message : e}`); }
    if (r.verified) markVerified(req.user!.id, parsed.data.url);
    res.json({
      user: parseProfileUrl(parsed.data.url)!.user, found: r.found, verified: r.verified || !!req.user!.is_admin,
      adminBypass: !r.verified && !!req.user!.is_admin, code, sample: r.links.slice(0, 5).map((l) => l.slug),
    });
  }),
);

importRouter.post(
  "/",
  rateLimit({ name: "import-start", max: 5, windowMs: 86_400_000, message: "Import limit reached for today." }),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      url: z.string().url(),
      visibility: z.enum(["public", "unlisted", "private"]).default("public"),
      downloadable: z.boolean().default(true),
    }).safeParse(req.body);
    if (!parsed.success || !parseProfileUrl(parsed.data.url)) throw new HttpError(400, "Invalid request");
    const active = db.prepare("SELECT 1 FROM imports WHERE user_id = ? AND status IN ('queued','running')").get(req.user!.id);
    if (active) throw new HttpError(409, "You already have an import running");
    if (storageDown()) throw new HttpError(503, "Imports are paused: our file storage is having problems. Nothing is lost, please try again in a few minutes.");
    if (!req.user!.is_admin && !recentlyVerified(req.user!.id, parsed.data.url)) {
      const r = await verifyOwnership(parsed.data.url, getOrCreateVerifyCode(req.user!.id)).catch(() => ({ verified: false }));
      if (!r.verified) throw new HttpError(403, "Verify the profile first: put your code in a title or description on Soundgasm, then run the check.");
      markVerified(req.user!.id, parsed.data.url);
    }
    const job = createImport(req.user!.id, parsed.data.url, parsed.data.visibility, parsed.data.downloadable);
    recordAction(req, req.user!.id, "import");
    res.status(201).json({ import: serialize(job) });
  }),
);

importRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(req.user!.id) as ImportRow[];
  res.json({ imports: rows.map(serialize) });
});

importRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    const r = getImport(req.params.id as string);
    if (!r || (r.user_id !== req.user!.id && !req.user!.is_admin)) throw new HttpError(404, "Import not found");
    res.json({ import: serialize(r) });
  }),
);

importRouter.post(
  "/:id/cancel",
  asyncHandler((req, res) => {
    const r = getImport(req.params.id as string);
    if (!r || (r.user_id !== req.user!.id && !req.user!.is_admin)) throw new HttpError(404, "Import not found");
    cancelImport(r.id);
    res.json({ import: serialize(getImport(r.id)!) });
  }),
);

/**
 * "This is my catalogue." The real owner of a Soundgasm profile proves it with their own code; any audio
 * imported from that profile by *other* accounts is hidden immediately and flagged for admin review.
 * Same challenge as importing, so it needs nothing from us and works even if the impostor is unresponsive.
 */
importRouter.post(
  "/claim",
  rateLimit({ name: "import-claim", max: 10, windowMs: 86_400_000 }),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ url: z.string().url() }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "That doesn't look like a Soundgasm profile URL");
    const url = parsed.data.url;
    const prof = parseProfileUrl(url);
    if (!prof) throw new HttpError(400, "That doesn't look like a Soundgasm profile URL");
    if (!recentlyVerified(req.user!.id, url)) {
      let r;
      try { r = await verifyOwnership(url, getOrCreateVerifyCode(req.user!.id)); } catch (e) { throw new HttpError(502, `Couldn't read that profile: ${e instanceof Error ? e.message : e}`); }
      if (!r.verified) throw new HttpError(403, "Code not found on that profile yet. Add it to a title or description, then try again.");
      markVerified(req.user!.id, url);
    }
    const prefix = `${canonical(url)}/`;
    const hidden = db.prepare(
      `UPDATE audios SET visibility = 'private', claimed_by = ?, updated_at = ?
       WHERE user_id != ? AND claimed_by IS NULL AND (source_url LIKE ? OR source_url LIKE ?)`,
    ).run(req.user!.id, now(), req.user!.id, prefix.replace("https://", "http://") + "%", prefix + "%");
    const offenders = db.prepare(
      `SELECT DISTINCT u.username FROM audios a JOIN users u ON u.id = a.user_id WHERE a.claimed_by = ?`,
    ).all(req.user!.id) as { username: string }[];
    if (hidden.changes) console.warn(`[claim] ${req.user!.username} reclaimed ${prof.user}: hid ${hidden.changes} audio(s) uploaded by ${offenders.map((o) => o.username).join(", ")}`);
    res.json({ hidden: hidden.changes, uploaders: offenders.map((o) => o.username) });
  }),
);
