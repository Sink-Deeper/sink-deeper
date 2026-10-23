/**
 * Recovery addresses are never stored in readable form. Each one is kept encrypted (AES-256-GCM) under a key that
 * lives only in the server's environment, alongside a keyed hash used for lookups. A stolen database or backup
 * therefore shows neither who has an address nor what it is. A plain hash alone can't work: sending a reset link
 * needs the real address back, so this is reversible on the server and only there.
 */
import crypto from "node:crypto";
import { config } from "./config.js";

const key = () => {
  const k = config.emailKey;
  if (!k) throw new Error("MAIL_ENCRYPTION_KEY is not configured");
  return k;
};

export function encryptEmail(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain.trim().toLowerCase(), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

/** Returns null if the value can't be decrypted (wrong or rotated key, tampering). */
export function decryptEmail(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch { return null; }
}

/** Deterministic keyed hash, so "forgot my password" can find an account by address without ever storing one. */
export const emailLookup = (plain: string): string =>
  crypto.createHmac("sha256", key()).update(plain.trim().toLowerCase()).digest("hex");
