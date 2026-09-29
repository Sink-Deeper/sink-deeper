import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ListMusic, Plus, Heart, Lock, Pencil, Upload, Music, BarChart3 } from "lucide-react";
import { api, playlistPath, type ApiPlaylist } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PlaylistDialog } from "../components/PlaylistDialog";
import { PageSpinner } from "../components/Spinner";
import { fmtBytes } from "../lib/format";

/** The signed-in user's own space: playlists, likes, uploads, quota. */
export function LibraryPage() {
  const { user, loading, quota } = useAuth();
  const nav = useNavigate();
  const [lists, setLists] = useState<ApiPlaylist[] | null>(null);
  const [editing, setEditing] = useState<ApiPlaylist | "new" | null>(null);

  useEffect(() => { if (!loading && !user) nav("/login", { state: { from: "/library" } }); }, [user, loading, nav]);
  useEffect(() => { if (user) api.get<{ playlists: ApiPlaylist[] }>("/api/playlists/mine").then((r) => setLists(r.playlists)).catch(() => setLists([])); }, [user]);
  if (!user) return null;

  const onSaved = (p: ApiPlaylist) => { setLists((ls) => (ls ?? []).some((x) => x.id === p.id) ? (ls ?? []).map((x) => (x.id === p.id ? p : x)) : [p, ...(ls ?? [])]); setEditing(null); };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl">Your library</h1>
          <p className="text-sm text-muted">Playlists you've made, things you've liked, and your uploads.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/analytics" className="btn-outline"><BarChart3 size={16} /> Analytics</Link>
          <Link to="/import" className="btn-outline">Import from Soundgasm</Link>
          <Link to={`/u/${user.username}`} className="btn-outline"><Music size={16} /> My uploads</Link>
          <Link to="/upload" className="btn-primary"><Upload size={16} /> Upload</Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link to={`/u/${user.username}/likes`} className="card p-4 flex items-center gap-3 hover:border-muted/60">
          <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-accent to-accent/40 flex items-center justify-center text-white"><Heart size={20} fill="currentColor" /></div>
          <div><div className="font-medium">Liked audio</div><div className="text-xs text-muted">Everything you've hearted</div></div>
        </Link>
        {quota && (
          <div className="card p-4 sm:col-span-2 lg:col-span-2 flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs text-muted"><span>Uploaded</span><span>{fmtBytes(quota.usedBytes)}</span></div>
              <div className="text-xs text-muted mt-1.5">{quota.uploadsToday} of {quota.uploadsPerDay} uploads used today</div>
            </div>
          </div>
        )}
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Playlists</h2>
          <button className="btn-primary py-1.5" onClick={() => setEditing("new")}><Plus size={16} /> New playlist</button>
        </div>
        {lists === null ? <PageSpinner /> : lists.length === 0 ? (
          <div className="card border-dashed p-10 text-center text-sm text-muted">
            No playlists yet. Make one here, or use <b className="text-fg">Save</b> on any audio to file it into a playlist as you listen.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((p) => (
              <div key={p.id} className="card p-3 flex items-center gap-3 hover:border-muted/60">
                <Link to={playlistPath(p)} className="h-12 w-12 shrink-0 rounded-lg bg-gradient-to-br from-accent/40 to-surface-2 flex items-center justify-center text-white"><ListMusic size={20} /></Link>
                <div className="min-w-0 flex-1">
                  <Link to={playlistPath(p)} className="font-medium truncate block hover:text-accent-2">{p.title}</Link>
                  <div className="text-xs text-muted flex items-center gap-1.5">{p.itemCount} audio{p.itemCount === 1 ? "" : "s"}{!p.isPublic && <span className="inline-flex items-center gap-0.5 text-amber-400"><Lock size={10} /> private</span>}</div>
                </div>
                <button onClick={() => setEditing(p)} className="text-muted hover:text-fg p-1" aria-label="Edit playlist"><Pencil size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
      {editing && <PlaylistDialog initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}
