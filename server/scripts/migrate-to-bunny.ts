/** Upload any locally stored stream copies to Bunny and repoint their rows. Safe to rerun.
 *  Usage (on the server, with /etc/murmur/env loaded):  set -a; . /etc/murmur/env; set +a; npx tsx server/scripts/migrate-to-bunny.ts */
import fs from "node:fs";
import { db } from "../db.js";
import { bunnyEnabled, putObject, BUNNY_PREFIX } from "../storage.js";

if (!bunnyEnabled) { console.error("BUNNY_* env not set; nothing to do"); process.exit(1); }
const rows = db.prepare("SELECT id, stream_path FROM audios WHERE status='ready' AND stream_path NOT LIKE 'bunny:%'").all() as { id: string; stream_path: string }[];
console.log(`${rows.length} local file(s) to migrate`);
for (const r of rows) {
  if (!fs.existsSync(r.stream_path)) { console.warn(`skip ${r.id}: ${r.stream_path} missing`); continue; }
  const key = `media/${r.id}.m4a`;
  await putObject(r.stream_path, key);
  db.prepare("UPDATE audios SET stream_path = ? WHERE id = ?").run(BUNNY_PREFIX + key, r.id);
  fs.rmSync(r.stream_path, { force: true });
  console.log(`migrated ${r.id}`);
}
console.log("done");
