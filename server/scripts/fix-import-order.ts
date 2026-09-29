/**
 * One-off (2026-09-15): earlier imports copied each Soundgasm profile newest-first, so on Sinkdeeper a creator's oldest
 * Soundgasm audio looked like their newest. Soundgasm shows no upload dates, so this keeps each creator's existing set of
 * timestamps and hands them out again in Soundgasm's order (newest there = newest here). Audio no longer on the
 * Soundgasm profile keeps its timestamp. Old values are saved to a JSON backup in the data dir before anything changes.
 * Usage (on the server): npx tsx server/scripts/fix-import-order.ts [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.js";
import { config } from "../config.js";
import { fetchText, parseProfile, parseProfileUrl } from "../importer.js";

const dry = process.argv.includes("--dry");
type Row = { id: string; source_url: string; created_at: number };
const profileOf = (url: string) => url.replace(/\/[^/]+\/?$/, "").toLowerCase();
const changes: { id: string; from: number; to: number }[] = [];
let totalImported = 0, totalMatched = 0;

const creators = db.prepare("SELECT DISTINCT a.user_id AS id, u.username FROM audios a JOIN users u ON u.id = a.user_id WHERE a.source_url IS NOT NULL ORDER BY u.username").all() as { id: string; username: string }[];
for (const c of creators) {
  const rows = db.prepare("SELECT id, source_url, created_at FROM audios WHERE user_id = ? AND source_url IS NOT NULL").all(c.id) as Row[];
  totalImported += rows.length;
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const k = profileOf(r.source_url); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  for (const [profile, group] of groups) {
    const p = parseProfileUrl(group[0].source_url.replace(/\/[^/]+\/?$/, ""));
    if (!p) { console.log(`  ${c.username}: can't read profile for ${profile}, skipped`); continue; }
    let links: { url: string }[] = [];
    try { links = parseProfile(await fetchText(`${p.base}/u/${p.user}`), p.user, p.base); }
    catch (e) { console.log(`  ${c.username}: fetch failed (${e instanceof Error ? e.message : e}), skipped`); continue; }
    const pos = new Map(links.map((l, i) => [l.url.toLowerCase(), i])); // 0 = newest on Soundgasm
    const matched = group.filter((r) => pos.has(r.source_url.toLowerCase()));
    totalMatched += matched.length;
    const stamps = matched.map((r) => r.created_at).sort((a, b) => a - b);
    const oldestFirst = [...matched].sort((a, b) => pos.get(b.source_url.toLowerCase())! - pos.get(a.source_url.toLowerCase())!);
    let n = 0;
    oldestFirst.forEach((r, i) => { if (r.created_at !== stamps[i]) { changes.push({ id: r.id, from: r.created_at, to: stamps[i] }); n++; } });
    console.log(`  ${c.username.padEnd(15)} ${String(matched.length).padStart(3)} of ${String(group.length).padStart(3)} matched on Soundgasm, ${String(n).padStart(3)} to reorder`);
    await new Promise((res) => setTimeout(res, 1500));
  }
}
console.log(`matched ${totalMatched} of ${totalImported} imported audios; ${changes.length} timestamps to swap`);
if (dry) process.exit(0);
if (totalMatched < 0.8 * totalImported) { console.log("fewer than 80% matched; not changing anything"); process.exit(1); }
const backup = path.join(config.dataDir, `import-order-backup-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(backup, JSON.stringify(changes.map(({ id, from }) => ({ id, created_at: from }))), { mode: 0o600 });
const upd = db.prepare("UPDATE audios SET created_at = ? WHERE id = ?");
db.transaction(() => { for (const ch of changes) upd.run(ch.to, ch.id); })();
console.log(`updated ${changes.length}; old values saved to ${backup}`);
