import { useEffect, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { api, type ApiPlaylist } from "../lib/api";

export function AddToPlaylist({ audioId, onClose }: { audioId: string; onClose: () => void }) {
  const [lists, setLists] = useState<ApiPlaylist[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => api.get<{ playlists: ApiPlaylist[] }>(`/api/playlists/mine?audio=${audioId}`).then((r) => setLists(r.playlists));
  useEffect(() => { void refresh(); }, [audioId]);

  const toggle = async (p: ApiPlaylist) => {
    setLists((ls) => ls?.map((x) => (x.id === p.id ? { ...x, contains: !x.contains, itemCount: x.itemCount + (x.contains ? -1 : 1) } : x)) ?? null);
    await api.post(`/api/playlists/${p.id}/items`, { audioId }).catch(() => refresh());
  };
  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { playlist } = await api.post<{ playlist: ApiPlaylist }>("/api/playlists", { title: title.trim() });
      await api.post(`/api/playlists/${playlist.id}/items`, { audioId });
      setTitle("");
      await refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Save to playlist</h3>
          <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1">
          {lists === null && <p className="text-sm text-muted">Loading…</p>}
          {lists?.length === 0 && <p className="text-sm text-muted">No playlists yet. Create one below.</p>}
          {lists?.map((p) => (
            <button key={p.id} onClick={() => toggle(p)} className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-2 text-left">
              <span className="truncate">{p.title} <span className="text-muted">· {p.itemCount}</span></span>
              <span className={`h-5 w-5 rounded border flex items-center justify-center ${p.contains ? "bg-accent border-accent text-white" : "border-border"}`}>{p.contains && <Check size={14} />}</span>
            </button>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input className="input" placeholder="New playlist name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={busy || !title.trim()} type="submit"><Plus size={16} /> Create</button>
        </form>
      </div>
    </div>
  );
}
