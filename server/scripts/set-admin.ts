/** Grant or revoke admin. Usage: npx tsx server/scripts/set-admin.ts <username> [on|off] */
import { db } from "../db.js";
const [username, state = "on"] = process.argv.slice(2);
if (!username) { console.error("usage: set-admin.ts <username> [on|off]"); process.exit(1); }
const r = db.prepare("UPDATE users SET is_admin = ? WHERE username = ?").run(state === "off" ? 0 : 1, username);
console.log(r.changes ? `${username}: admin ${state}` : `no user named ${username}`);
