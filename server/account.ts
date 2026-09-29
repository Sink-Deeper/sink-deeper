/**
 * Deleting an account. Removes the user row, which cascades to their audio, playlists, comments, likes, follows,
 * sessions and imports, after clearing those audios out of the search index (it is a separate, contentless table).
 * Stored audio files and the profile photo are deleted afterwards. `action_ips` is deliberately left alone: those
 * records exist for abuse and legal requests and age out on their own after 90 days, as the FAQ says.
 */
import fs from "node:fs";
import { db } from "./db.js";
import { unindexAudio } from "./search.js";
import { isBunnyPath, bunnyKey, deleteObject } from "./storage.js";
import { removeAvatar } from "./avatar.js";

export async function deleteAccount(userId: string): Promise<{ audios: number }> {
  const audios = db.prepare("SELECT id, rowid, stream_path, original_path FROM audios WHERE user_id = ?").all(userId) as
    { id: string; rowid: number; stream_path: string | null; original_path: string | null }[];
  const avatar = (db.prepare("SELECT avatar FROM users WHERE id = ?").get(userId) as { avatar: string | null } | undefined)?.avatar ?? null;

  db.transaction(() => {
    for (const a of audios) unindexAudio(a.rowid);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();

  // Files come last: if any of this fails the account is already gone, and a leftover file is only wasted space
  for (const a of audios) {
    for (const p of [a.stream_path, a.original_path]) {
      if (!p) continue;
      if (isBunnyPath(p)) {
        try { await deleteObject(bunnyKey(p)); }
        catch (e) { console.error(`[account] could not delete stored file for audio ${a.id}:`, e); }
      } else fs.rmSync(p, { force: true });
    }
  }
  await removeAvatar(avatar).catch((e) => console.error("[account] could not delete profile photo:", e));
  return { audios: audios.length };
}
