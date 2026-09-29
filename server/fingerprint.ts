/**
 * Codes for logged-out listeners. A listener is counted with HMAC(todaysKey, internet address | browser):
 * - the same all day (UTC), so "one play per listener per day" and the per-day session caps still work;
 * - unrelated from one day to the next, because the key is random and replaced at UTC midnight;
 * - impossible to trace back to an address, because old keys are never kept anywhere (not in the database,
 *   not in backups). Only today's key sits in a file in the data dir, so a restart doesn't split listeners.
 * Raw internet addresses are never stored in the database.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { config } from "./config.js";

const FILE = path.join(config.dataDir, "listener-key.json");
let current: { day: string; key: Buffer } | null = null;

const utcDay = () => new Date().toISOString().slice(0, 10);

function keyFor(day: string): Buffer {
  if (current?.day === day) return current.key;
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8")) as { day?: string; key?: string };
    if (saved.day === day && typeof saved.key === "string" && /^[0-9a-f]{64}$/.test(saved.key)) {
      current = { day, key: Buffer.from(saved.key, "hex") };
      return current.key;
    }
  } catch { /* no key yet, or unreadable: start a fresh one */ }
  const key = crypto.randomBytes(32);
  current = { day, key };
  try {
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ day, key: key.toString("hex") }), { mode: 0o600 });
    fs.renameSync(tmp, FILE); // overwrites, and so forgets, yesterday's key
  } catch (e) {
    console.error("[fingerprint] could not save today's key; codes will change if the server restarts today", e);
  }
  return key;
}

export function fingerprint(req: Request): string {
  const ip = req.ip ?? "";
  const ua = req.headers["user-agent"] ?? "";
  return crypto.createHmac("sha256", keyFor(utcDay())).update(`${ip}|${ua}`).digest("hex").slice(0, 24);
}
