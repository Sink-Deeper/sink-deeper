/**
 * Versions: the same work uploaded more than once for different audiences (F4M, F4A, M4F...) or cuts (loop, preview).
 * Members share `group_id`, which is the id of the main version (the one listings prefer). Every member stays a
 * normal audio with its own link, stats, likes and comments. Only one creator's own audios can be grouped.
 */
import { db } from "./db.js";
import { HttpError } from "./util.js";
import { versionLabel } from "./serialize.js";

export const MAX_VERSIONS = 12;

type Row = { id: string; user_id: string; slug: string; title: string; group_id: string | null; variant_label: string | null; visibility: string; status: string; created_at: number };
const byId = db.prepare("SELECT id, user_id, slug, title, group_id, variant_label, visibility, status, created_at FROM audios WHERE id = ?");
const members = db.prepare("SELECT id, user_id, slug, title, group_id, variant_label, visibility, status, created_at FROM audios WHERE group_id = ? ORDER BY (group_id = id) DESC, created_at ASC");

const load = (id: string) => { const r = byId.get(id) as Row | undefined; if (!r) throw new HttpError(404, "Audio not found"); return r; };

/** Put `otherId` (and anything already grouped with it) into the same group as `id`. */
export const linkVersions = db.transaction((id: string, otherId: string) => {
  if (id === otherId) throw new HttpError(400, "That's the same audio");
  const a = load(id), b = load(otherId);
  if (a.user_id !== b.user_id) throw new HttpError(400, "Only your own uploads can be versions of each other");
  const g = a.group_id ?? a.id, h = b.group_id ?? b.id;
  if (g === h) return;
  const size = (db.prepare("SELECT COUNT(*) c FROM audios WHERE group_id IN (?, ?) OR id IN (?, ?)").get(g, h, a.id, b.id) as { c: number }).c;
  if (size > MAX_VERSIONS) throw new HttpError(400, `A work can have at most ${MAX_VERSIONS} versions`);
  db.prepare("UPDATE audios SET group_id = ? WHERE group_id IN (?, ?) OR id IN (?, ?)").run(g, g, h, a.id, b.id);
});

/** Take one audio out of its group. If it was the main version, the oldest remaining one takes over; a group of one dissolves. */
export const detachVersion = db.transaction((id: string) => {
  const a = load(id);
  if (!a.group_id) return;
  const g = a.group_id;
  db.prepare("UPDATE audios SET group_id = NULL, variant_label = NULL WHERE id = ?").run(a.id);
  const rest = db.prepare("SELECT id FROM audios WHERE group_id = ? ORDER BY created_at ASC").all(g) as { id: string }[];
  if (rest.length === 1) db.prepare("UPDATE audios SET group_id = NULL, variant_label = NULL WHERE id = ?").run(rest[0].id);
  else if (rest.length > 1 && a.id === g) db.prepare("UPDATE audios SET group_id = ? WHERE group_id = ?").run(rest[0].id, g);
});

/** Make this version the one listings show first. */
export const makeMainVersion = db.transaction((id: string) => {
  const a = load(id);
  if (!a.group_id) throw new HttpError(400, "This audio isn't part of a set of versions");
  db.prepare("UPDATE audios SET group_id = ? WHERE group_id = ?").run(a.id, a.group_id);
});

export function setVersionLabel(id: string, label: string) {
  db.prepare("UPDATE audios SET variant_label = ? WHERE id = ?").run(label.trim().slice(0, 20) || null, id);
}

// ---- suggestions -------------------------------------------------------------------------------------------------
// Words that describe the cut or audience rather than the work, so "Pussy Fixation - 4F Version" and
// "Pussy Fixation (4A Version)" come out identical.
const NOISE = new Set(["version", "ver", "edition", "cut", "loop", "looped", "only", "full", "preview", "audio", "session", "the", "a", "an", "and", "of", "for", "to", "with", "ft", "feat"]);
function titleKey(t: string): Set<string> {
  const s = t.toLowerCase()
    .replace(/[\[{(][^\]})]{0,120}[\]})]/g, " ")
    .replace(/(?<![a-z0-9])[fmatnbx]{0,5}4[fmatnbx]{1,5}(?![a-z0-9])/g, " ") // F4M, 4A, 4F ...
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(s.split(" ").filter((w) => w && !NOISE.has(w)));
}
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Everything the edit page needs: this audio's group and likely matches among the owner's other uploads. */
export function versionsView(id: string, q = "") {
  const a = load(id);
  const group = a.group_id ? (members.all(a.group_id) as Row[]) : [a];
  const inGroup = new Set(group.map((m) => m.id));
  const mine = db.prepare("SELECT id, user_id, slug, title, group_id, variant_label, visibility, status, created_at FROM audios WHERE user_id = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 2000").all(a.user_id) as Row[];
  const key = titleKey(a.title);
  const needle = q.trim().toLowerCase();
  const candidates = mine
    .filter((m) => !inGroup.has(m.id))
    .map((m) => ({ m, score: similarity(key, titleKey(m.title)) }))
    .filter(({ m, score }) => (needle ? m.title.toLowerCase().includes(needle) : score >= 0.6))
    .sort((x, y) => y.score - x.score || y.m.created_at - x.m.created_at)
    .slice(0, needle ? 20 : 8)
    .map(({ m, score }) => ({ id: m.id, slug: m.slug, title: m.title, grouped: !!m.group_id, match: Math.round(score * 100) }));
  return {
    main: a.group_id ?? a.id,
    members: group.map((m, i) => ({
      id: m.id, slug: m.slug, title: m.title, visibility: m.visibility, status: m.status,
      label: versionLabel(m.id, m.variant_label, i, m.title), customLabel: m.variant_label ?? "", isMain: (a.group_id ?? a.id) === m.id,
    })),
    candidates,
  };
}
