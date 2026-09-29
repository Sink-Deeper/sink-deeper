import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UploadCloud, X, CheckCircle2, XCircle, Loader2, Clock, FileAudio } from "lucide-react";
import { uploadAudio, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { TagInput } from "../components/TagInput";
import { DownloadToggle } from "../components/DownloadToggle";
import { fmtBytes, extractBracketTags, stripBracketTags } from "../lib/format";

type Item = { id: string; file: File; title: string; status: "pending" | "uploading" | "done" | "error" | "waiting"; progress: number; error?: string; url?: string };

/** "[F4M] cosy_night-final.mp3" -> "[F4M] cosy night final" */
const titleFromName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s*-\s*/g, " - ").replace(/\s{2,}/g, " ").trim();

export function BulkUploadPage() {
  const { user, loading, refresh } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [useBracketTags, setUseBracketTags] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [downloadable, setDownloadable] = useState(true);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stop = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items); itemsRef.current = items;

  useEffect(() => { if (!loading && !user) nav("/login", { state: { from: "/upload/bulk" } }); }, [user, loading, nav]);
  if (!user) return null;

  const add = (files: FileList | File[]) => {
    const next = [...files].filter((f) => /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|aiff?|mp4|webm|mka)$/i.test(f.name))
      .map<Item>((f) => ({ id: Math.random().toString(36).slice(2), file: f, title: titleFromName(f.name), status: "pending", progress: 0 }));
    setItems((it) => [...it, ...next]);
  };
  const patch = (id: string, p: Partial<Item>) => setItems((it) => it.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const run = async () => {
    setRunning(true); stop.current = false;
    for (const item of items) {
      if (stop.current) break;
      if (item.status === "done") continue;
      const current = () => itemsRef.current.find((x) => x.id === item.id);
      let attempt = 0;
      while (!stop.current) {
        const cur = current();
        if (!cur) break; // removed from the list while waiting
        patch(item.id, { status: "uploading", progress: 0, error: undefined });
        const form = new FormData();
        const rawTitle = cur.title.trim() || titleFromName(item.file.name);
        const title = useBracketTags ? (stripBracketTags(rawTitle) || rawTitle) : rawTitle;
        form.append("file", item.file); form.append("title", title); form.append("description", ""); form.append("visibility", visibility);
        form.append("downloadable", downloadable ? "1" : "0");
        form.append("tags", [...tags, ...(useBracketTags ? extractBracketTags(rawTitle) : [])].join(","));
        try {
          const { audio } = await uploadAudio(form, (pct) => patch(item.id, { progress: pct }));
          patch(item.id, { status: "done", progress: 100, url: `/u/${audio.user.username}/${audio.slug}` });
          break;
        } catch (e) {
          const err = e as ApiError;
          // Rate limited: wait for the window to pass, then retry the same file
          if (err.status === 429 && attempt < 12) {
            const secs = /(\d+) minutes?/.exec(err.message) ? Number(/(\d+) minutes?/.exec(err.message)![1]) * 60 : /(\d+) seconds?/.exec(err.message) ? Number(/(\d+) seconds?/.exec(err.message)![1]) : 60;
            const wait = Math.min(secs + 2, 15 * 60);
            for (let s = wait; s > 0 && !stop.current; s--) { patch(item.id, { status: "waiting", error: `Rate limited, retrying in ${s}s` }); await new Promise((r) => setTimeout(r, 1000)); }
            attempt++;
            continue;
          }
          patch(item.id, { status: "error", error: err.message });
          break;
        }
      }
    }
    setRunning(false); void refresh();
  };
  const pending = items.filter((i) => i.status !== "done").length;
  const done = items.filter((i) => i.status === "done").length;
  const totalBytes = items.reduce((s, i) => s + i.file.size, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl">Bulk upload</h1>
          <p className="text-sm text-muted mt-1">Drop a folder's worth of files. Titles come from filenames and you can fix them before uploading. <Link to="/import" className="text-accent-2">Moving from Soundgasm?</Link></p>
        </div>
        <Link to="/upload" className="text-sm text-muted hover:text-fg">Single upload</Link>
      </div>

      <div
        className={`card border-dashed p-8 text-center cursor-pointer transition-colors ${dragging ? "border-accent bg-accent/5" : "hover:border-muted"}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
      >
        <input ref={inputRef} type="file" multiple accept="audio/*,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aac" className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />
        <UploadCloud className="mx-auto text-muted mb-2" size={32} />
        <div className="font-medium">Drop audio files here, or click to pick several</div>
        <div className="text-xs text-muted mt-1">{items.length ? `${items.length} file${items.length === 1 ? "" : "s"} · ${fmtBytes(totalBytes)}` : "MP3, M4A, WAV, FLAC, OGG, Opus"}</div>
      </div>

      {items.length > 0 && (
        <>
          <section className="card p-5 space-y-4">
            <div className="text-sm font-medium">Applied to every file</div>
            <div>
              <label className="block text-sm mb-1.5">Tags</label>
              <TagInput value={tags} onChange={setTags} placeholder="Tags for all of these" />
              <label className="mt-2 flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input type="checkbox" className="accent-accent" checked={useBracketTags} onChange={(e) => setUseBracketTags(e.target.checked)} />
                Turn [bracketed] parts and audience codes (F4M, FF4A…) in each title into tags and remove them from the title
              </label>
            </div>
            <div>
              <label className="block text-sm mb-1.5">Visibility</label>
              <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as any)} disabled={running}>
                <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private (review first, publish later)</option>
              </select>
            </div>
            <DownloadToggle value={downloadable} onChange={setDownloadable} />
          </section>

          <section className="card divide-y divide-border">
            {items.map((it) => (
              <div key={it.id} className="p-3 flex items-center gap-3">
                <div className="shrink-0 text-muted">
                  {it.status === "done" ? <CheckCircle2 size={18} className="text-emerald-400" /> : it.status === "error" ? <XCircle size={18} className="text-red-400" /> : it.status === "uploading" ? <Loader2 size={18} className="animate-spin text-accent" /> : it.status === "waiting" ? <Clock size={18} className="text-amber-400" /> : <FileAudio size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  {it.status === "done" && it.url ? (
                    <Link to={it.url} className="block truncate text-sm font-medium hover:text-accent-2">{it.title}</Link>
                  ) : (
                    <input className="w-full bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-accent" value={it.title} onChange={(e) => patch(it.id, { title: e.target.value })} disabled={running && it.status !== "pending"} maxLength={140} />
                  )}
                  <div className="text-xs text-muted truncate">{it.file.name} · {fmtBytes(it.file.size)}{it.error && <span className={it.status === "waiting" ? " text-amber-400" : " text-red-400"}> · {it.error}</span>}</div>
                  {it.status === "uploading" && <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${it.progress}%` }} /></div>}
                </div>
                {it.status !== "uploading" && it.status !== "done" && (
                  <button onClick={() => setItems((all) => all.filter((x) => x.id !== it.id))} className="text-muted hover:text-fg" aria-label="Remove"><X size={16} /></button>
                )}
              </div>
            ))}
          </section>

          <div className="flex items-center gap-3">
            {running ? (
              <button className="btn-outline" onClick={() => { stop.current = true; }}>Stop after this file</button>
            ) : (
              <button className="btn-primary" onClick={run} disabled={!pending}>Upload {pending} file{pending === 1 ? "" : "s"}</button>
            )}
            <span className="text-sm text-muted">{done} of {items.length} done</span>
          </div>
        </>
      )}
    </div>
  );
}
