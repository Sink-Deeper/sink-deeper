import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Play, Trash2, Lock, ArrowUp, ArrowDown, X } from "lucide-react";
import { api, audioPath, userPath, type ApiAudio, type ApiPlaylist, type PlaylistView } from "../lib/api";
import { usePlayer } from "../lib/player";
import { PageSpinner } from "../components/Spinner";
import { fmtDuration } from "../lib/format";
import { linkify } from "../lib/linkify";

export function PlaylistPage() {
  const { username, slug } = useParams();
  const nav = useNavigate();
  const player = usePlayer();
  const [pl, setPl] = useState<ApiPlaylist | null>(null);
  const [audios, setAudios] = useState<ApiAudio[]>([]);
  const [unavailable, setUnavailable] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.get<PlaylistView>(`/api/playlists/by/${username}/${slug}`)
      .then((r) => { if (!live) return; setPl(r.playlist); setAudios(r.audios); setUnavailable(r.unavailable ?? 0); }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [username, slug]);

  if (error) return <div className="py-20 text-center text-muted">{error}</div>;
  if (!pl) return <PageSpinner />;

  const saveOrder = (next: ApiAudio[]) => { setAudios(next); api.put(`/api/playlists/${pl.id}/order`, { order: next.map((a) => a.id) }).catch(() => {}); };
  const move = (i: number, dir: -1 | 1) => { const n = [...audios]; const j = i + dir; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; saveOrder(n); };
  const removeItem = async (a: ApiAudio) => { await api.post(`/api/playlists/${pl.id}/items`, { audioId: a.id }); setAudios((as) => as.filter((x) => x.id !== a.id)); };
  const del = async () => { if (!confirm("Delete this playlist?")) return; await api.del(`/api/playlists/${pl.id}`); nav(`/u/${username}/sets`); };
  const prune = async () => {
    const r = await api.post<{ removed: number }>(`/api/playlists/${pl!.id}/prune`);
    setUnavailable(0); setPl((p) => p && { ...p, itemCount: p.itemCount - r.removed });
  };
  const togglePublic = async () => { const r = await api.patch<{ playlist: ApiPlaylist }>(`/api/playlists/${pl.id}`, { isPublic: !pl.isPublic }); setPl(r.playlist); };
  const total = audios.reduce((s, a) => s + a.duration, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="card p-5 sm:p-6">
        <div className="text-xs text-muted uppercase tracking-wide">Playlist {!pl.isPublic && <span className="inline-flex items-center gap-1 text-amber-400 ml-2"><Lock size={11} /> private</span>}</div>
        <h1 className="text-2xl mt-1">{pl.title}</h1>
        <div className="text-sm text-muted mt-1">by <Link to={userPath(pl.user)} className="text-fg hover:text-accent-2">{pl.user.displayName}</Link> · {audios.length} audios · {fmtDuration(total)}</div>
        {pl.description && <p className="text-sm mt-3 whitespace-pre-wrap break-words">{linkify(pl.description)}</p>}
        {pl.isOwner && unavailable > 0 && (
          <p className="text-xs text-amber-400 mt-3">{unavailable} item{unavailable === 1 ? " is" : "s are"} no longer available (deleted, private, or the creator was removed). <button onClick={prune} className="underline hover:text-fg">Remove them</button></p>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="btn-primary" disabled={!audios.length} onClick={() => player.play(audios[0], audios)}><Play size={16} fill="currentColor" /> Play all</button>
          {pl.isOwner && <>
            <button className="btn-outline" onClick={togglePublic}>{pl.isPublic ? "Make private" : "Make public"}</button>
            <button className="btn-ghost text-red-400" onClick={del}><Trash2 size={16} /> Delete</button>
          </>}
        </div>
      </div>
      <ol className="card divide-y divide-border">
        {audios.length === 0 && <li className="p-8 text-center text-sm text-muted">This playlist is empty.</li>}
        {audios.map((a, i) => {
          const cur = player.isCurrent(a.id);
          return (
            <li key={a.id} className={`flex items-center gap-3 px-3 py-2.5 ${cur ? "bg-accent/5" : ""}`}>
              <button className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${cur && player.playing ? "bg-accent text-ink" : "bg-surface-2 text-fg hover:bg-accent hover:text-white"}`} onClick={() => (cur ? player.toggle() : player.play(a, audios))}>
                {cur && player.playing ? <span className="text-xs font-semibold">▮▮</span> : <Play size={14} fill="currentColor" className="ml-0.5" />}
              </button>
              <span className="text-xs text-muted w-5 text-right tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <Link to={audioPath(a)} className="block truncate text-sm font-medium hover:text-accent-2">{a.title}</Link>
                <Link to={userPath(a.user)} className="block truncate text-xs text-muted hover:text-fg">{a.user.displayName}</Link>
              </div>
              <span className="text-xs text-muted tabular-nums">{fmtDuration(a.duration)}</span>
              {pl.isOwner && (
                <div className="flex items-center gap-0.5 text-muted">
                  <button onClick={() => move(i, -1)} className="p-1 hover:text-fg disabled:opacity-30" disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
                  <button onClick={() => move(i, 1)} className="p-1 hover:text-fg disabled:opacity-30" disabled={i === audios.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
                  <button onClick={() => removeItem(a)} className="p-1 hover:text-red-400" aria-label="Remove"><X size={14} /></button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
