/**
 * Set a temporary password for someone locked out, to pass on so they can sign in and change it.
 * An account with no recovery address can't use /forgot, so this is the only way back in.
 * Usage: npx tsx server/scripts/reset-password.ts <username>
 */
import crypto from "node:crypto";
import { db } from "../db.js";
import { hashPassword } from "../auth.js";

// No 0/O/1/l/I: this gets read off a screen and typed back in.
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const group = () => Array.from({ length: 4 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join("");

const username = process.argv[2];
if (!username) { console.error("usage: reset-password.ts <username>"); process.exit(1); }

const user = db.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE").get(username) as
  { id: string; username: string } | undefined;
if (!user) { console.error(`no user named ${username}`); process.exit(1); }

const password = [group(), group(), group()].join("-");
hashPassword(password).then((hash) => {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  // Existing sessions are left alone: the point is to let them back in, not to lock out a device
  // they're still signed in on. Use the admin ban/unban path instead if an account is compromised.
  console.log(`${user.username}: temporary password is  ${password}`);
  console.log("Tell them to change it in Settings once they're in; it is not stored anywhere else.");
});
