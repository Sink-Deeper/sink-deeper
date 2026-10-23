/**
 * Recovery addresses are never stored, not even encrypted. All that is kept is a keyed hash (HMAC-SHA256 under a
 * server-side key), which is enough to answer one question: "is this the address on file for this account?".
 *
 * That works because the plaintext is only ever needed for the instant a message is sent, and at that instant the
 * person has just typed it: at sign-up, when setting it in Settings, or on the forgotten-password form. So the site
 * can send a reset link to an address it cannot look up, read, or reuse for anything else.
 *
 * The key is a pepper: without it a leaked database can't be attacked by hashing guessed addresses.
 */
import crypto from "node:crypto";
import { config } from "./config.js";

export const normalizeEmail = (plain: string): string => plain.trim().toLowerCase();

export function emailHash(plain: string): string {
  if (!config.emailKey) throw new Error("MAIL_HASH_KEY is not configured");
  return crypto.createHmac("sha256", config.emailKey).update(normalizeEmail(plain)).digest("hex");
}

/** Constant-time comparison, so timing can't be used to probe which addresses are on file. */
export function emailMatches(plain: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(emailHash(plain), "hex"), b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
