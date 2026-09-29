import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Play, Heart, UserPlus, UserCheck, ListMusic, Plus, Upload, Lock, Pencil, Share2, Ban, ShieldOff } from "lucide-react";
import { api, playlistPath, type ApiUser, type ApiPlaylist } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePagedAudios } from "../lib/usePaged";
import { PagedList } from "../components/PagedList";
import { Avatar } from "../components/Avatar";
import { coverColors } from "../components/Cover";
import { PageSpinner } from "../components/Spinner";
import { TagFilter, SortTabs } from "../components/TagFilter";
import { CopyField } from "../components/CopyField";
import { PlaylistDialog } from "../components/PlaylistDialog";
import { fmtCount, fmtDate } from "../lib/format";
import { linkify } from "../lib/linkify";

type Sort = "new" | "old" | "top" | "liked";

export function UserPage({ tab }: { tab: "audios" | "likes" | "sets" }) {
  const { username } = useParams();
  const { user: me } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sets, setSets] = useState<ApiPlaylist[]>([]);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [editing, setEditing] = useState<ApiPlaylist | "new" | null>(null);
  const [showShare, setShowShare] = useState(false);

  const sort = (params.get("sort") as Sort) || "new";
  const tag = params.get("tag") ?? "";
  const selected = useMemo(() => (tag ? [tag] : []), [tag]);
  const paged = usePagedAudios(tab === "sets" ? null : `/api/users/${username}/${tab}${tab === "audios" ? `?sort=${sort}&tag=${encodeURIComponent(tag)}` : ""}`);

  useEffect(() => {
    setUser(null); setError(null);
    api.get<{ user: ApiUser }>(`/api/users/${username}`).then((r) => { setUser(r.user); document.title = `${r.user.displayName} · Sinkdeeper`; }).catch((e) => setError(e.message));
    api.get<{ tags: any[] }>(`/api/users/${username}/tags`).then((r) => setTags(r.tags)).catch(() => {});
    api.get<{ playlists: ApiPlaylist[] }>(`/api/playlists/user/${username}`).then((r) => setSets(r.playlists)).catch(() => {});
    return () => { document.title = "Sinkdeeper"; };
  }, [username]);

  if (error) return <div className="py-20 text-center text-muted">{error}</div>;
  if (!user) return <PageSpinner />;

  const follow = async () => {
    if (!me) return nav("/login");
    const r = await api.post<{ isFollowing: boolean; followers: number }>(`/api/users/${username}/follow`);
    setUser((u) => u && { ...u, ...r });
  };
  const toggleBan = async () => {
    if (!confirm(user.banned ? `Unban ${user.username}?` : `Ban ${user.username}? They'll be logged out and their audio hidden.`)) return;
    const r = await api.post<{ banned: boolean }>(`/api/admin/users/${username}/ban`);
    setUser((u) => u && { ...u, banned: r.banned });
  };
  const onSaved = (p: ApiPlaylist) => { setSets((s) => (s.some((x) => x.id === p.id) ? s.map((x) => (x.id === p.id ? p : x)) : [p, ...s])); setEditing(null); };
  const tabCls = ({ isActive }: { isActive: boolean }) => `py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${isActive ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`;
  const publicSets = sets.filter((s) => s.isPublic || s.isOwner);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-surface px-6 pt-10 pb-6 sm:px-8">
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full blur-3xl opacity-40" style={{ background: `linear-gradient(135deg, ${coverColors(user.username.toLowerCase()).a}, ${coverColors(user.username.toLowerCase()).b})` }} />
        <div className="relative flex flex-col sm:flex-row gap-5 sm:items-end">
          <Avatar name={user.username} src={user.avatarUrl} size={112} className="ring-4 ring-bg" />
          <div className="min-w-0 flex-1 sm:pb-1">
            <div className="eyebrow mb-2">Creator</div>
            <h1 className="text-[2.2rem] leading-none">{user.displayName} {user.banned && <span className="mono ml-2 align-middle text-[0.68rem] rounded-sm bg-red-500/20 text-red-300 px-2 py-0.5">banned</span>}</h1>
            <div className="text-sm text-muted mt-2">@{user.username} · joined {fmtDate(user.createdAt)}</div>
          </div>
          <div className="flex gap-2 sm:pb-1">
            <button onClick={() => setShowShare((v) => !v)} className={`btn-outline ${showShare ? "border-accent text-accent" : ""}`} aria-expanded={showShare}><Share2 size={16} /> Share</button>
            {user.isSelf ? (
              <>
                <Link to="/upload" className="btn-primary"><Upload size={16} /> Upload</Link>
                <Link to="/settings" className="btn-outline"><Pencil size={16} /> Edit profile</Link>
              </>
            ) : (
              <>
                <button onClick={follow} className={user.isFollowing ? "btn-outline" : "btn-primary"}>
                  {user.isFollowing ? <><UserCheck size={16} /> Following</> : <><UserPlus size={16} /> Follow</>}
                </button>
                {me?.isAdmin && (
                  <button onClick={toggleBan} className={`btn-outline ${user.banned ? "text-emerald-400" : "text-red-400"}`}>
                    {user.banned ? <><ShieldOff size={16} /> Unban</> : <><Ban size={16} /> Ban</>}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {showShare && (
          <div className="relative mt-5 rounded-xl border border-border bg-surface-2/40 p-4">
            <CopyField label="Link to this profile" value={`${location.origin}/u/${username}`} />
          </div>
        )}
        {(
          <div className="relative mt-5 flex flex-col sm:flex-row gap-4 sm:items-start">
            <p className="text-[0.95rem] whitespace-pre-wrap break-words flex-1 max-w-2xl">{user.bio ? linkify(user.bio) : <span className="text-muted italic">{user.isSelf ? "Add a bio in settings so people know what you make." : "No bio yet."}</span>}</p>
            <div className="flex gap-4 text-sm text-muted shrink-0">
              <span><b className="text-fg">{user.audioCount}</b> audios</span>
              <span><b className="text-fg">{fmtCount(user.followers)}</b> followers</span>
              <span className="inline-flex items-center gap-1"><Play size={13} /> {fmtCount(user.totalPlays ?? 0)}</span>
              <span className="inline-flex items-center gap-1"><Heart size={13} /> {fmtCount(user.totalLikes ?? 0)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-b border-border flex gap-5">
        <NavLink to={`/u/${username}`} end className={tabCls}>Audio <span className="text-muted">{user.audioCount}</span></NavLink>
        <NavLink to={`/u/${username}/sets`} className={tabCls}>Playlists <span className="text-muted">{publicSets.length}</span></NavLink>
        <NavLink to={`/u/${username}/likes`} className={tabCls}>Likes</NavLink>
      </div>

      {tab === "audios" && (
        <>
          {publicSets.length > 0 && !tag && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="eyebrow">Playlists</h3>
                <Link to={`/u/${username}/sets`} className="text-xs text-accent-2 hover:underline">See all</Link>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {publicSets.slice(0, 6).map((p) => <PlaylistCard key={p.id} p={p} compact />)}
              </div>
            </section>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TagFilter tags={tags} selected={selected} onChange={(t) => setParams(t.length ? { sort, tag: t[t.length - 1] } : { sort }, { replace: true })} limit={12} />
            <SortTabs value={sort} onChange={(s) => setParams(tag ? { sort: s, tag } : { sort: s }, { replace: true })} options={[{ value: "new", label: "Newest" }, { value: "old", label: "Oldest" }, { value: "top", label: "Most played" }, { value: "liked", label: "Most liked" }]} />
          </div>
          <PagedList {...paged} showUser={false} empty={
            tag ? "Nothing with that tag." : user.isSelf ? <>You haven't uploaded anything yet. <Link to="/upload" className="text-accent-2">Upload your first audio</Link></> : "No uploads yet."
          } />
        </>
      )}

      {tab === "likes" && <PagedList {...paged} empty="No likes yet." />}

      {tab === "sets" && (
        <>
          {user.isSelf && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted">Group your uploads into series, or collect other people's work. Private playlists are only visible to you.</p>
              <button className="btn-primary" onClick={() => setEditing("new")}><Plus size={16} /> New playlist</button>
            </div>
          )}
          {publicSets.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {publicSets.map((p) => <PlaylistCard key={p.id} p={p} onEdit={p.isOwner ? () => setEditing(p) : undefined} />)}
            </div>
          ) : <div className="card border-dashed text-muted text-sm py-14 text-center">No playlists yet.</div>}
        </>
      )}

      {editing && <PlaylistDialog initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

function PlaylistCard({ p, compact, onEdit }: { p: ApiPlaylist; compact?: boolean; onEdit?: () => void }) {
  return (
    <div className={`card p-3 flex items-center gap-3 hover:border-muted/60 transition-colors ${compact ? "min-w-60" : ""}`}>
      <Link to={playlistPath(p)} className="h-12 w-12 shrink-0 rounded-lg bg-gradient-to-br from-accent/40 to-surface-2 flex items-center justify-center text-white"><ListMusic size={20} /></Link>
      <div className="min-w-0 flex-1">
        <Link to={playlistPath(p)} className="font-medium truncate block hover:text-accent-2">{p.title}</Link>
        <div className="text-xs text-muted flex items-center gap-1.5">{p.itemCount} audio{p.itemCount === 1 ? "" : "s"}{!p.isPublic && <span className="inline-flex items-center gap-0.5 text-amber-400"><Lock size={10} /> private</span>}</div>
      </div>
      {onEdit && <button onClick={onEdit} className="text-muted hover:text-fg p-1" aria-label="Edit playlist"><Pencil size={14} /></button>}
    </div>
  );
}
