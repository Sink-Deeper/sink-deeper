/** Audience tags like f4m, ff4m, tf4a, nb4a: shown uppercase and highlighted. */
export const isAudienceTag = (t: string) => /^[fmatnbx]{1,5}4[fmatnbx]{1,5}$/i.test(t);
export const displayTag = (t: string) => (isAudienceTag(t) ? t.toUpperCase() : t);
/** Audience tags first, then the rest alphabetically. */
export const sortTags = (tags: string[]) => [...tags].sort((a, b) => Number(isAudienceTag(b)) - Number(isAudienceTag(a)) || a.localeCompare(b));
export const extractBracketTags = (text: string) => {
  const out: string[] = [];
  for (const m of text.matchAll(/[\[{]([^\]}]{1,120})[\]}]/g)) for (const part of m[1].split(/[/,|\[{]/)) out.push(part.trim().toLowerCase());
  for (const m of text.replace(/[\[{][^\]}]{1,120}[\]}]/g, "  ").matchAll(/(?<=\s{2,}|^)((?:[^\[\]{}\s]+ ?){1,4})[\]}]/g)) out.push(m[1].trim().toLowerCase());
  for (const m of text.matchAll(/(?<![a-z0-9])([fmatnbx]{1,5}4[fmatnbx]{1,5})(?![a-z0-9])/gi)) out.push(m[1].toLowerCase());
  return [...new Set(out.filter((t) => t && t.length <= 30 && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(t)))];
};
export const stripBracketTags = (text: string) =>
  text.replace(/[\[{][^\]}]{1,120}[\]}]/g, " ").replace(/(?<=\s{2,}|^)(?:[^\[\]{}\s]+ ?){1,4}[\]}]/g, " ").replace(/[\[\]{}]/g, " ").replace(/(?<![a-z0-9])[fmatnbx]{1,5}4[fmatnbx]{1,5}(?![a-z0-9])/gi, " ").replace(/[ \t]{2,}/g, " ").replace(/^[\s\-–—:|,.]+|[\s\-–—:|,]+$/g, "").trim();

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60), m = Math.floor((sec / 60) % 60), h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}
export function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "m";
}
export function fmtBytes(b: number): string {
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0) + " MB";
  return (b / 1024 ** 3).toFixed(1).replace(/\.0$/, "") + " GB";
}
export function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  const units: [number, string][] = [[60, "s"], [60, "m"], [24, "h"], [7, "d"], [4.35, "w"], [12, "mo"], [Infinity, "y"]];
  let v = diff, label = "s";
  for (const [step, l] of units) { label = l; if (v < step) break; v /= step; }
  return `${Math.max(1, Math.floor(v))}${label} ago`;
}
export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
