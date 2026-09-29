import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api, type ApiPlaylist } from "../lib/api";

export function PlaylistDialog({ initial, onClose, onSaved }: { initial?: ApiPlaylist; onClose: () => void; onSaved: (p: ApiPlaylist) => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isPublic, setIsPublic] = useState(initial?.isPublic ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = { title: title.trim(), description, isPublic };
      const r = initial
        ? await api.patch<{ playlist: ApiPlaylist }>(`/api/playlists/${initial.id}`, body)
        : await api.post<{ playlist: ApiPlaylist }>("/api/playlists", body);
      onSaved(r.playlist);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form className="card w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{initial ? "Edit playlist" : "New playlist"}</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div><label className="block text-sm mb-1.5">Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} autoFocus placeholder="e.g. The Lighthouse series" /></div>
        <div><label className="block text-sm mb-1.5">Description</label><textarea className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Optional. What ties these together?" /></div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-accent" />
          Show on my profile
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>{initial ? "Save" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}
