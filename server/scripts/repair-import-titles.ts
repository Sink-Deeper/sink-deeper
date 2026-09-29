/** Re-derive titles and tags for imported audios from their source pages (an early importer truncated titles
 *  before stripping tags and dropped long bracket groups). Keeps the slug; only adds tags. Idempotent.
 *  Usage: set -a; . /etc/murmur/env; set +a; npx tsx server/scripts/repair-import-titles.ts [--dry] [--all]
 *  Without --all only titles that still contain a bracket character are visited. */
import { db } from "../db.js";
import { fetchText, parseAudioPage } from "../importer.js";
import { extractTags, stripTags } from "../util.js";
import { indexAudio } from "../search.js";

const dry = process.argv.includes("--dry");
const all = process.argv.includes("--all");
const rows = db.prepare(`SELECT id, title, source_url FROM audios WHERE source_url IS NOT NULL ${all ? "" : "AND (title LIKE '%[%' OR title LIKE '%]%' OR title LIKE '%{%' OR title LIKE '%}%')"}`).all() as { id: string; title: string; source_url: string }[];
console.log(`${rows.length} title(s) to repair${dry ? " (dry run)" : ""}`);
const insTag = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
const getTag = db.prepare("SELECT id FROM tags WHERE name = ?");
const linkTag = db.prepare("INSERT OR IGNORE INTO audio_tags (audio_id, tag_id) VALUES (?, ?)");
let fixed = 0;
for (const r of rows) {
  try {
    const page = parseAudioPage(await fetchText(r.source_url));
    if (!page.title) { console.log(`  skip ${r.id}: no title on source page`); continue; }
    const title = (stripTags(page.title) || page.title).slice(0, 140);
    const tags = extractTags(`${page.title}\n${page.description}`);
    const have = new Set((db.prepare("SELECT t.name FROM tags t JOIN audio_tags at ON at.tag_id = t.id WHERE at.audio_id = ?").all(r.id) as { name: string }[]).map((x) => x.name));
    const add = tags.filter((t) => !have.has(t));
    if (title === r.title && !add.length) continue;
    console.log(`  ${JSON.stringify(r.title)}${title !== r.title ? `\n    -> ${JSON.stringify(title)}` : ""}${add.length ? `  +tags: ${add.join(", ")}` : ""}`);
    if (!dry) {
      db.transaction(() => {
        if (title !== r.title) db.prepare("UPDATE audios SET title = ?, updated_at = ? WHERE id = ?").run(title, Date.now(), r.id);
        for (const t of add) { insTag.run(t); linkTag.run(r.id, (getTag.get(t) as { id: number }).id); }
      })();
      indexAudio(r.id);
    }
    fixed++;
  } catch (e) {
    console.log(`  failed ${r.id}: ${e instanceof Error ? e.message : e}`);
  }
  await new Promise((res) => setTimeout(res, 800));
}
console.log(`done: ${fixed} repaired`);
