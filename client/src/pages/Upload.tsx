import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UploadCloud, FileAudio, X } from "lucide-react";
import { uploadAudio, audioPath, api, type ApiAudio } from "../lib/api";
import { useAuth } from "../lib/auth";
import { TagInput } from "../components/TagInput";
import { fmtBytes } from "../lib/format";
import { DownloadToggle } from "../components/DownloadToggle";

export function UploadPage() {
  const { user, loading, quota, refresh } = useAuth();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [downloadable, setDownloadable] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => { if (!loading && !user) nav("/login", { state: { from: "/upload" } }); }, [user, loading, nav]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Pick a file first");
    setError(null); setProgress(0);
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("description", description);
    form.append("visibility", visibility);
    form.append("downloadable", downloadable ? "1" : "0");
    form.append("tags", tags.join(","));
    try {
      const { audio } = await uploadAudio(form, setProgress);
      // Wait briefly for processing so the user lands on a playable page when possible
      let a: ApiAudio = audio;
      for (let i = 0; i < 20 && a.status === "processing" && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try { a = (await api.get<{ audio: ApiAudio }>(`/api/audios/${audio.id}`)).audio; } catch { break; }
      }
      void refresh();
      if (alive.current) nav(audioPath(a));
    } catch (err: any) { setError(err.message); setProgress(null); }
  };

  const uploading = progress !== null;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl">Upload audio</h1>
          <p className="text-sm text-muted mt-1">Many files? <Link to="/upload/bulk" className="text-accent-2">Bulk upload</Link> · Moving from Soundgasm? <Link to="/import" className="text-accent-2">Import your catalogue</Link></p>
        </div>
        {quota && (
          <div className="text-xs text-muted text-right">
            <div className="flex items-center gap-2">
              <span>{fmtBytes(quota.usedBytes)} uploaded</span>
            </div>
            <div className="mt-0.5">{quota.uploadsToday} of {quota.uploadsPerDay} uploads today · max {fmtBytes(quota.maxUploadBytes)} per file</div>
          </div>
        )}
      </div>
      <form onSubmit={submit} className="space-y-5">
        <div
          className={`card border-dashed p-8 text-center cursor-pointer transition-colors ${dragging ? "border-accent bg-accent/5" : "hover:border-muted"}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
        >
          <input ref={inputRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.flac,.ogg,.opus,.aac" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileAudio className="text-accent" />
              <div className="text-left">
                <div className="font-medium">{file.name}</div>
                <div className="text-xs text-muted">{fmtBytes(file.size)}</div>
              </div>
              <button type="button" className="text-muted hover:text-fg ml-2" onClick={(e) => { e.stopPropagation(); setFile(null); }} aria-label="Remove file"><X size={18} /></button>
            </div>
          ) : (
            <>
              <UploadCloud className="mx-auto text-muted mb-2" size={32} />
              <div className="font-medium">Drop an audio file here, or click to browse</div>
              <div className="text-xs text-muted mt-1">MP3, M4A, WAV, FLAC, OGG, Opus. Converted to AAC for streaming.</div>
            </>
          )}
        </div>
        <div>
          <label className="block text-sm mb-1.5">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} placeholder="A title people can find" />
          <p className="text-xs text-muted mt-1">No need for [F4M] or [tags] here. Anything in brackets is moved to the tag list automatically.</p>
        </div>
        <div>
          <label className="block text-sm mb-1.5">Description</label>
          <textarea className="input min-h-32" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} placeholder="Script credits, content notes, links…" />
        </div>
        <div>
          <label className="block text-sm mb-1.5">Tags</label>
          <TagInput value={tags} onChange={setTags} />
          <p className="text-xs text-muted mt-1">Tags power search and browsing. Include audience, tone, and content warnings.</p>
        </div>
        <div>
          <label className="block text-sm mb-1.5">Visibility</label>
          <div className="grid grid-cols-3 gap-2">
            {(["public", "unlisted", "private"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setVisibility(v)} className={`card px-3 py-2 text-sm text-left ${visibility === v ? "border-accent" : "hover:border-muted"}`}>
                <div className="font-medium capitalize">{v}</div>
                <div className="text-xs text-muted">{v === "public" ? "Listed in feeds and search" : v === "unlisted" ? "Only people with the link" : "Only you"}</div>
              </button>
            ))}
          </div>
        </div>
        <DownloadToggle value={downloadable} onChange={setDownloadable} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        {uploading && (
          <div>
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div>
            <p className="text-xs text-muted mt-1">{progress! < 100 ? `Uploading… ${progress}%` : "Processing audio…"}</p>
          </div>
        )}
        <button className="btn-primary w-full" type="submit" disabled={uploading || !file || !title.trim()}>{uploading ? "Please wait…" : "Upload"}</button>
      </form>
    </div>
  );
}
