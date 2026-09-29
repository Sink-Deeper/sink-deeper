/**
 * Soundgasm catalogue import (self-migration). A creator pastes their soundgasm.net profile URL; after
 * proving ownership (a verification code placed in the title, filename, or description of any of their
 * Soundgasm audios) we read each audio page, pull the m4a URL, download it into the normal upload pipeline,
 * and create the audio rows under their account. One background queue, one file at a time, with a polite
 * delay between requests. Admins may import without verification (e.g. with a creator's written permission).
 */
import fs from "node:fs";
import path from "node:path";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db, now } from "./db.js";
import { config, paths } from "./config.js";
import { id, slugify, parseTags, extractTags, stripTags } from "./util.js";
import { enqueueProcessing } from "./media.js";
import { quotaFor } from "./routes/auth.js";

const UA = "Mozilla/5.0 (compatible; Sinkdeeper-Importer/1.0; +https://sinkdeeper.com)";
const ALLOWED_HOSTS = (process.env.IMPORT_ALLOWED_HOSTS ?? "soundgasm.net,www.soundgasm.net,media.soundgasm.net").split(",").map((s) => s.trim());
// Relaxes the profile-URL shape so a local mock server can be used in tests. Must be set explicitly; an
// allowlist override alone never turns it on.
const TEST_MODE = process.env.IMPORT_TEST_MODE === "1";
const PROFILE_RE = /^https?:\/\/(?:www\.)?soundgasm\.net\/u\/([0-9a-zA-Z_-]+)\/?(?:[#?].*)?$/;
const PROFILE_RE_ANYHOST = /^https?:\/\/[^/]+\/u\/([0-9a-zA-Z_-]+)\/?(?:[#?].*)?$/;
const DELAY_MS = Number(process.env.IMPORT_DELAY_MS ?? 1500) || 1500;
const MAX_LINKS = Number(process.env.IMPORT_MAX_AUDIOS ?? 2000) || 2000;

function assertAllowed(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Unsupported URL scheme");
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`Refusing to fetch from ${u.hostname}`);
}

/** All fetches go over HTTPS so the certificate, not just DNS, has to match soundgasm.net. */
function forceHttps(url: string): string {
  if (TEST_MODE) return url;
  const u = new URL(url);
  u.protocol = "https:";
  return u.toString();
}

/** fetch() that re-checks the host allowlist on every redirect hop instead of following blindly. */
async function fetchAllowed(url: string, init: RequestInit & { signal: AbortSignal }, hops = 0): Promise<Response> {
  url = forceHttps(url);
  assertAllowed(url);
  const res = await fetch(url, { ...init, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get("location");
    if (!loc || hops >= 3) throw new Error("Too many redirects");
    await res.body?.cancel().catch(() => {});
    return fetchAllowed(new URL(loc, url).toString(), init, hops + 1);
  }
  return res;
}

/** Fetch a page, enforcing the size limit while streaming rather than after buffering everything. */
export async function fetchText(url: string, maxBytes = 2 * 1024 * 1024, signal?: AbortSignal): Promise<string> {
  const res = await fetchAllowed(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: signal ?? AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new Error("Page too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Error text shown to the user: no filesystem paths or internals. */
function publicError(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).replace(/\/[\w./-]+/g, "").replace(/\s{2,}/g, " ").trim();
  if (/abort|timeout/i.test(m)) return "Timed out";
  return (m || "Failed").slice(0, 160);
}

export function parseProfileUrl(url: string): { user: string; base: string } | null {
  const trimmed = url.trim();
  const m = PROFILE_RE.exec(trimmed) ?? (TEST_MODE ? PROFILE_RE_ANYHOST.exec(trimmed) : null);
  if (!m) return null;
  const u = new URL(trimmed);
  return { user: m[1], base: `${u.protocol}//${u.host}` };
}

/** Audio page links on a profile page (the same pattern yt-dlp relies on). */
export function parseProfile(html: string, user: string, base: string): { url: string; slug: string }[] {
  const out = new Map<string, { url: string; slug: string }>();
  const esc = user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`href="((?:https?://[^"/]+)?/u/${esc}/([0-9a-zA-Z_-]+))"`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].startsWith("http") ? m[1] : base + m[1];
    if (!out.has(m[2])) out.set(m[2], { url: href, slug: m[2] });
  }
  return [...out.values()];
}

const decode = (s: string) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").trim();

export function parseAudioPage(html: string): { m4a: string | null; title: string | null; description: string } {
  const m4a = /m4a\s*:\s*(["'])((?:(?!\1).)+)\1/s.exec(html)?.[2] ?? null;
  const title = /<div[^>]+\bclass=["']jp-title[^>]+>([^<]+)/.exec(html)?.[1] ?? null;
  const desc = /<div[^>]+\bclass=["']jp-description[^>]+>(.+?)<\/div>/s.exec(html)?.[1] ?? /<li>Description:\s(.*?)<\/li>/s.exec(html)?.[1] ?? "";
  return { m4a, title: title ? decode(title) : null, description: decode(desc) };
}

/** "[F4M] [Rain] Cosy night" -> tags ["f4m","rain"] (brackets plus standalone X4Y tokens) */
export const tagsFromTitle = (title: string): string[] => extractTags(title);

// ---------------------------------------------------------------- verification
export function getOrCreateVerifyCode(userId: string): string {
  const row = db.prepare("SELECT verify_code FROM users WHERE id = ?").get(userId) as { verify_code: string | null };
  if (row.verify_code) return row.verify_code;
  const code = `sinkdeeper-${id(10)}`;
  db.prepare("UPDATE users SET verify_code = ? WHERE id = ?").run(code, userId);
  return code;
}

/**
 * The code counts if it appears anywhere on the profile page (titles and descriptions are listed there)
 * or on any of the first several audio pages (title, filename/slug, or description).
 */
export async function verifyOwnership(profileUrl: string, code: string): Promise<{ verified: boolean; found: number; links: { url: string; slug: string }[] }> {
  const p = parseProfileUrl(profileUrl);
  if (!p) throw new Error("Not a Soundgasm profile URL");
  const html = await fetchText(profileUrl);
  const links = parseProfile(html, p.user, p.base).slice(0, MAX_LINKS);
  const needle = code.toLowerCase();
  if (html.toLowerCase().includes(needle)) return { verified: true, found: links.length, links };
  for (const l of links.slice(0, 8)) {
    if (l.slug.toLowerCase().includes(needle)) return { verified: true, found: links.length, links };
    try { if ((await fetchText(l.url)).toLowerCase().includes(needle)) return { verified: true, found: links.length, links }; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return { verified: false, found: links.length, links };
}

// ---------------------------------------------------------------- jobs
export type ImportRow = {
  id: string; user_id: string; source_url: string; status: "queued" | "running" | "done" | "failed" | "cancelled";
  total: number; done: number; skipped: number; failed: number; log: string; visibility: string; downloadable: number;
  created_at: number; updated_at: number; error: string | null;
};
const queue: string[] = [];
let running = false;
/** Abort controller for the job currently downloading, so cancel stops the transfer immediately. */
const inflight = new Map<string, AbortController>();

export function createImport(userId: string, sourceUrl: string, visibility: string, downloadable: boolean): ImportRow {
  const iid = id();
  db.prepare(
    `INSERT INTO imports (id, user_id, source_url, status, total, done, skipped, failed, log, visibility, downloadable, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', 0, 0, 0, 0, '[]', ?, ?, ?, ?)`,
  ).run(iid, userId, sourceUrl, visibility, downloadable ? 1 : 0, now(), now());
  queue.push(iid);
  void drain();
  return getImport(iid)!;
}
export const getImport = (iid: string) => db.prepare("SELECT * FROM imports WHERE id = ?").get(iid) as ImportRow | undefined;
export function cancelImport(iid: string) {
  db.prepare("UPDATE imports SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('queued','running')").run(now(), iid);
  inflight.get(iid)?.abort();
}
const isCancelled = (iid: string) => getImport(iid)?.status === "cancelled";

function appendLog(iid: string, entry: Record<string, unknown>) {
  const row = getImport(iid)!;
  const log = JSON.parse(row.log) as unknown[];
  log.push({ t: now(), ...entry });
  db.prepare("UPDATE imports SET log = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(log.slice(-500)), now(), iid);
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const iid = queue.shift()!;
    try {
      await runImport(iid);
    } catch (e) {
      try { db.prepare("UPDATE imports SET status='failed', error=?, updated_at=? WHERE id=?").run(publicError(e), now(), iid); }
      catch (e2) { console.error("[import] could not record failure", e2); }
    }
  }
  running = false;
}

export async function downloadTo(url: string, dest: string, maxBytes: number, signal: AbortSignal): Promise<number> {
  const res = await fetchAllowed(url, { headers: { "User-Agent": UA }, signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]) });
  if (!res.ok || !res.body) throw new Error(`Audio download returned HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`File too large (${Math.round(declared / 1e6)} MB)`);
  let seen = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) cb(new Error("File too large or over your storage quota")); else cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as any), counter, fs.createWriteStream(dest));
  return seen;
}

async function runImport(iid: string) {
  const job = getImport(iid);
  if (!job || job.status !== "queued") return;
  const p = parseProfileUrl(job.source_url);
  if (!p) throw new Error("Bad profile URL");
  // Counters restart from zero on every (re)run; already-imported items simply show up as skipped.
  db.prepare("UPDATE imports SET status='running', done=0, skipped=0, failed=0, updated_at=? WHERE id=?").run(now(), iid);
  const ac = new AbortController();
  inflight.set(iid, ac);

  try {
    const all = parseProfile(await fetchText(job.source_url, undefined, ac.signal), p.user, p.base);
    // Soundgasm lists a profile newest first. Import oldest first so "Newest" on Sinkdeeper matches their order.
    const links = all.slice(0, MAX_LINKS).reverse();
    if (all.length > links.length) appendLog(iid, { url: job.source_url, status: "failed", error: `Profile has ${all.length} audios; only the first ${MAX_LINKS} are imported per run` });
    db.prepare("UPDATE imports SET total=?, updated_at=? WHERE id=?").run(links.length, now(), iid);
    const exists = db.prepare("SELECT id FROM audios WHERE user_id = ? AND source_url = ? AND status != 'failed'");
    const taken = db.prepare("SELECT 1 FROM audios WHERE user_id = ? AND slug = ?");
    const insTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
    const getTag = db.prepare("SELECT id FROM tags WHERE name = ?");
    const linkTag = db.prepare("INSERT OR IGNORE INTO audio_tags (audio_id, tag_id) VALUES (?, ?)");

    for (const link of links) {
      if (isCancelled(iid)) return;
      if (exists.get(job.user_id, link.url)) {
        db.prepare("UPDATE imports SET skipped = skipped + 1, updated_at=? WHERE id=?").run(now(), iid);
        appendLog(iid, { url: link.url, status: "skipped", reason: "already imported" });
        continue;
      }
      // Out of space: stop instead of fetching every remaining page just to fail each one
      const q = quotaFor(job.user_id);
      const room = Math.max(0, q.quotaBytes - q.usedBytes);
      if (room < 1024 * 1024) {
        appendLog(iid, { url: link.url, status: "failed", error: "Storage quota full; import stopped. Free some space and run it again to continue." });
        db.prepare("UPDATE imports SET status='done', error='Stopped: storage quota full', updated_at=? WHERE id=? AND status='running'").run(now(), iid);
        return;
      }
      let tmp: string | null = null;
      try {
        const page = parseAudioPage(await fetchText(link.url, undefined, ac.signal));
        if (!page.m4a) throw new Error("No audio found on page");
        const rawTitle = page.title ?? link.slug.replace(/[-_]+/g, " ");
        // Tags come from brackets + X4Y tokens in title and description; then both are cleaned of them
        const tags = extractTags(`${rawTitle}\n${page.description}`);
        const title = (stripTags(rawTitle) || rawTitle).slice(0, 140);
        const description = stripTags(page.description, { audienceTokens: false }).slice(0, 10000);
        tmp = path.join(paths.uploads, `${id(16)}.m4a`);
        const size = await downloadTo(page.m4a, tmp, Math.min(config.maxUploadBytes, room), ac.signal);
        if (isCancelled(iid)) { fs.rmSync(tmp, { force: true }); return; }
        const base = slugify(title);
        let slug = base;
        while (taken.get(job.user_id, slug)) slug = `${base}-${id(4)}`;
        const audioId = id();
        const t = now();
        db.transaction(() => {
          db.prepare(
            `INSERT INTO audios (id, user_id, slug, title, description, visibility, downloadable, status, original_filename, original_path, size_bytes, source_url, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?)`,
          ).run(audioId, job.user_id, slug, title, description, job.visibility, job.downloadable, `${link.slug}.m4a`, tmp, size, link.url, t, t);
          for (const tg of tags) { insTag.run(tg); linkTag.run(audioId, (getTag.get(tg) as { id: number }).id); }
        })();
        enqueueProcessing(audioId);
        db.prepare("UPDATE imports SET done = done + 1, updated_at=? WHERE id=?").run(now(), iid);
        appendLog(iid, { url: link.url, status: "imported", title, audioId });
      } catch (e) {
        if (tmp) fs.rmSync(tmp, { force: true });
        if (isCancelled(iid)) return;
        db.prepare("UPDATE imports SET failed = failed + 1, updated_at=? WHERE id=?").run(now(), iid);
        appendLog(iid, { url: link.url, status: "failed", error: publicError(e) });
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    // Only a still-running job becomes done; a cancel that landed meanwhile stays cancelled
    db.prepare("UPDATE imports SET status='done', updated_at=? WHERE id=? AND status='running'").run(now(), iid);
  } catch (e) {
    if (isCancelled(iid)) return;
    db.prepare("UPDATE imports SET status='failed', error=?, updated_at=? WHERE id=? AND status='running'").run(publicError(e), now(), iid);
  } finally {
    inflight.delete(iid);
  }
}

/** Re-queue imports interrupted by a restart. */
export function resumeImports() {
  for (const r of db.prepare("SELECT id FROM imports WHERE status IN ('queued','running')").all() as { id: string }[]) {
    db.prepare("UPDATE imports SET status='queued' WHERE id=?").run(r.id);
    appendLog(r.id, { url: "", status: "skipped", reason: "server restarted; import resumed" });
    queue.push(r.id);
  }
  void drain();
}
