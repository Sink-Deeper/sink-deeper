/**
 * Storage health. Every few minutes this writes, reads back and deletes a tiny probe file on Bunny. One failure can be a
 * blip, so it takes two in a row to count as down; at that point uploads are refused up front (with a clear message
 * rather than a failure after the file is sent), listeners see a banner, and the admin page shows it. The 2026-09-22
 * outage, when a trial credit ran out, was invisible for 11 hours: this is so that can't happen again.
 */
import fs from "node:fs";
import path from "node:path";
import { config, paths } from "./config.js";
import { bunnyEnabled, putObject, getObject, deleteObject } from "./storage.js";

const PROBE_KEY = "health/probe.txt";
const FILE = path.join(config.dataDir, "storage-status.json");
const EVERY_MS = Number(process.env.HEALTH_CHECK_MS) > 0 ? Number(process.env.HEALTH_CHECK_MS) : 5 * 60_000;
const FAILURES_BEFORE_DOWN = 2;

export type StorageStatus = { ok: boolean; checkedAt: number; failingSince: number | null; failures: number; message: string };
let state: StorageStatus = { ok: true, checkedAt: 0, failingSince: null, failures: 0, message: "not checked yet" };

export const storageStatus = (): StorageStatus => state;
/** Only true once storage has failed repeatedly, so a single blip doesn't pause uploads or alarm anyone. */
export const storageDown = (): boolean => bunnyEnabled && state.failures >= FAILURES_BEFORE_DOWN;

export type Probe = () => Promise<void>;
const realProbe: Probe = async () => {
  const tmp = path.join(paths.uploads, `health-${process.pid}.txt`);
  fs.writeFileSync(tmp, `ok ${Date.now()}`);
  try {
    await putObject(tmp, PROBE_KEY);
    const r = await getObject(PROBE_KEY);
    if (!r.ok) throw new Error(`read back returned ${r.status}`);
    await r.arrayBuffer();
    await deleteObject(PROBE_KEY);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
};

export async function checkStorage(probe: Probe = realProbe): Promise<StorageStatus> {
  if (!bunnyEnabled) {
    state = { ok: true, checkedAt: Date.now(), failingSince: null, failures: 0, message: "files are stored on this server" };
    return state;
  }
  try {
    await probe();
    if (state.failures >= FAILURES_BEFORE_DOWN) console.log(`[health] storage is working again after ${Math.round((Date.now() - (state.failingSince ?? Date.now())) / 60000)} min`);
    state = { ok: true, checkedAt: Date.now(), failingSince: null, failures: 0, message: "ok" };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    const failures = state.failures + 1;
    state = { ok: false, checkedAt: Date.now(), failingSince: state.failingSince ?? Date.now(), failures, message };
    console.error(`[health] storage check failed (${failures} in a row): ${message}`);
  }
  try { fs.writeFileSync(FILE, JSON.stringify(state)); } catch { /* status file is a convenience, not critical */ }
  return state;
}

export function startHealthChecks(): void {
  void checkStorage();
  setInterval(() => void checkStorage(), EVERY_MS).unref();
}
