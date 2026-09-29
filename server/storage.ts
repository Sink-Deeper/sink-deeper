/**
 * Media storage backend. Local disk by default; Bunny.net Storage + CDN when BUNNY_* env vars are set.
 * Stream copies are stored under the key `media/<id>.m4a`. Rows record `stream_path` as either an
 * absolute local path or `bunny:<key>`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "./config.js";

const b = config.bunny;
export const BUNNY_PREFIX = "bunny:";
export const bunnyEnabled = !!b;

function storageUrl(key: string) {
  return `https://${b!.storageHost}/${b!.storageZone}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function putObject(localPath: string, key: string): Promise<void> {
  if (!b) throw new Error("Bunny storage not configured");
  const blob = await fs.openAsBlob(localPath);
  const res = await fetch(storageUrl(key), {
    method: "PUT",
    headers: { AccessKey: b.storageKey, "Content-Type": "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) throw new Error(`Bunny upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

export async function deleteObject(key: string): Promise<void> {
  if (!b) return;
  const res = await fetch(storageUrl(key), { method: "DELETE", headers: { AccessKey: b.storageKey } });
  if (!res.ok && res.status !== 404) throw new Error(`Bunny delete failed (${res.status})`);
  await purgeCdn(key);
}

/** Evict a deleted object from the CDN edge. Needs the account API key; without it the cached copy
 *  remains fetchable only by holders of an already-issued signed URL, until that URL expires (≤24 h). */
async function purgeCdn(key: string): Promise<void> {
  if (!b?.apiKey) return;
  const url = `https://${b.cdnHost}/${key}`;
  const res = await fetch(`https://api.bunny.net/purge?url=${encodeURIComponent(url)}&async=false`, {
    method: "POST", headers: { AccessKey: b.apiKey },
  });
  if (!res.ok) console.error(`[storage] CDN purge failed (${res.status}) for ${key}`);
}

/** Fetch an object from the storage zone (used for proxied downloads). Passes Range through. */
export async function getObject(key: string, range?: string, signal?: AbortSignal): Promise<Response> {
  if (!b) throw new Error("Bunny storage not configured");
  return fetch(storageUrl(key), { headers: { AccessKey: b.storageKey, ...(range ? { Range: range } : {}) }, signal });
}

/**
 * Signed CDN URL (Bunny token authentication). `expires` is aligned to the hour so URLs stay
 * identical within an hour, which lets browsers reuse cached responses.
 */
export function signedCdnUrl(key: string, ttlSec = 24 * 3600): string {
  if (!b) throw new Error("Bunny CDN not configured");
  const path = "/" + key;
  const expires = Math.ceil(Date.now() / 1000 / 3600) * 3600 + ttlSec;
  const token = crypto.createHash("sha256").update(b.tokenKey + path + expires).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `https://${b.cdnHost}${path}?token=${token}&expires=${expires}`;
}

export const isBunnyPath = (p: string | null | undefined): p is string => !!p && p.startsWith(BUNNY_PREFIX);
export const bunnyKey = (p: string) => p.slice(BUNNY_PREFIX.length);
