import express from "express";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { sessionMiddleware } from "./auth.js";
import { HttpError } from "./util.js";
import { resumeProcessing } from "./media.js";
import { rebuildIndexIfNeeded } from "./search.js";
import { authRouter } from "./routes/auth.js";
import { audiosRouter, mediaRouter } from "./routes/audios.js";
import { browseRouter } from "./routes/browse.js";
import { usersRouter } from "./routes/users.js";
import { playlistsRouter } from "./routes/playlists.js";
import { adminRouter } from "./routes/admin.js";
import { analyticsRouter } from "./routes/analytics.js";
import { importRouter } from "./routes/import.js";
import { resumeImports } from "./importer.js";
import { rateLimit } from "./ratelimit.js";
import { db } from "./db.js";
import { pruneActionIps } from "./accountability.js";
import { startHealthChecks, storageStatus, storageDown } from "./health.js";
import { AUDIO_SELECT, canView, type AudioRow } from "./serialize.js";

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => { console.error("[uncaughtException]", e); process.exit(1); });

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.set("etag", false);
app.use(express.json({ limit: "256kb" }));
app.use(sessionMiddleware);
app.use("/api", rateLimit({ name: "api", by: "ip", max: config.limits.apiPerMinutePerIp, windowMs: 60_000 }));
app.use("/media", rateLimit({ name: "media", by: "ip", max: config.limits.mediaPerMinutePerIp, windowMs: 60_000 }));

app.use("/api/auth", authRouter);
app.use("/api/audios", audiosRouter);
app.use("/api/browse", browseRouter);
app.use("/api/users", usersRouter);
app.use("/api/playlists", playlistsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/import", importRouter);
app.use("/media", mediaRouter);

// Minimal oEmbed-ish endpoint for share cards
app.get("/api/embed/:id", (req, res) => {
  const a = db.prepare(`SELECT ${AUDIO_SELECT} WHERE a.id = ?`).get(req.params.id) as AudioRow | undefined;
  if (!a || !canView(a, req.user) || a.status !== "ready") return res.status(404).json({ error: "Not found" });
  res.json({ title: a.title, author: a.display_name, duration: a.duration_sec, streamUrl: `/media/${a.id}.m4a` });
});

app.get("/api/health", (_req, res) => {
  try { db.prepare("SELECT 1").get(); res.json({ ok: true, storage: !storageDown() }); } catch { res.status(500).json({ ok: false }); }
});
// Public: lets the site show a banner when playback is unavailable
app.get("/api/status", (_req, res) => res.json({ storage: { ok: !storageDown(), since: storageDown() ? storageStatus().failingSince : null } }));

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Production: serve the built client with SPA fallback. Hashed assets are immutable; index.html must not be.
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      else if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else res.setHeader("Cache-Control", "public, max-age=3600");
    },
  }));
  app.get(/^\/(?!api|media).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(config.clientDist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && typeof err === "object" && "type" in err) {
    const t = (err as any).type;
    if (t === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
    if (t === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

// Nightly pruning of raw analytics rows (aggregated counters on audios are kept forever)
function pruneAnalytics() {
  try {
    const cutoff = new Date(Date.now() - config.limits.analyticsRetentionDays * 86_400_000).toISOString().slice(0, 10);
    for (const t of ["play_events", "download_events", "listens"]) db.prepare(`DELETE FROM ${t} WHERE day < ?`).run(cutoff);
    pruneActionIps();
  } catch (e) { console.error("[prune] failed", e); }
}
setInterval(pruneAnalytics, 24 * 3_600_000).unref();

rebuildIndexIfNeeded();
resumeProcessing();
resumeImports();
startHealthChecks();
pruneAnalytics();

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] listening on http://${config.host}:${config.port} (data: ${config.dataDir})`);
});
// Large uploads legitimately take longer than Node's 5-minute default request timeout
server.requestTimeout = 2 * 60 * 60_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000; // > Caddy's default idle so the proxy closes first

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
