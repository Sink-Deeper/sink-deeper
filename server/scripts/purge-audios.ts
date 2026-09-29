/** Delete EVERY audio (rows, search index, stored media, local files). Accounts, playlists and follows stay.
 *  Usage: set -a; . /etc/murmur/env; set +a; npx tsx server/scripts/purge-audios.ts --yes [--user <username>] */
import fs from "node:fs";
import { db } from "../db.js";
import { unindexAudio } from "../search.js";
import { isBunnyPath, bunnyKey, deleteObject } from "../storage.js";

const args = process.argv.slice(2);
if (!args.includes("--yes")) { console.error("refusing without --yes"); process.exit(1); }
const ui = args.indexOf("--user");
const user = ui >= 0 ? args[ui + 1] : null;

const rows = db.prepare(
  `SELECT a.id, a.rowid AS rid, a.title, a.stream_path, a.original_path, u.username FROM audios a JOIN users u ON u.id = a.user_id ${user ? "WHERE u.username = ?" : ""}`,
).all(...(user ? [user] : [])) as { id: string; rid: number; title: string; stream_path: string | null; original_path: string | null; username: string }[];
console.log(`${rows.length} audio(s) to remove`);

let bunnyFailed = 0;
for (const a of rows) {
  db.transaction(() => { unindexAudio(a.rid); db.prepare("DELETE FROM audios WHERE id = ?").run(a.id); })();
  for (const p of [a.stream_path, a.original_path]) {
    if (!p) continue;
    if (isBunnyPath(p)) { try { await deleteObject(bunnyKey(p)); } catch { try { await deleteObject(bunnyKey(p)); } catch { bunnyFailed++; console.error(`  bunny delete failed: ${p}`); } } }
    else fs.rmSync(p, { force: true });
  }
  console.log(`  removed ${a.username}: ${a.title}`);
}
db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM audio_tags)").run();
db.prepare("DELETE FROM imports").run();
console.log(`done. remaining audios: ${(db.prepare("SELECT COUNT(*) c FROM audios").get() as any).c}, bunny failures: ${bunnyFailed}`);
