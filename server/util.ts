import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
export function id(len = 12): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function slugify(input: string, fallback = "untitled"): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

/** Lowercase, no leading '#', internal whitespace collapsed, '/' (unroutable) folded to '-', edges trimmed of punctuation. */
export function normalizeTag(t: string): string {
  return t
    .trim().toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\/\\]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-,.:;]+|[\s\-,.:;]+$/g, "")
    .slice(0, 40)
    .trim();
}

/** Page number from a query param, clamped so OFFSET stays sane. */
export function pageParam(q: unknown, max = 1000): number {
  const n = parseInt(String(q ?? "1"), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
}

/** Slugs that would collide with profile sub-routes (/u/:name/likes etc.) */
export const RESERVED_SLUGS = new Set(["likes", "sets", "followers", "following", "about", "edit", "settings"]);

/**
 * Audience tags: X4Y where each side is 1-5 letters (F4M, M4F, FF4M, TF4A, NB4A, MMF4F, A4A...).
 * Broad on purpose; the digit 4 between two short letter runs is the whole convention.
 */
// Each side is built from the letters used in the convention (F, M, A, T, N, B, X), which keeps words like "for4you" out
export const AUDIENCE_RE = /^[fmatnbx]{1,5}4[fmatnbx]{1,5}$/i;
export const isAudienceTag = (t: string) => AUDIENCE_RE.test(t.trim());

/** Tags from a text: every [bracketed] part (split on / , |) plus any standalone X4Y token. */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[\[{]([^\]}]{1,120})[\]}]/g)) for (const part of m[1].split(/[/,|\[{]/)) out.push(part.trim().toLowerCase());
  for (const m of text.replace(/[\[{][^\]}]{1,120}[\]}]/g, "  ").matchAll(/(?<=\s{2,}|^)((?:[^\[\]{}\s]+ ?){1,4})[\]}]/g)) out.push(m[1].trim().toLowerCase());
  for (const m of text.matchAll(/(?<![a-z0-9])([fmatnbx]{1,5}4[fmatnbx]{1,5})(?![a-z0-9])/gi)) out.push(m[1].toLowerCase());
  return parseTags(out.filter((t) => t && t.length <= 30 && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(t)));
}

/** Remove [bracketed] parts and standalone X4Y tokens, then tidy leftover punctuation/whitespace. */
export function stripTags(text: string, opts: { audienceTokens?: boolean } = { audienceTokens: true }): string {
  let s = text.replace(/[\[{][^\]}]{1,120}[\]}]/g, " ");
  // Orphan closers left by typos ("[Lips] Tongue] [Saliva]"): a short run right after a removed group up to a lone ] or }
  s = s.replace(/(?<=\s{2,}|^)(?:[^\[\]{}\s]+ ?){1,4}[\]}]/g, " ").replace(/[\[\]{}]/g, " ");
  if (opts.audienceTokens !== false) s = s.replace(/(?<![a-z0-9])[fmatnbx]{1,5}4[fmatnbx]{1,5}(?![a-z0-9])/gi, " ");
  s = s.replace(/^[ \t]*tags?[ \t]*:[ \t]*$/gim, ""); // a "Tags:" label left with nothing after it
  return s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s\-–—:|,.]+|[\s\-–—:|,]+$/g, "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseTags(raw: unknown): string[] {
  let list: string[] = [];
  if (Array.isArray(raw)) list = raw.map(String);
  else if (typeof raw === "string") list = raw.split(/[,\n]/);
  const out = new Set<string>();
  // A pasted "[f4a] [teasing] [joi]" is several tags, not one: split on brackets before the 40-character cut applies
  const pieces = list.flatMap((t) => (/[\[\]{}]/.test(t) ? t.split(/[\[\]{},|]+/) : [t]));
  for (const t of pieces) {
    const n = normalizeTag(t);
    if (n) out.add(n);
    if (out.size >= 50) break;
  }
  return [...out];
}

export function fmtBytes(b: number): string {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
