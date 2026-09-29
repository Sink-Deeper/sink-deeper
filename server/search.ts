import { db } from "./db.js";

/**
 * audios_fts is a *contentless* FTS5 table: it stores only the index, not the text, so it cannot tell us
 * what was indexed for a row. To delete or replace an entry FTS5 must be handed the exact original
 * values, so we keep them ourselves in fts_source (rowid -> title/description/tags as indexed).
 */
const getAudio = db.prepare("SELECT rowid, title, description FROM audios WHERE id = ?");
const getTags = db.prepare("SELECT t.name FROM audio_tags at JOIN tags t ON t.id = at.tag_id WHERE at.audio_id = ?");
const del = db.prepare("INSERT INTO audios_fts(audios_fts, rowid, title, description, tags) VALUES('delete', ?, ?, ?, ?)");
const ins = db.prepare("INSERT INTO audios_fts(rowid, title, description, tags) VALUES (?, ?, ?, ?)");
const getSource = db.prepare("SELECT title, description, tags FROM fts_source WHERE rowid = ?");
const putSource = db.prepare("INSERT OR REPLACE INTO fts_source (rowid, title, description, tags) VALUES (?, ?, ?, ?)");
const delSource = db.prepare("DELETE FROM fts_source WHERE rowid = ?");

const indexOne = db.transaction((rowid: number, title: string, description: string, tags: string) => {
  const prev = getSource.get(rowid) as { title: string; description: string; tags: string } | undefined;
  if (prev) del.run(rowid, prev.title, prev.description, prev.tags);
  ins.run(rowid, title, description, tags);
  putSource.run(rowid, title, description, tags);
});

/** (Re)index one audio. Safe to call repeatedly. */
export function indexAudio(audioId: string) {
  const a = getAudio.get(audioId) as { rowid: number; title: string; description: string } | undefined;
  if (!a) return;
  const tags = (getTags.all(audioId) as { name: string }[]).map((t) => t.name).join(" ");
  indexOne(a.rowid, a.title, a.description, tags);
}

/** Remove an audio from the index. Must run BEFORE the audios row is deleted (rowid may be reused). */
export const unindexAudio = db.transaction((rowid: number) => {
  const prev = getSource.get(rowid) as { title: string; description: string; tags: string } | undefined;
  if (prev) { del.run(rowid, prev.title, prev.description, prev.tags); delSource.run(rowid); }
});

/**
 * Rebuild from scratch. Runs at boot when fts_source is empty but audios exist (first start after this
 * table was introduced) so stale tokens from the old read-back bug are flushed.
 */
export function rebuildIndexIfNeeded() {
  const src = (db.prepare("SELECT COUNT(*) c FROM fts_source").get() as { c: number }).c;
  const ready = (db.prepare("SELECT COUNT(*) c FROM audios WHERE status = 'ready'").get() as { c: number }).c;
  if (src > 0 || ready === 0) return;
  console.log(`[search] rebuilding FTS index for ${ready} audio(s)`);
  db.transaction(() => {
    db.prepare("INSERT INTO audios_fts(audios_fts) VALUES('delete-all')").run();
    db.prepare("DELETE FROM fts_source").run();
    for (const r of db.prepare("SELECT id FROM audios WHERE status = 'ready'").all() as { id: string }[]) indexAudio(r.id);
  })();
}

/** Build a safe FTS5 MATCH query from free text: each term becomes a prefix match. */
export function ftsQuery(q: string): string | null {
  const terms = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t) => `"${t}"*`).join(" AND ");
}
