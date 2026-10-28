/**
 * Mint a single-use password reset link for someone locked out, to send them directly.
 * An account with no recovery address can't use /forgot, so this is the only way back in.
 * Prefer this over reset-password.ts: they choose their own password and nothing is sent in the clear.
 * Usage: npx tsx server/scripts/reset-link.ts <username> [hours]
 */
import { db } from "../db.js";
import { issueToken } from "../recovery.js";
import { linkTo } from "../mail.js";

const [username, hoursArg = "24"] = process.argv.slice(2);
const hours = Number(hoursArg);
if (!username || !Number.isFinite(hours) || hours <= 0 || hours > 168) {
  console.error("usage: reset-link.ts <username> [hours, 1-168]");
  process.exit(1);
}

const user = db.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE").get(username) as
  { id: string; username: string } | undefined;
if (!user) { console.error(`no user named ${username}`); process.exit(1); }

// No address is involved, so the token's email column stays empty; /reset never reads it.
const token = issueToken(user.id, "reset", "", hours * 60 * 60_000);
console.log(`${user.username}: reset link, good once and for ${hours}h\n`);
console.log(linkTo(`/reset-password?token=${token}`));
console.log("\nIssuing another link cancels this one. Their sessions are only cleared once it is used.");
