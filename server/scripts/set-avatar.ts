/** Set (or clear) a user's profile photo from the command line. Usage: npx tsx server/scripts/set-avatar.ts <username> <image-file|--clear> */
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.js";
import { paths } from "../config.js";
import { storeAvatar, removeAvatar } from "../avatar.js";

const [username, file] = process.argv.slice(2);
if (!username || !file) { console.error("usage: set-avatar.ts <username> <image-file|--clear>"); process.exit(1); }
const u = db.prepare("SELECT id, avatar FROM users WHERE username = ?").get(username) as { id: string; avatar: string | null } | undefined;
if (!u) { console.error(`no user ${username}`); process.exit(1); }
if (file === "--clear") {
  db.prepare("UPDATE users SET avatar = NULL WHERE id = ?").run(u.id);
  await removeAvatar(u.avatar);
  console.log(`cleared photo for ${username}`);
} else {
  const tmp = path.join(paths.uploads, `avatar-cli-${Date.now()}${path.extname(file)}`);
  fs.copyFileSync(file, tmp); // storeAvatar consumes its input
  const stored = await storeAvatar(tmp, u.id);
  db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(stored, u.id);
  await removeAvatar(u.avatar);
  console.log(`set photo for ${username}: ${stored}`);
}
