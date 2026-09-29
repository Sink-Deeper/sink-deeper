import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, now } from "./db.js";
import { paths, config } from "./config.js";
import { indexAudio } from "./search.js";
import { bunnyEnabled, putObject, deleteObject, BUNNY_PREFIX } from "./storage.js";

export const PEAK_COUNT = 1200;

/** Run a child process with a hard timeout; on timeout the process is killed and the promise rejects. */
export function run(cmd: string, args: string[], onStdout?: (chunk: Buffer) => void, timeoutMs = config.ffmpegTimeoutMs): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, timeoutMs);
    p.stdout.on("data", (c: Buffer) => onStdout?.(c));
    p.stderr.on("data", (c: Buffer) => { if (stderr.length < 8192) stderr += c.toString(); });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 60000)} min`));
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** What ffprobe sees: enough to decide whether the file can be copied through untouched. */
export type Probe = { duration: number; codec: string | null; format: string; audioStreams: number; bitrate: number | null; sampleRate: number | null };
export async function probe(file: string): Promise<Probe> {
  let out = "";
  const { code } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,format_name,bit_rate:stream=codec_type,codec_name,bit_rate,sample_rate", "-of", "json", file],
    (c) => (out += c.toString()),
    60_000,
  );
  if (code !== 0) throw new Error("Could not read this file; is it audio?");
  let j: any;
  try { j = JSON.parse(out); } catch { throw new Error("Could not read this file; is it audio?"); }
  const duration = parseFloat(j.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read duration; is this an audio file?");
  const audio = (j.streams ?? []).filter((st: any) => st.codec_type === "audio");
  const a = audio[0];
  const num = (v: unknown) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) && n > 0 ? n : null; };
  return {
    duration,
    codec: a?.codec_name ?? null,
    format: String(j.format?.format_name ?? ""),
    audioStreams: audio.length,
    bitrate: num(a?.bit_rate) ?? num(j.format?.bit_rate),
    sampleRate: num(a?.sample_rate),
  };
}

/**
 * AAC that is already in an MP4-family container (what Soundgasm serves, what phones record) is copied through
 * bit-for-bit instead of being re-encoded. Anything else, or anything oversized, goes through the encoder.
 */
export const COPY_MAX_BITRATE = 256_000;
export function canCopy(p: Probe): boolean {
  return p.codec === "aac" && p.audioStreams === 1 && /\b(mov|mp4|m4a|3gp)\b/.test(p.format)
    && (p.bitrate ?? Infinity) <= COPY_MAX_BITRATE && (p.sampleRate ?? 0) <= 48_000;
}

/** Remux without decoding: same audio bytes, clean MP4 wrapper, faststart, no metadata or cover art. */
export async function remux(input: string, output: string, maxDurationSec: number, maxOutputBytes: number): Promise<void> {
  const { code, stderr } = await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
    "-t", String(Math.ceil(maxDurationSec)),
    "-i", input,
    "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-fs", String(maxOutputBytes),
    output,
  ]);
  if (code !== 0) throw new Error("Remux failed: " + stderr.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 200));
}

export async function probeDuration(file: string): Promise<number> {
  let out = "";
  const { code } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    (c) => (out += c.toString()),
    60_000,
  );
  if (code !== 0) throw new Error("Could not read this file; is it audio?");
  const d = parseFloat(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not read duration; is this an audio file?");
  return d;
}

/**
 * Transcode to AAC. `-t` caps the decoded duration and `-fs` caps the output size so a crafted input
 * can't write unbounded data; the process is also killed on timeout.
 */
export async function transcode(input: string, output: string, maxDurationSec: number, maxOutputBytes: number): Promise<void> {
  const { code, stderr } = await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
    "-t", String(Math.ceil(maxDurationSec)),
    "-i", input,
    "-vn", "-sn", "-dn", "-map_metadata", "-1",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-movflags", "+faststart",
    "-fs", String(maxOutputBytes),
    output,
  ]);
  if (code !== 0) throw new Error("Transcode failed: " + stderr.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 200));
}

/** Decode to 8kHz mono 16-bit PCM and bucket into PEAK_COUNT normalized peaks (0..1). */
export async function computePeaks(input: string, durationSec: number): Promise<number[]> {
  const sampleRate = 8000;
  const totalSamples = Math.max(1, Math.floor(durationSec * sampleRate));
  const perBucket = Math.max(1, Math.floor(totalSamples / PEAK_COUNT));
  const peaks = new Float32Array(PEAK_COUNT);
  let bucket = 0, inBucket = 0, max = 0, leftover: Buffer | null = null;

  const { code } = await run(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", input, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-"],
    (chunk) => {
      const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i)) / 32768;
        if (v > max) max = v;
        if (++inBucket >= perBucket) {
          if (bucket < PEAK_COUNT) peaks[bucket] = max;
          bucket++; inBucket = 0; max = 0;
        }
      }
      leftover = usable < buf.length ? buf.subarray(usable) : null;
    },
  );
  if (code !== 0) throw new Error("Peak analysis failed");
  if (bucket < PEAK_COUNT && inBucket > 0) peaks[bucket] = max;
  // Normalize so the loudest bucket hits 1.0, round to 3 decimals
  let top = 0;
  for (const p of peaks) if (p > top) top = p;
  const scale = top > 0 ? 1 / top : 1;
  return Array.from(peaks, (p) => Math.round(p * scale * 1000) / 1000);
}

const queue: string[] = [];
const queued = new Set<string>();
let running = false;

export function enqueueProcessing(audioId: string) {
  if (queued.has(audioId)) return;
  queued.add(audioId);
  queue.push(audioId);
  void drain();
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const audioId = queue.shift()!;
    queued.delete(audioId);
    try {
      await processAudio(audioId);
    } catch (err) {
      console.error(`[media] processing ${audioId} failed:`, err);
    }
  }
  running = false;
}

const rowExists = db.prepare("SELECT 1 FROM audios WHERE id = ?");

async function processAudio(audioId: string) {
  const row = db.prepare("SELECT id, original_path, original_filename FROM audios WHERE id = ? AND status = 'processing'").get(audioId) as
    | { id: string; original_path: string | null; original_filename: string }
    | undefined;
  if (!row || !row.original_path) return;
  const input = row.original_path;
  const streamPath = path.join(paths.media, `${audioId}.m4a`);
  const cleanupInput = () => fs.rmSync(input, { force: true });
  // The row may be deleted by its owner while we're working; check between steps and clean up after ourselves.
  const gone = () => !rowExists.get(audioId);

  try {
    if (!fs.existsSync(input)) throw new Error("Upload file missing");
    const info = await probe(input);
    const duration = info.duration;
    if (duration > config.maxDurationSec) throw new Error(`Audio is longer than the ${Math.round(config.maxDurationSec / 60)} minute limit`);
    if (gone()) { cleanupInput(); return; }

    if (canCopy(info)) {
      // Already AAC in an MP4 container: keep the audio exactly as uploaded. Fall back to encoding if the remux
      // trips over something odd in the container.
      try { await remux(input, streamPath, config.maxDurationSec, config.maxUploadBytes); }
      catch (e) { console.warn(`[media] ${audioId}: remux failed (${e instanceof Error ? e.message : e}); encoding instead`); await transcode(input, streamPath, config.maxDurationSec, config.maxUploadBytes); }
    } else {
      await transcode(input, streamPath, config.maxDurationSec, config.maxUploadBytes);
    }
    if (gone()) { cleanupInput(); fs.rmSync(streamPath, { force: true }); return; }

    const peaks = await computePeaks(streamPath, duration);
    const size = fs.statSync(streamPath).size;
    if (size === 0) throw new Error("Transcode produced an empty file");

    // Ship the stream copy to Bunny and drop the local file; rows then point at bunny:<key>
    let storedPath = streamPath;
    if (bunnyEnabled) {
      const key = `media/${audioId}.m4a`;
      await putObject(streamPath, key);
      fs.rmSync(streamPath, { force: true });
      storedPath = BUNNY_PREFIX + key;
      if (gone()) { cleanupInput(); deleteObject(key).catch(() => {}); return; }
    } else if (gone()) { cleanupInput(); fs.rmSync(streamPath, { force: true }); return; }

    let keptOriginal: string | null = null;
    if (config.keepOriginals) {
      const ext = path.extname(row.original_filename).toLowerCase() || ".bin";
      keptOriginal = path.join(paths.originals, `${audioId}${ext}`);
      fs.renameSync(input, keptOriginal);
    } else {
      cleanupInput();
    }

    const r = db.prepare(
      `UPDATE audios SET status='ready', stream_path=?, original_path=?, duration_sec=?, peaks=?, size_bytes=?, updated_at=? WHERE id=? AND status='processing'`,
    ).run(storedPath, keptOriginal, duration, JSON.stringify(peaks), size, now(), audioId);
    if (r.changes === 0) {
      // Deleted in the last instant: undo the storage side effects
      if (storedPath.startsWith(BUNNY_PREFIX)) deleteObject(storedPath.slice(BUNNY_PREFIX.length)).catch(() => {});
      else fs.rmSync(storedPath, { force: true });
      if (keptOriginal) fs.rmSync(keptOriginal, { force: true });
      return;
    }
    indexAudio(audioId);
  } catch (err) {
    // A failed upload keeps its row (so the owner sees why) but no bytes: the raw file is removed and
    // size_bytes zeroed. It still counts toward the daily upload number.
    fs.rmSync(streamPath, { force: true });
    cleanupInput();
    db.prepare(`UPDATE audios SET status='failed', error=?, original_path=NULL, size_bytes=0, updated_at=? WHERE id=? AND status='processing'`).run(
      (err instanceof Error ? err.message : String(err)).slice(0, 500),
      now(),
      audioId,
    );
  }
}

/** On boot, re-queue anything left in 'processing' from a previous crash and sweep orphaned temp files. */
export function resumeProcessing() {
  const rows = db.prepare("SELECT id FROM audios WHERE status='processing'").all() as { id: string }[];
  for (const r of rows) enqueueProcessing(r.id);
  sweepUploads();
  setInterval(sweepUploads, 6 * 3_600_000).unref();
}

/** Remove files in uploads/ that no row references and that are older than an hour (importer temp files are young). */
export function sweepUploads() {
  try {
    const referenced = new Set((db.prepare("SELECT original_path FROM audios WHERE original_path IS NOT NULL").all() as { original_path: string }[]).map((r) => r.original_path));
    const cutoff = Date.now() - 3_600_000;
    let removed = 0;
    for (const name of fs.readdirSync(paths.uploads)) {
      const full = path.join(paths.uploads, name);
      if (referenced.has(full)) continue;
      const st = fs.statSync(full, { throwIfNoEntry: false });
      if (!st || !st.isFile() || st.mtimeMs > cutoff) continue;
      fs.rmSync(full, { force: true });
      removed++;
    }
    if (removed) console.log(`[media] swept ${removed} orphaned upload file(s)`);
  } catch (e) {
    console.error("[media] sweep failed", e);
  }
}
