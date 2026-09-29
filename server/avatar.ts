/**
 * Profile photos. The upload is re-encoded by ffmpeg into a square 512px WebP (first frame only, no
 * metadata), so whatever came in, what we store and serve is a plain image we produced ourselves.
 * Stored like media: on Bunny under avatars/<key> when configured, otherwise in data/avatars.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { id } from "./util.js";
import { run } from "./media.js";
import { bunnyEnabled, putObject, deleteObject, isBunnyPath, bunnyKey, BUNNY_PREFIX } from "./storage.js";

export const AVATAR_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic"]);
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
const SIZE = 512;

/** Re-encode `input` into a square WebP and store it. Returns the stored path (`bunny:avatars/..` or local). */
export async function storeAvatar(input: string, userId: string): Promise<string> {
  const name = `${userId}-${id(8)}.webp`;
  const tmp = path.join(paths.uploads, `avatar-${name}`);
  try {
    const { code, stderr } = await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", input, "-frames:v", "1", "-an", "-sn", "-dn", "-map_metadata", "-1",
      "-vf", `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase,crop=${SIZE}:${SIZE}`,
      "-c:v", "libwebp", "-quality", "85", tmp,
    ], undefined, 30_000);
    if (code !== 0 || !fs.existsSync(tmp)) throw new Error("That file couldn't be read as an image" + (stderr ? "" : ""));
    if (bunnyEnabled) {
      const key = `avatars/${name}`;
      await putObject(tmp, key);
      fs.rmSync(tmp, { force: true });
      return BUNNY_PREFIX + key;
    }
    const dest = path.join(paths.avatars, name);
    fs.renameSync(tmp, dest);
    return dest;
  } finally {
    fs.rmSync(input, { force: true });
    fs.rmSync(tmp, { force: true });
  }
}

export async function removeAvatar(stored: string | null | undefined): Promise<void> {
  if (!stored) return;
  if (isBunnyPath(stored)) { await deleteObject(bunnyKey(stored)).catch(() => {}); return; }
  if (path.dirname(stored) === paths.avatars) fs.rmSync(stored, { force: true });
}
