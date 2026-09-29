import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Copy, Loader2, RefreshCw, XCircle, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DownloadToggle } from "../components/DownloadToggle";
import { timeAgo } from "../lib/format";

type Preview = { user: string; found: number; verified: boolean; adminBypass: boolean; code: string; sample: string[] };
type Job = {
  id: string; sourceUrl: string; status: "queued" | "running" | "done" | "failed" | "cancelled"; total: number; done: number; skipped: number; failed: number;
  ready: number; processing: number; failedProcessing: number; queueAhead: number;
  error: string | null; createdAt: number; updatedAt: number; log: { t: number; url: string; status: string; title?: string; error?: string; reason?: string }[];
};

// Measured on real imports: copying plus preparing one audio for playback takes about 20 seconds
const SECONDS_PER_AUDIO = 20;
function fmtEta(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const m = Math.round(seconds / 60);
  if (m < 90) return `about ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round((seconds / 3600) * 2) / 2;
  return `about ${h} hour${h === 1 ? "" : "s"}`;
}
function timeLeft(seconds: number): string {
  const eta = fmtEta(seconds);
  return eta === "under a minute" ? "Less than a minute left" : `${eta[0].toUpperCase()}${eta.slice(1)} left`;
}
const isWorking = (j: Job | null | undefined): boolean =>
  !!j && (j.status === "queued" || j.status === "running" || (j.status === "done" && j.processing > 0));

export function ImportPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [downloadable, setDownloadable] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [copied, setCopied] = useState(false);
  const [claimUrl, setClaimUrl] = useState("");
  const [claimResult, setClaimResult] = useState<{ hidden: number; uploaders: string[] } | { error: string } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const poll = useRef<number | null>(null);

  useEffect(() => { if (!loading && !user) nav("/login", { state: { from: "/import" } }); }, [user, loading, nav]);
  useEffect(() => {
    if (!user) return;
    api.get<{ code: string }>("/api/import/verification").then((r) => setCode(r.code)).catch(() => {});
    api.get<{ imports: Job[] }>("/api/import").then((r) => {
      setHistory(r.imports);
      const active = r.imports.find(isWorking);
      if (active) setJob(active);
    }).catch(() => {});
  }, [user]);

  // Poll while the job is copying or its files are still being prepared for playback
  const working = isWorking(job);
  useEffect(() => {
    if (!job || !working) { if (poll.current) window.clearInterval(poll.current); return; }
    poll.current = window.setInterval(() => api.get<{ import: Job }>(`/api/import/${job.id}`).then((r) => setJob(r.import)).catch(() => {}), 2000);
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [job?.id, working]);

  if (!user) return null;

  const check = async () => {
    setChecking(true); setError(null); setPreview(null);
    try { setPreview(await api.post<Preview>("/api/import/preview", { url: url.trim() })); }
    catch (e: any) { setError(e.message); } finally { setChecking(false); }
  };
  const start = async () => {
    setError(null);
    try { const r = await api.post<{ import: Job }>("/api/import", { url: url.trim(), visibility, downloadable }); setJob(r.import); setHistory((h) => [r.import, ...h]); }
    catch (e: any) { setError(e.message); }
  };
  const cancel = async () => { if (!job) return; const r = await api.post<{ import: Job }>(`/api/import/${job.id}/cancel`); setJob(r.import); };
  const copyCode = () => code && navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  const claim = async () => {
    setClaiming(true); setClaimResult(null);
    try { setClaimResult(await api.post<{ hidden: number; uploaders: string[] }>("/api/import/claim", { url: claimUrl.trim() })); }
    catch (e: any) { setClaimResult({ error: e.message }); } finally { setClaiming(false); }
  };
  const active = job && (job.status === "queued" || job.status === "running");
  // Complete only when every file is playable (or was skipped / failed), not when copying ends
  const toImport = job ? Math.max(0, job.total - job.skipped - job.failed) : 0;
  const remaining = job ? Math.max(0, toImport - job.ready - job.failedProcessing) : 0;
  const progress = job && job.total ? Math.min(100, Math.round(((job.ready + job.failedProcessing + job.skipped + job.failed) / job.total) * 100)) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl">Import from Soundgasm</h1>
        <p className="text-sm text-muted mt-1">Bring your whole catalogue over. Titles, descriptions and bracket tags like [F4M] come with it. Only your own profile can be imported.</p>
      </div>

      {/* Step 1: URL + verification */}
      <section className="card p-5 space-y-4">
        <div>
          <label className="block text-sm mb-1.5">Your Soundgasm profile</label>
          <div className="flex gap-2">
            <input className="input" placeholder="https://soundgasm.net/u/yourname" value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} disabled={!!active} />
            <button className="btn-outline shrink-0" onClick={check} disabled={checking || !url.trim() || !!active}>{checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check</button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-2/50 p-4 space-y-2">
          <div className="text-sm font-medium">Prove the profile is yours</div>
          <p className="text-xs text-muted">Put this code in the <b className="text-fg">title or description</b> of any one of your Soundgasm audios, or upload a tiny file there with the code as its title. Then click Check. You can remove it once the import is done.</p>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-bg px-3 py-1.5 text-sm font-mono select-all">{code ?? "…"}</code>
            <button className="btn-ghost py-1.5" onClick={copyCode}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
          </div>
        </div>

        {error && <p className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={14} /> {error}</p>}
        {preview && (
          <div className={`rounded-lg border p-4 text-sm ${preview.verified ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
            <div className="flex items-center gap-2 font-medium">
              {preview.verified ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-amber-400" />}
              {preview.verified ? (preview.adminBypass ? "Admin: verification skipped" : "Verified as yours") : "Code not found yet"}
              <span className="text-muted font-normal">· {preview.found} audio{preview.found === 1 ? "" : "s"} found on @{preview.user}</span>
            </div>
            {!preview.verified && <p className="text-xs text-muted mt-1">Add the code on Soundgasm, wait a few seconds for their page to update, then click Check again.</p>}
            {preview.sample.length > 0 && <p className="text-xs text-muted mt-1 truncate">e.g. {preview.sample.join(", ")}</p>}
          </div>
        )}
      </section>

      {/* Step 2: options + start */}
      {preview?.verified && !active && (
        <section className="card p-5 space-y-4">
          <div className="text-sm font-medium">Import settings</div>
          <div>
            <label className="block text-sm mb-1.5">Visibility for imported audio</label>
            <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
              <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private (review first, publish later)</option>
            </select>
          </div>
          <DownloadToggle value={downloadable} onChange={setDownloadable} />
          <p className="text-xs text-muted">This takes <b className="text-fg">{fmtEta(preview.found * SECONDS_PER_AUDIO)}</b> for {preview.found} audio{preview.found === 1 ? "" : "s"}: each one is copied from Soundgasm and then prepared for playback. You can close this page and it keeps going on the server. Audio you've already imported is skipped.</p>
          <button className="btn-primary w-full" onClick={start}>Import {preview.found} audio{preview.found === 1 ? "" : "s"}</button>
        </section>
      )}

      {/* Progress */}
      {job && (
        <section className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium flex items-center gap-2">
              {working && <Loader2 size={16} className="animate-spin text-accent" />}
              {job.status === "queued" ? (job.queueAhead ? `Waiting for ${job.queueAhead} other import${job.queueAhead === 1 ? "" : "s"} to finish` : "Starting…")
                : job.status === "running" ? "Copying from Soundgasm…"
                : job.status === "done" ? (job.processing ? "Copied. Preparing for playback…" : "Import finished")
                : job.status === "cancelled" ? "Import cancelled" : "Import failed"}
              <span className="text-muted font-normal">· {job.done} copied{job.skipped ? `, ${job.skipped} skipped` : ""}{job.failed ? `, ${job.failed} failed` : ""}{job.total ? ` of ${job.total}` : ""}</span>
            </div>
            {active && <button className="btn-ghost py-1 text-red-400" onClick={cancel}>Cancel</button>}
          </div>
          <div className="h-2 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted">
            <span><b className="text-fg">{job.ready}</b> of {toImport} ready to play{job.status === "running" ? ` · ${job.done} copied so far` : ""}{job.failedProcessing ? ` · ${job.failedProcessing} couldn't be processed` : ""}</span>
            {working && remaining > 0 && <span>{timeLeft(remaining * SECONDS_PER_AUDIO)}</span>}
          </div>
          {working && <p className="text-xs text-muted">You can close this page. It keeps going on the server.</p>}
          {job.error && <p className="text-sm text-red-400">{job.error}</p>}
          {job.log.length > 0 && (
            <ul className="max-h-64 overflow-y-auto text-xs divide-y divide-border">
              {[...job.log].reverse().map((l, i) => (
                <li key={i} className="py-1.5 flex items-start gap-2">
                  {l.status === "imported" ? <CheckCircle2 size={13} className="text-emerald-400 mt-0.5 shrink-0" /> : l.status === "skipped" ? <Check size={13} className="text-muted mt-0.5 shrink-0" /> : <XCircle size={13} className="text-red-400 mt-0.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{l.title ?? l.url.split("/").pop()}{l.error && <span className="text-red-400"> · {l.error}</span>}{l.reason && <span className="text-muted"> · {l.reason}</span>}</span>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-fg shrink-0"><ExternalLink size={12} /></a>
                </li>
              ))}
            </ul>
          )}
          {job.status === "done" && <Link to={`/u/${user.username}`} className="btn-outline">See your uploads</Link>}
        </section>
      )}

      <section className="card p-5 space-y-3">
        <div>
          <div className="text-sm font-medium">Someone else imported your Soundgasm catalogue?</div>
          <p className="text-xs text-muted mt-1">Prove the profile is yours with the same code above, and every file imported from it by any other account is hidden straight away and flagged for review. No email needed.</p>
        </div>
        <div className="flex gap-2">
          <input className="input" placeholder="https://soundgasm.net/u/yourname" value={claimUrl} onChange={(e) => { setClaimUrl(e.target.value); setClaimResult(null); }} />
          <button className="btn-outline shrink-0" onClick={claim} disabled={claiming || !claimUrl.trim()}>{claiming ? <Loader2 size={16} className="animate-spin" /> : null} This is mine</button>
        </div>
        {claimResult && ("error" in claimResult
          ? <p className="text-sm text-red-400">{claimResult.error}</p>
          : claimResult.hidden > 0
            ? <p className="text-sm text-emerald-400">Hidden {claimResult.hidden} file{claimResult.hidden === 1 ? "" : "s"} uploaded by {claimResult.uploaders.join(", ")}. An admin will review and remove them.</p>
            : <p className="text-sm text-muted">Verified. Nothing from that profile has been imported by anyone else.</p>)}
      </section>

      {history.filter((h) => h.id !== job?.id).length > 0 && (
        <section className="text-xs text-muted">
          <div className="font-medium text-fg text-sm mb-1">Previous imports</div>
          {history.filter((h) => h.id !== job?.id).map((h) => (
            <button key={h.id} onClick={() => setJob(h)} className="block w-full text-left py-1 hover:text-fg">{timeAgo(h.createdAt)} · {h.status} · {h.done} imported{h.failed ? `, ${h.failed} failed` : ""}</button>
          ))}
        </section>
      )}
    </div>
  );
}
