/**
 * The only place exact internet addresses are stored: when someone does something public (signs up, uploads, imports,
 * comments, or changes their profile photo), so abuse and legal requests can be dealt with. Listening never records one.
 * Rows are deleted after config.limits.actionIpRetentionDays (90) and are stripped from nightly backups. Nothing in the
 * UI or API exposes them; the operator reads the table directly when a real case comes up.
 */
import type { Request } from "express";
import { db, now } from "./db.js";
import { config } from "./config.js";

export type PublicAction = "register" | "upload" | "import" | "comment" | "avatar";

const insert = db.prepare("INSERT INTO action_ips (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)");

export function recordAction(req: Request, userId: string, action: PublicAction): void {
  try { insert.run(userId, action, req.ip ?? "", now()); }
  catch (e) { console.error(`[accountability] could not record ${action}`, e); }
}

export function pruneActionIps(): number {
  return db.prepare("DELETE FROM action_ips WHERE created_at < ?").run(now() - config.limits.actionIpRetentionDays * 86_400_000).changes;
}
