/**
 * Replace the stored copy of every Soundgasm import with a bit-perfect one. Early imports were re-encoded; this
 * re-downloads each source file and remuxes it (audio bytes untouched), keeping the audio row, slug, plays and
 * likes. Idempotent and resumable: rows already recopied (stream key ending in "-lossless.m4a") are skipped.
 * Usage (on the server): set -a; . /etc/murmur/env; set +a; npx tsx server/scripts/recopy-imports.ts [--dry] [--limit N]
 */
import fs from "node:fs";
import path from "node:path";
import { db, now } from "../db.js";
import { config, paths } from "../config.js";
import { fetchText, parseAudioPage, downloadTo } from "../importer.js";
import { probe, canCopy, remux, computePeaks } from "../media.js";
import { bunnyEnabled, putObject, deleteObject, isBunnyPath, bunnyKey, BUNNY_PREFIX } from "../storage.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
const DELAY = 1500;

type Row = { id: string; title: string; source_url: string; stream_path: string; size_bytes: number; peaks: string | null };
const rows = db.prepare(
  "SELECT id, title, source_url, stream_path, size_bytes, peaks FROM audios WHERE source_url IS NOT NULL AND status = 'ready' AND stream_path IS NOT NULL AND stream_path NOT LIKE '%-lossless.m4a' ORDER BY created_at",
).all() as Row[];
console.log(`${rows.length} imported audio(s) to recopy${dry ? " (dry run)" : ""}`);

let ok = 0, skipped = 0, failed = 0, n = 0;
for (const r of rows) {
  if (n++ >= limit) break;
  const tmpIn = path.join(paths.uploads, `recopy-${r.id}.m4a`);
  const tmpOut = path.join(paths.uploads, `recopy-${r.id}-out.m4a`);
  const t0 = Date.now();
  try {
    const page = parseAudioPage(await fetchText(r.source_url));
    if (!page.m4a) throw new Error("no m4a on source page");
    const size = await downloadTo(page.m4a, tmpIn, config.maxUploadBytes, AbortSignal.timeout(20 * 60_000));
    const info = await probe(tmpIn);
    if (!canCopy(info)) { console.log(`  skip ${r.id} "${r.title.slice(0, 50)}": source not copyable (${info.codec} ${info.bitrate ?? "?"}bps ${info.format})`); skipped++; continue; }
    if (dry) { console.log(`  would recopy ${r.id} "${r.title.slice(0, 50)}" ${Math.round(size / 1024)}KB`); ok++; continue; }
    await remux(tmpIn, tmpOut, config.maxDurationSec, config.maxUploadBytes);
    // The waveform already stored describes the same performance (only the encoding changed), and recomputing
    // it means decoding the whole file, which dominates the runtime. Only compute it if the row has none.
    const peaks = r.peaks ?? JSON.stringify(await computePeaks(tmpOut, info.duration));
    const outSize = fs.statSync(tmpOut).size;
    if (!outSize) throw new Error("remux produced an empty file");

    let stored: string;
    if (bunnyEnabled) {
      const key = `media/${r.id}-lossless.m4a`;
      await putObject(tmpOut, key);
      fs.rmSync(tmpOut, { force: true });
      stored = BUNNY_PREFIX + key;
    } else {
      stored = path.join(paths.media, `${r.id}-lossless.m4a`);
      fs.renameSync(tmpOut, stored);
    }
    // Swap only if the row still exists and still points at the old copy (owner may have deleted it meanwhile)
    const res = db.prepare("UPDATE audios SET stream_path = ?, size_bytes = ?, duration_sec = ?, peaks = ?, updated_at = ? WHERE id = ? AND stream_path = ?")
      .run(stored, outSize, info.duration, peaks, now(), r.id, r.stream_path);
    if (res.changes === 0) {
      if (isBunnyPath(stored)) await deleteObject(bunnyKey(stored)).catch(() => {}); else fs.rmSync(stored, { force: true });
      throw new Error("row changed underneath us; left untouched");
    }
    if (isBunnyPath(r.stream_path)) await deleteObject(bunnyKey(r.stream_path)).catch((e) => console.warn(`  (old copy not deleted: ${e.message})`));
    else fs.rmSync(r.stream_path, { force: true });
    ok++;
    console.log(`  ok ${r.id} "${r.title.slice(0, 50)}" ${Math.round(r.size_bytes / 1024)}KB -> ${Math.round(outSize / 1024)}KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${r.id} "${r.title.slice(0, 50)}": ${e instanceof Error ? e.message : e}`);
  } finally {
    fs.rmSync(tmpIn, { force: true });
    fs.rmSync(tmpOut, { force: true });
  }
  await new Promise((res) => setTimeout(res, DELAY));
}
console.log(`done: ${ok} recopied, ${skipped} skipped, ${failed} failed`);
