import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.js";
import { HttpError, asyncHandler } from "../util.js";
import { requireAdmin } from "../auth.js";
import { storageStatus } from "../health.js";
import { config } from "../config.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

/** Written by deploy/backup.sh (and its systemd OnFailure unit). Stale = no successful run in 36 h. */
function backupStatus() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(config.dataDir, "backup-status.json"), "utf8"));
    const ageH = (Date.now() - Number(raw.at || 0)) / 3_600_000;
    return { ...raw, ageHours: Math.round(ageH), stale: !raw.ok || ageH > 36 };
  } catch {
    return { ok: false, stale: true, error: "no backup has reported yet" };
  }
}

adminRouter.get(
  "/overview",
  asyncHandler((_req, res) => {
    const n = (sql: string) => (db.prepare(sql).get() as any).c as number;
    res.json({
      backup: backupStatus(),
      storage: storageStatus(),
      users: n("SELECT COUNT(*) c FROM users"),
      banned: n("SELECT COUNT(*) c FROM users WHERE banned = 1"),
      audios: n("SELECT COUNT(*) c FROM audios"),
      processing: n("SELECT COUNT(*) c FROM audios WHERE status = 'processing'"),
      failed: n("SELECT COUNT(*) c FROM audios WHERE status = 'failed'"),
      claimed: db.prepare("SELECT a.id, a.title, a.source_url, u.username AS uploader, c.username AS claimant FROM audios a JOIN users u ON u.id = a.user_id JOIN users c ON c.id = a.claimed_by WHERE a.claimed_by IS NOT NULL ORDER BY a.updated_at DESC LIMIT 50").all(),
      bytes: (db.prepare("SELECT COALESCE(SUM(size_bytes),0) c FROM audios").get() as any).c,
      comments: n("SELECT COUNT(*) c FROM comments"),
      recentUsers: db.prepare("SELECT username, created_at, banned FROM users ORDER BY created_at DESC LIMIT 20").all(),
    });
  }),
);

/** Toggle a ban. Banned users are logged out, can't log in, and their content disappears from listings. */
adminRouter.post(
  "/users/:username/ban",
  asyncHandler((req, res) => {
    const u = db.prepare("SELECT id, banned, is_admin FROM users WHERE username = ?").get(req.params.username) as any;
    if (!u) throw new HttpError(404, "User not found");
    if (u.is_admin) throw new HttpError(400, "Can't ban an admin");
    const next = u.banned ? 0 : 1;
    db.transaction(() => {
      db.prepare("UPDATE users SET banned = ? WHERE id = ?").run(next, u.id);
      if (next) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
    })();
    res.json({ banned: !!next });
  }),
);
