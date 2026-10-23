/**
 * Single-use links for the optional recovery email: one to verify an address, one to reset a forgotten password.
 * Only a SHA-256 hash of each token is stored, so the database alone can't be used to take over an account.
 * Issuing a new token of a kind cancels that user's earlier ones.
 */
import crypto from "node:crypto";
import { db, now } from "./db.js";

export type TokenKind = "reset" | "verify";
export const RESET_TTL_MS = 60 * 60_000;        // an hour
export const VERIFY_TTL_MS = 24 * 60 * 60_000;  // a day

const hashOf = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function issueToken(userId: string, kind: TokenKind, email: string, ttlMs: number): string {
  const token = crypto.randomBytes(32).toString("base64url");
  db.transaction(() => {
    db.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND kind = ?").run(userId, kind);
    db.prepare("INSERT INTO auth_tokens (token_hash, user_id, kind, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(hashOf(token), userId, kind, email.toLowerCase(), now(), now() + ttlMs);
  })();
  return token;
}

/** Returns the token's row and marks it used, or null if it is unknown, already used or expired. */
export function consumeToken(token: string, kind: TokenKind): { user_id: string; email: string } | null {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  return db.transaction(() => {
    const row = db.prepare("SELECT user_id, email, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = ?")
      .get(hashOf(token), kind) as { user_id: string; email: string; expires_at: number; used_at: number | null } | undefined;
    if (!row || row.used_at || row.expires_at < now()) return null;
    db.prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ?").run(now(), hashOf(token));
    return { user_id: row.user_id, email: row.email };
  })();
}

/** Housekeeping: tokens are useless once expired, and are cleared a day later. */
export function pruneAuthTokens(): number {
  return db.prepare("DELETE FROM auth_tokens WHERE expires_at < ?").run(now() - 86_400_000).changes;
}
