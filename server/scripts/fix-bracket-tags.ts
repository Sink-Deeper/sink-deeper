/** One-off (2026-09-22): split tags that contain brackets ("[f4a] [teasing]", "snake[ [bondage") into proper tags.
 *  A tag cut at the old 40-character limit loses its unfinished last piece. Usage: npx tsx server/scripts/fix-bracket-tags.ts [--dry] */
import { db } from "../db.js";
import { parseTags } from "../util.js";
import { indexAudio } from "../search.js";

const dry = process.argv.includes("--dry");
const bad = db.prepare("SELECT id, name FROM tags WHERE name LIKE '%[%' OR name LIKE '%]%' OR name LIKE '%{%' OR name LIKE '%}%'").all() as { id: number; name: string }[];
const onAudio = db.prepare("SELECT audio_id FROM audio_tags WHERE tag_id = ?");
const insTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)"), getTag = db.prepare("SELECT id FROM tags WHERE name = ?");
const link = db.prepare("INSERT OR IGNORE INTO audio_tags (audio_id, tag_id) VALUES (?, ?)"), unlink = db.prepare("DELETE FROM audio_tags WHERE audio_id = ? AND tag_id = ?");
const drop = db.prepare("DELETE FROM tags WHERE id = ?");
const touched = new Set<string>();
db.transaction(() => {
  for (const t of bad) {
    let parts = t.name.split(/[\[\]{},|]+/).map((s) => s.trim()).filter(Boolean);
    if (t.name.length >= 40 && !/[\]}]\s*$/.test(t.name)) parts = parts.slice(0, -1); // cut mid-tag: last piece is incomplete
    const repl = parseTags(parts);
    const audios = (onAudio.all(t.id) as { audio_id: string }[]).map((r) => r.audio_id);
    console.log(`  ${JSON.stringify(t.name)} -> [${repl.join(", ")}] on ${audios.length} audio(s)`);
    if (dry) continue;
    for (const a of audios) {
      for (const r of repl) { insTag.run(r); link.run(a, (getTag.get(r) as { id: number }).id); }
      unlink.run(a, t.id); touched.add(a);
    }
    drop.run(t.id);
  }
})();
if (!dry) { for (const a of touched) indexAudio(a); console.log(`fixed ${bad.length} tags on ${touched.size} audios`); }
