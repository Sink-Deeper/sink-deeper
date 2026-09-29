/** Delete an account and everything attached to it (admin tool; the same code the Settings button uses).
 *  Usage: set -a; . /etc/murmur/env; set +a; npx tsx server/scripts/delete-account.ts <username> [--yes] */
import { db } from "../db.js";
import { deleteAccount } from "../account.js";

const [username, ...rest] = process.argv.slice(2);
if (!username) { console.error("usage: delete-account.ts <username> [--yes]"); process.exit(1); }
const u = db.prepare("SELECT id, username, is_admin FROM users WHERE username = ? COLLATE NOCASE").get(username) as { id: string; username: string; is_admin: number } | undefined;
if (!u) { console.error(`no account called ${username}`); process.exit(1); }
const counts = db.prepare(
  "SELECT (SELECT COUNT(*) FROM audios WHERE user_id = ?) audios, (SELECT COUNT(*) FROM comments WHERE user_id = ?) comments, (SELECT COUNT(*) FROM playlists WHERE user_id = ?) sets",
).get(u.id, u.id, u.id) as { audios: number; comments: number; sets: number };
console.log(`${u.username}: ${counts.audios} audios, ${counts.comments} comments, ${counts.sets} playlists${u.is_admin ? " (ADMIN)" : ""}`);
if (!rest.includes("--yes")) { console.log("dry run; pass --yes to delete"); process.exit(0); }
const { audios } = await deleteAccount(u.id);
console.log(`deleted ${u.username} and ${audios} audios`);
