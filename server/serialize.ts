import { db } from "./db.js";
import { config } from "./config.js";
import { isAudienceTag } from "./util.js";
import type { User } from "./auth.js";
import path from "node:path";
import { isBunnyPath, bunnyKey, signedCdnUrl } from "./storage.js";

/** Public URL for a stored profile photo (signed CDN URL on Bunny, local media route otherwise). */
export function avatarUrl(a: string | null | undefined): string | null {
  if (!a) return null;
  return isBunnyPath(a) ? signedCdnUrl(bunnyKey(a)) : `/media/avatars/${path.basename(a)}`;
}

export type AudioRow = {
  id: string; user_id: string; slug: string; title: string; description: string;
  visibility: "public" | "unlisted" | "private"; status: "processing" | "ready" | "failed"; error: string | null;
  original_filename: string; original_path: string | null; stream_path: string | null;
  size_bytes: number; duration_sec: number; peaks: string | null; plays: number; likes_count: number;
  comments_count: number; downloadable: number; downloads: number; created_at: number; updated_at: number;
  username: string; display_name: string; banned: number; user_avatar: string | null;
  group_id?: string | null; variant_label?: string | null;
};

const AUDIO_COLS = "a.*, u.username, u.display_name, u.banned, u.avatar AS user_avatar";
const AUDIO_FROM = "FROM audios a JOIN users u ON u.id = a.user_id";
export const AUDIO_SELECT = `\n  ${AUDIO_COLS}\n  ${AUDIO_FROM}`;

/**
 * Listing query (feed, search, tags, profiles). With versions enabled, a group of versions shows once: the best
 * member that passes the filters (the main version if it qualifies, else the oldest), so filtering by F4A still finds
 * the F4A version of a work whose main version is F4M. Parameters: the caller's, then LIMIT, then OFFSET.
 */
export function listingSql(where: string, order: string, join = ""): string {
  if (!config.features.versions) return `SELECT ${AUDIO_SELECT} ${join} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`;
  return `SELECT * FROM (
      SELECT ${AUDIO_COLS}, ROW_NUMBER() OVER (PARTITION BY COALESCE(a.group_id, a.id) ORDER BY (a.group_id = a.id) DESC, a.created_at ASC) AS vrn
      ${AUDIO_FROM} ${join} WHERE ${where}
    ) a WHERE a.vrn = 1 ORDER BY ${order} LIMIT ? OFFSET ?`;
}
/** SQL fragment for listings: only public, processed audio from non-banned creators */
export const PUBLIC_WHERE = `a.visibility='public' AND a.status='ready' AND u.banned = 0`;

const tagsFor = db.prepare(
  "SELECT t.name FROM audio_tags at JOIN tags t ON t.id = at.tag_id WHERE at.audio_id = ? ORDER BY t.name",
);
const likedBy = db.prepare("SELECT 1 FROM likes WHERE user_id = ? AND audio_id = ?");

const groupMembers = db.prepare(
  "SELECT id, slug, title, variant_label, visibility, status FROM audios WHERE group_id = ? ORDER BY (group_id = id) DESC, created_at ASC",
);
/** Switch options for a grouped audio: members the viewer may see, labelled. Undefined when there's nothing to switch. */
export function versionsFor(groupId: string | null | undefined, isOwner: boolean) {
  if (!config.features.versions || !groupId) return undefined;
  const rows = (groupMembers.all(groupId) as { id: string; slug: string; title: string; variant_label: string | null; visibility: string; status: string }[])
    .filter((m) => isOwner ? m.status !== "failed" : m.visibility === "public" && m.status === "ready");
  if (rows.length < 2) return undefined;
  return rows.map((m, i) => ({ id: m.id, slug: m.slug, label: versionLabel(m.id, m.variant_label, i, m.title) }));
}
/** Custom label, else the audience tag (F4A), else an audience marker in the title ("4F Version" -> 4F), else a number. */
export function versionLabel(audioId: string, custom: string | null | undefined, index: number, title = ""): string {
  if (custom?.trim()) return custom.trim();
  const audience = (tagsFor.all(audioId) as { name: string }[]).map((t) => t.name).find(isAudienceTag);
  if (audience) return audience.toUpperCase();
  const inTitle = /(?<![a-z0-9])([fmatnbx]{0,5}4[fmatnbx]{1,5})(?![a-z0-9])/i.exec(title)?.[1];
  return inTitle ? inTitle.toUpperCase() : `Version ${index + 1}`;
}

export function serializeAudio(a: AudioRow, viewer: User | null, opts: { peaks?: boolean } = {}) {
  // Admins get owner-level controls (edit/delete/download) everywhere
  const isOwner = viewer?.id === a.user_id || !!viewer?.is_admin;
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    description: a.description,
    visibility: a.visibility,
    status: a.status,
    error: isOwner ? a.error : undefined,
    duration: a.duration_sec,
    size: a.size_bytes,
    plays: a.plays,
    likes: a.likes_count,
    comments: a.comments_count,
    downloads: a.downloads,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    tags: (tagsFor.all(a.id) as { name: string }[]).map((t) => t.name),
    user: { id: a.user_id, username: a.username, displayName: a.display_name, avatarUrl: avatarUrl(a.user_avatar) },
    streamUrl: a.status !== "ready" ? null : isBunnyPath(a.stream_path) ? signedCdnUrl(bunnyKey(a.stream_path)) : `/media/${a.id}.m4a`,
    downloadable: !!a.downloadable,
    downloadUrl: a.status === "ready" && (a.downloadable || isOwner) ? `/media/${a.id}.m4a?download=1` : null,
    hasOriginal: !!a.original_path,
    peaks: opts.peaks && a.peaks ? (JSON.parse(a.peaks) as number[]) : undefined,
    liked: viewer ? !!likedBy.get(viewer.id, a.id) : false,
    isOwner,
    versions: versionsFor(a.group_id, isOwner),
  };
}

export type ApiAudio = ReturnType<typeof serializeAudio>;

export function serializeUser(u: User & { audio_count?: number; followers?: number; following?: number }, viewer: User | null, extra: Record<string, unknown> = {}) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: avatarUrl(u.avatar),
    bio: u.bio,
    createdAt: u.created_at,
    audioCount: u.audio_count ?? 0,
    followers: u.followers ?? 0,
    following: u.following ?? 0,
    isSelf: viewer?.id === u.id,
    isAdmin: viewer?.id === u.id ? !!u.is_admin : undefined,
    banned: viewer?.is_admin ? !!u.banned : undefined,
    ...extra,
  };
}

export function canView(a: AudioRow & { banned?: number }, viewer: User | null): boolean {
  if (viewer?.is_admin || viewer?.id === a.user_id) return true;
  if (a.banned) return false;
  return a.visibility !== "private";
}
