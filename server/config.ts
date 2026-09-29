import path from "node:path";
import fs from "node:fs";

const root = process.cwd();

/** Parse a numeric env var defensively: unset, empty, or non-numeric values fall back to the default. */
function num(name: string, def: number, opts: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) { console.warn(`[config] ${name}=${JSON.stringify(raw)} is not a number; using ${def}`); return def; }
  if (opts.min !== undefined && n < opts.min) { console.warn(`[config] ${name}=${n} below minimum ${opts.min}; using ${opts.min}`); return opts.min; }
  if (opts.max !== undefined && n > opts.max) { console.warn(`[config] ${name}=${n} above maximum ${opts.max}; using ${opts.max}`); return opts.max; }
  return n;
}

export const config = {
  port: num("PORT", 3000, { min: 1, max: 65535 }),
  host: process.env.HOST ?? "127.0.0.1", // behind Caddy on the same box; set HOST=0.0.0.0 to expose directly
  dataDir: path.resolve(root, process.env.DATA_DIR ?? "./data"),
  maxUploadBytes: num("MAX_UPLOAD_MB", 500, { min: 1 }) * 1024 * 1024,
  /** Longest audio accepted, in seconds. Protects the transcoder from a tiny file that decodes to hours. */
  maxDurationSec: num("MAX_DURATION_MIN", 6 * 60, { min: 1 }) * 60,
  /** Per-step ffmpeg timeout. */
  ffmpegTimeoutMs: num("FFMPEG_TIMEOUT_MIN", 30, { min: 1 }) * 60_000,
  keepOriginals: process.env.KEEP_ORIGINALS === "1",
  // Unreleased features, off unless explicitly enabled on the server
  features: { versions: process.env.FEATURE_VERSIONS === "1" },
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
  isProd: process.env.NODE_ENV === "production",
  // Secure cookies default to on in production; set COOKIE_SECURE=0 while serving over plain HTTP (no domain yet)
  secureCookies: process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === "1" : process.env.NODE_ENV === "production",
  clientDist: path.resolve(root, process.env.CLIENT_DIST ?? "client/dist"),
  limits: {
    uploadsPerDay: num("MAX_UPLOADS_PER_DAY", 20, { min: 1 }),
    uploadBurstPer10Min: num("MAX_UPLOADS_PER_10MIN", 5, { min: 1 }),
    userQuotaBytes: num("USER_QUOTA_MB", 5120, { min: 1 }) * 1024 * 1024,
    downloadsPerHour: num("MAX_DOWNLOADS_PER_HOUR", 30, { min: 1 }),
    registrationsPerIpPerDay: num("MAX_REGISTRATIONS_PER_IP_PER_DAY", 5, { min: 1 }),
    loginAttemptsPer15Min: num("MAX_LOGIN_ATTEMPTS_PER_15MIN", 10, { min: 1 }),
    loginFailuresPerAccountPer15Min: num("MAX_LOGIN_FAILURES_PER_ACCOUNT_PER_15MIN", 20, { min: 1 }),
    commentsPerHour: num("MAX_COMMENTS_PER_HOUR", 30, { min: 1 }),
    playlistsPerUser: num("MAX_PLAYLISTS_PER_USER", 100, { min: 1 }),
    playlistItems: num("MAX_PLAYLIST_ITEMS", 500, { min: 1 }),
    apiPerMinutePerIp: num("MAX_API_PER_MIN_PER_IP", 600, { min: 1 }),
    mediaPerMinutePerIp: num("MAX_MEDIA_PER_MIN_PER_IP", 300, { min: 1 }),
    writesPerHour: num("MAX_WRITES_PER_HOUR", 300, { min: 1 }),
    /** Raw analytics rows (plays, downloads, listens) older than this are pruned nightly; counters are kept. */
    analyticsRetentionDays: num("ANALYTICS_RETENTION_DAYS", 400, { min: 30 }),
    actionIpRetentionDays: num("ACTION_IP_RETENTION_DAYS", 90, { min: 1 }),
  },
  /** Bunny.net storage + CDN; null = keep media on local disk. All five vars are required to enable it. */
  bunny: (() => {
    const e = process.env;
    if (!e.BUNNY_STORAGE_ZONE || !e.BUNNY_STORAGE_HOST || !e.BUNNY_STORAGE_KEY || !e.BUNNY_CDN_HOST || !e.BUNNY_TOKEN_KEY) return null;
    // BUNNY_API_KEY (account key) is optional; when present, deleted files are purged from the CDN edge immediately
    return { storageZone: e.BUNNY_STORAGE_ZONE, storageHost: e.BUNNY_STORAGE_HOST, storageKey: e.BUNNY_STORAGE_KEY, cdnHost: e.BUNNY_CDN_HOST, tokenKey: e.BUNNY_TOKEN_KEY, apiKey: e.BUNNY_API_KEY || null };
  })(),
};
export const paths = {
  db: path.join(config.dataDir, "app.db"),
  uploads: path.join(config.dataDir, "uploads"), // raw incoming files
  media: path.join(config.dataDir, "media"), // transcoded stream copies
  originals: path.join(config.dataDir, "originals"),
  avatars: path.join(config.dataDir, "avatars"), // profile photos when not on Bunny
};
for (const p of [config.dataDir, paths.uploads, paths.media, paths.originals, paths.avatars]) {
  fs.mkdirSync(p, { recursive: true, mode: 0o750 });
}
