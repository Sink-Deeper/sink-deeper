import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Play, Pause, Heart, ListPlus, Download, Share2, Pencil, Trash2, Loader2, Lock, Link2, Repeat1, BarChart3 } from "lucide-react";
import { api, audioPath, userPath, type ApiAudio, type ApiComment } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePlayer } from "../lib/player";
import { fmtDuration, fmtCount, fmtDate, fmtBytes, timeAgo, isAudienceTag, displayTag, sortTags } from "../lib/format";
import { Waveform } from "../components/Waveform";
import { Avatar } from "../components/Avatar";
import { PageSpinner } from "../components/Spinner";
import { AddToPlaylist } from "../components/AddToPlaylist";
import { AudioList } from "../components/AudioCard";
import { linkify } from "../lib/linkify";
import { CopyField } from "../components/CopyField";
import { VersionSwitch } from "../components/VersionSwitch";
import { Cover } from "../components/Cover";

export function AudioPage() {
  const { username, slug } = useParams();
  const { user } = useAuth();
  const player = usePlayer();
  const nav = useNavigate();
  const [audio, setAudio] = useState<ApiAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<ApiComment[]>([]);
  const [more, setMore] = useState<ApiAudio[]>([]);
  const [draft, setDraft] = useState("");
  const [showPl, setShowPl] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);
  const warn = (e: unknown) => { setNotice(e instanceof Error ? e.message : "Something went wrong"); setTimeout(() => setNotice(null), 4000); };

  useEffect(() => {
    const my = ++seq.current; // ignore responses from a previous page once the user has navigated on
    setAudio(null); setError(null); setComments([]); setMore([]);
    api.get<{ audio: ApiAudio }>(`/api/audios/by/${encodeURIComponent(username ?? "")}/${encodeURIComponent(slug ?? "")}`)
      .then((r) => {
        if (my !== seq.current) return;
        setAudio(r.audio);
        document.title = `${r.audio.title} · ${r.audio.user.displayName} · Sinkdeeper`;
        api.get<{ comments: ApiComment[] }>(`/api/audios/${r.audio.id}/comments`).then((c) => { if (my === seq.current) setComments(c.comments); }).catch(() => {});
        api.get<{ audios: ApiAudio[] }>(`/api/users/${encodeURIComponent(username ?? "")}/audios`).then((m) => { if (my === seq.current) setMore(m.audios.filter((a) => a.id !== r.audio.id).slice(0, 6)); }).catch(() => {});
      })
      .catch((e) => { if (my === seq.current) setError(e.message); });
    return () => { document.title = "Sinkdeeper"; };
  }, [username, slug]);

  // Poll while processing
  useEffect(() => {
    if (audio?.status !== "processing") return;
    const t = setInterval(() => api.get<{ audio: ApiAudio }>(`/api/audios/${audio.id}`).then((r) => setAudio(r.audio)).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [audio?.status, audio?.id]);

  if (error) return <div className="py-20 text-center text-muted">{error}</div>;
  if (!audio) return <PageSpinner />;

  const isCur = player.isCurrent(audio.id);
  const playing = isCur && player.playing;
  const dur = isCur ? player.duration || audio.duration : audio.duration;
  const progress = isCur && dur ? player.time / dur : 0;
  const ready = audio.status === "ready";

  const like = async () => {
    if (!user) return nav("/login", { state: { from: audioPath(audio) } });
    setAudio((a) => a && { ...a, liked: !a.liked, likes: a.likes + (a.liked ? -1 : 1) });
    try { const r = await api.post<{ liked: boolean; likes: number }>(`/api/audios/${audio.id}/like`); setAudio((a) => a && { ...a, ...r }); }
    catch (e) { setAudio((a) => a && { ...a, liked: !a.liked, likes: a.likes + (a.liked ? -1 : 1) }); warn(e); }
  };
  const del = async () => {
    if (!confirm("Delete this audio permanently?")) return;
    try { await api.del(`/api/audios/${audio.id}`); player.remove(audio.id); nav(userPath(audio.user)); } catch (e) { warn(e); }
  };
  const postComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      const { comment } = await api.post<{ comment: ApiComment }>(`/api/audios/${audio.id}/comments`, { body: draft.trim() });
      setComments((c) => [...c, comment]); setDraft("");
      setAudio((a) => a && { ...a, comments: a.comments + 1 });
    } catch (err) { warn(err); }
  };
  const delComment = async (id: string) => {
    try {
      await api.del(`/api/audios/${audio.id}/comments/${id}`);
      setComments((c) => c.filter((x) => x.id !== id));
      setAudio((a) => a && { ...a, comments: Math.max(0, a.comments - 1) });
    } catch (e) { warn(e); }
  };

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-8">
      {notice && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 rounded-lg border border-red-500/40 bg-surface px-4 py-2 text-sm text-red-300 shadow-lg" role="alert">{notice}</div>}
      <div className="min-w-0 space-y-6">
        <div>
          <div className="flex gap-5 items-start">
            <div className="relative shrink-0">
              <Cover id={audio.id} size={132} rounded="rounded-2xl" className="hidden sm:block" />
              <Cover id={audio.id} size={72} rounded="rounded-xl" className="sm:hidden" />
            </div>
            <button
              className={`hidden shrink-0 h-14 w-14 rounded-full items-center justify-center shadow-lg ${ready ? "bg-accent text-white hover:bg-accent-2" : "bg-surface-2 text-muted"}`}
              onClick={() => ready && (playing ? player.pause() : player.play(audio, [audio, ...more]))}
              disabled={!ready}
              aria-label={playing ? "Pause" : "Play"}
            >
              {audio.status === "processing" ? <Loader2 className="animate-spin" /> : playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm text-muted">
                <Link to={userPath(audio.user)} className="inline-flex items-center gap-2 font-semibold text-fg hover:text-accent-2"><Avatar name={audio.user.username} src={audio.user.avatarUrl} size={22} /> {audio.user.displayName}</Link>
                <span>·</span><span title={fmtDate(audio.createdAt)}>{timeAgo(audio.createdAt)}</span>
                {audio.visibility === "private" && <span className="inline-flex items-center gap-1 text-accent-2"><Lock size={12} /> private</span>}
                {audio.visibility === "unlisted" && <span className="inline-flex items-center gap-1 text-accent-2"><Link2 size={12} /> unlisted</span>}
              </div>
              <h1 className="text-[1.8rem] sm:text-[2.4rem] mt-2 leading-[1.1] flex flex-wrap items-center gap-x-3 gap-y-1">
                {audio.tags.filter(isAudienceTag).map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="chip-audience text-xs align-middle">{displayTag(t)}</Link>)}
                <span>{audio.title}</span>
              </h1>
              {audio.versions && <div className="mt-3 flex items-center gap-3"><span className="eyebrow">Versions</span><VersionSwitch audio={audio} /></div>}
            </div>
          </div>

          <div className="mt-6">
            {audio.status === "processing" && <p className="text-sm text-muted py-8 text-center">Converting and analysing your audio… this page will update automatically.</p>}
            {audio.status === "failed" && <p className="text-sm text-red-400 py-8 text-center">Processing failed{audio.error ? `: ${audio.error}` : ""}. Try re-uploading in a different format.</p>}
            {ready && (
              <>
                <Waveform peaks={audio.peaks} progress={progress} onSeek={(f) => { if (!isCur) player.play(audio, [audio, ...more]); player.seek(f * dur); }} height={110} />
                <div className="mono flex justify-between text-[0.72rem] text-muted mt-1">
                  <span>{fmtDuration(isCur ? player.time : 0)}</span>
                  <span>{fmtDuration(dur)}</span>
                </div>
              </>
            )}
          </div>

          <div className="mt-5 pb-6 border-b border-border flex flex-wrap items-center gap-2">
            <button
              className={`h-12 w-12 rounded-full flex items-center justify-center shadow-lg mr-1 ${ready ? "bg-accent text-white hover:bg-accent-2" : "bg-surface-2 text-muted"}`}
              onClick={() => ready && (playing ? player.pause() : player.play(audio, [audio, ...more]))}
              disabled={!ready}
              aria-label={playing ? "Pause" : "Play"}
            >{audio.status === "processing" ? <Loader2 className="animate-spin" /> : playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}</button>
            <button onClick={like} className={`btn-outline ${audio.liked ? "border-accent text-accent" : ""}`}><Heart size={16} fill={audio.liked ? "currentColor" : "none"} /> {fmtCount(audio.likes)}</button>
            <button onClick={() => (user ? setShowPl(true) : nav("/login"))} className="btn-outline"><ListPlus size={16} /> Save</button>
            <button
              onClick={() => { const on = isCur && player.loop === "one"; player.setLoop(on ? "off" : "one"); if (!isCur && ready) player.play(audio, [audio, ...more]); }}
              className={`btn-outline ${isCur && player.loop === "one" ? "border-accent text-accent" : ""}`}
              title="Repeat this audio until you stop it"
              disabled={!ready}
            ><Repeat1 size={16} /> Loop</button>
            <button onClick={() => setShowShare((v) => !v)} className={`btn-outline ${showShare ? "border-accent text-accent" : ""}`} aria-expanded={showShare}><Share2 size={16} /> Share</button>
            {audio.downloadUrl && <a href={audio.downloadUrl} className="btn-outline" download title={audio.downloadable ? `Download (${fmtBytes(audio.size)})` : "Only you can download this; downloads are off for listeners"}><Download size={16} /> Download{!audio.downloadable && <span className="text-xs text-muted">(off)</span>}</a>}
            <span className="mono ml-auto text-[0.72rem] text-muted">{fmtCount(audio.plays)} plays</span>
            {audio.isOwner && (
              <>
                <Link to={`/analytics/${audio.id}`} className="btn-ghost"><BarChart3 size={16} /> Stats</Link>
                <Link to={`/edit/${audio.id}`} className="btn-ghost"><Pencil size={16} /> Edit</Link>
                <button onClick={del} className="btn-ghost text-red-400"><Trash2 size={16} /></button>
              </>
            )}
          </div>
          {showShare && (
            <div className="mt-4 rounded-xl border border-border bg-surface-2/40 p-4 space-y-3">
              <CopyField label="Link to this audio" value={`${location.origin}${audioPath(audio)}`} />
              <CopyField label="Embed on a site" value={`<iframe src="${location.origin}/embed/${audio.id}" width="100%" height="140" frameborder="0" allow="autoplay"></iframe>`} textarea />
            </div>
          )}
        </div>

        {(audio.description || audio.tags.length > 0) && (
          <div className="space-y-4 pb-6 border-b border-border">
            {audio.description && <p className="text-[0.95rem] whitespace-pre-wrap leading-relaxed break-words max-w-2xl">{linkify(audio.description)}</p>}
            {audio.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sortTags(audio.tags).map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className={isAudienceTag(t) ? "chip-audience" : "chip"}>{isAudienceTag(t) ? displayTag(t) : `#${t}`}</Link>)}
              </div>
            )}
          </div>
        )}

        <section>
          <h2 className="text-xl mb-4">{comments.length} comment{comments.length === 1 ? "" : "s"}</h2>
          {user ? (
            <form onSubmit={postComment} className="flex gap-3 mb-5">
              <Avatar name={user.username} src={user.avatarUrl} size={32} />
              <div className="flex-1">
                <textarea className="input min-h-16" placeholder="Leave a comment" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} />
                <div className="flex justify-end mt-2"><button className="btn-primary py-1.5" type="submit" disabled={!draft.trim()}>Post</button></div>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted mb-5"><Link to="/login" className="text-accent-2">Log in</Link> to comment.</p>
          )}
          <div className="space-y-4">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <Link to={userPath(c.user)}><Avatar name={c.user.username} src={c.user.avatarUrl} size={32} /></Link>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted"><Link to={userPath(c.user)} className="text-fg font-medium hover:text-accent-2">{c.user.displayName}</Link> · {timeAgo(c.createdAt)}
                    {c.canDelete && <button onClick={() => delComment(c.id)} className="ml-2 hover:text-red-400">delete</button>}
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-6">
        <Link to={userPath(audio.user)} className="flex items-center gap-3 group">
          <Avatar name={audio.user.username} src={audio.user.avatarUrl} size={48} />
          <div className="min-w-0">
            <div className="font-bold truncate group-hover:text-accent-2">{audio.user.displayName}</div>
            <div className="text-xs text-muted">@{audio.user.username}</div>
          </div>
        </Link>
        {more.length > 0 && (
          <div>
            <h3 className="eyebrow mb-1">More from {audio.user.displayName}</h3>
            <div className="[&>div]:grid-cols-2 [&>div]:sm:grid-cols-3 [&>div]:lg:grid-cols-2"><AudioList audios={more} showUser={false} onChange={(id, patch) => setMore((m) => m.map((a) => (a.id === id ? { ...a, ...patch } : a)))} onRemove={(id) => setMore((m) => m.filter((a) => a.id !== id))} /></div>
          </div>
        )}
      </aside>
      {showPl && <AddToPlaylist audioId={audio.id} onClose={() => setShowPl(false)} />}
    </div>
  );
}

