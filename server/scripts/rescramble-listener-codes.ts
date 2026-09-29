/**
 * One-off: listener codes written before server/fingerprint.ts were an unkeyed hash of address + browser, which could be
 * reversed by anyone holding the database. This maps every such code through HMAC with a random key that is used once and
 * never stored. The same old code always maps to the same new one, so every count and stat stays exactly the same, but
 * nothing can be traced back to an address any more. Logged-in rows (fingerprint = user id) are untouched.
 * Run with the service stopped:  npx tsx server/scripts/rescramble-listener-codes.ts [--dry]
 */
import crypto from "node:crypto";
import { db } from "../db.js";

const dry = process.argv.includes("--dry");
const key = crypto.randomBytes(32); // lives only in this process
db.function("rescramble", { deterministic: true }, (fp: unknown) => crypto.createHmac("sha256", key).update(String(fp)).digest("hex").slice(0, 24));
const ANON = "fingerprint NOT IN (SELECT id FROM users)";
const tables = ["play_events", "download_events", "listens"] as const;

const snapshot = () => Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) rows, COUNT(DISTINCT fingerprint) people, COUNT(DISTINCT audio_id || '|' || fingerprint || '|' || day) keys FROM ${t}`).get()]));
const before = snapshot();
const anonRows = Object.fromEntries(tables.map((t) => [t, (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${ANON}`).get() as { c: number }).c]));
console.log("before:", JSON.stringify(before));
console.log("anonymous rows to rescramble:", JSON.stringify(anonRows));
if (dry) process.exit(0);

// Verify inside the transaction: if any count moved, throw so nothing is written
try {
  db.transaction(() => {
    for (const t of tables) db.prepare(`UPDATE ${t} SET fingerprint = rescramble(fingerprint) WHERE ${ANON}`).run();
    const after = snapshot();
    console.log("after: ", JSON.stringify(after));
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("counts changed; rolled back");
  })();
  console.log("OK: every count is unchanged");
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
}
