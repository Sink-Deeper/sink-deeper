import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Pause, Heart, Lock, Link2, Loader2, AlertTriangle, ListPlus, Download, Share2, Pencil, Trash2 } from "lucide-react";
import { api, audioPath, userPath, type ApiAudio } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePlayer } from "../lib/player";
import { fmtDuration, fmtCount, timeAgo, isAudienceTag, displayTag, sortTags } from "../lib/format";
import { Menu, MenuItem } from "./Menu";
import { AddToPlaylist } from "./AddToPlaylist";
import { Cover } from "./Cover";
import { VersionSwitch } from "./VersionSwitch";
import { THEME } from "../lib/theme";

type Props = { audio: ApiAudio; queue?: ApiAudio[]; showUser?: boolean; onChange?: (id: string, patch: Partial<ApiAudio>) => void; onRemove?: (id: string) => void };

/** A track tile: generated cover with a play button on hover, then title, creator, and a compact meta line. */
export function AudioCard({ audio, queue, showUser = true, onChange, onRemove }: Props) {
  const player = usePlayer();
  const { user } = useAuth();
  const nav = useNavigate();
  const [showPl, setShowPl] = useState(false);
  const isCur = player.isCurrent(audio.id);
  const playing = isCur && player.playing;
  const ready = audio.status === "ready";
  const sorted = sortTags(audio.tags);
  const audience = sorted.filter(isAudienceTag);
  const rest = sorted.filter((t) => !isAudienceTag(t));

  const like = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!user) return nav("/login");
    onChange?.(audio.id, { liked: !audio.liked, likes: audio.likes + (audio.liked ? -1 : 1) });
    try { const r = await api.post<{ liked: boolean; likes: number }>(`/api/audios/${audio.id}/like`); onChange?.(audio.id, r); }
    catch { onChange?.(audio.id, { liked: audio.liked, likes: audio.likes }); }
  };
  const copy = () => navigator.clipboard.writeText(`${location.origin}${audioPath(audio)}`).catch(() => {});
  const del = async () => {
    if (!confirm(`Delete "${audio.title}"?`)) return;
    await api.del(`/api/audios/${audio.id}`);
    player.remove(audio.id);
    onRemove?.(audio.id);
  };

  return (
    <div className="group relative min-w-0">
      <div className="tile aspect-square">
        <Cover id={audio.id} size="100%" rounded="rounded-xl" className="absolute inset-0" />
        {isCur && <div className="absolute inset-0 ring-2 ring-accent rounded-xl pointer-events-none" />}
        <div className={`absolute inset-0 bg-black/0 transition-colors ${ready ? "group-hover:bg-black/25" : "bg-black/45"}`} />
        {audience.length > 0 && (
          <div className="absolute left-2 top-2 flex gap-1">{audience.slice(0, 2).map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="chip-audience shadow">{displayTag(t)}</Link>)}</div>
        )}
        <span className="mono absolute right-2 bottom-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[0.68rem] text-white">{ready ? fmtDuration(audio.duration) : audio.status}</span>
        <button
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-14 w-14 rounded-full flex items-center justify-center shadow-xl transition-all ${ready ? `bg-accent text-white hover:scale-105 ${isCur ? "opacity-100" : "opacity-0 group-hover:opacity-100"}` : "bg-black/50 text-white"}`}
          onClick={() => ready && (playing ? player.pause() : player.play(audio, queue))}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
        >
          {audio.status === "processing" ? <Loader2 size={22} className="animate-spin" /> : audio.status === "failed" ? <AlertTriangle size={22} /> : playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
        </button>
        <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Menu trigger={<span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white text-base leading-none">···</span>}>
            <MenuItem icon={<ListPlus size={15} />} onClick={() => (user ? setShowPl(true) : nav("/login"))}>Save to playlist</MenuItem>
            <MenuItem icon={<Share2 size={15} />} onClick={copy}>Copy link</MenuItem>
            {audio.downloadUrl && <MenuItem icon={<Download size={15} />} href={audio.downloadUrl} download>Download</MenuItem>}
            {audio.isOwner && <>
              <div className="my-1 border-t border-border" />
              <MenuItem icon={<Pencil size={15} />} onClick={() => nav(`/edit/${audio.id}`)}>Edit</MenuItem>
              <MenuItem icon={<Trash2 size={15} />} onClick={del} danger>Delete</MenuItem>
            </>}
          </Menu>
        </div>
      </div>
      <div className="mt-2.5 min-w-0">
        <Link to={audioPath(audio)} className="block font-bold leading-snug line-clamp-2 hover:text-accent-2">{audio.title}</Link>
        {showUser && <Link to={userPath(audio.user)} className="block text-sm text-muted truncate hover:text-fg mt-0.5">{audio.user.displayName}</Link>}
        {audio.description.trim() && <p className="mt-1 text-[0.8rem] leading-snug text-muted/90 line-clamp-2">{audio.description.trim()}</p>}
        {audio.versions && <div className="mt-1.5"><VersionSwitch audio={audio} size="sm" /></div>}
        <div className="mono mt-1 flex items-center gap-x-3 text-[0.7rem] text-muted">
          <span>{fmtCount(audio.plays)} plays</span>
          <button onClick={like} className={`inline-flex items-center gap-1 hover:text-accent-2 ${audio.liked ? "text-accent-2" : ""}`} aria-label="Like"><Heart size={11} fill={audio.liked ? "currentColor" : "none"} /> {fmtCount(audio.likes)}</button>
          <span>{timeAgo(audio.createdAt)}</span>
          {audio.visibility === "private" && <Lock size={11} className="text-amber-400" />}
          {audio.visibility === "unlisted" && <Link2 size={11} className="text-sky-400" />}
        </div>
        {rest.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {rest.slice(0, 5).map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="chip py-0.5 px-2 text-[0.68rem]">{t}</Link>)}
            {rest.length > 5 && <span className="chip py-0.5 px-2 text-[0.68rem]">+{rest.length - 5}</span>}
          </div>
        )}
      </div>
      {showPl && <AddToPlaylist audioId={audio.id} onClose={() => setShowPl(false)} />}
    </div>
  );
}

/** Feed row: small cover, then title, creator, a two-line description and tags. Used on the home feed and search. */
export function AudioRow({ audio, queue, showUser = true, onChange, onRemove }: Props) {
  const player = usePlayer();
  const { user } = useAuth();
  const nav = useNavigate();
  const [showPl, setShowPl] = useState(false);
  const isCur = player.isCurrent(audio.id);
  const playing = isCur && player.playing;
  const ready = audio.status === "ready";
  const sorted = sortTags(audio.tags);
  const audience = sorted.filter(isAudienceTag);
  const rest = sorted.filter((t) => !isAudienceTag(t));
  const desc = audio.description.trim();
  const like = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!user) return nav("/login");
    onChange?.(audio.id, { liked: !audio.liked, likes: audio.likes + (audio.liked ? -1 : 1) });
    try { const r = await api.post<{ liked: boolean; likes: number }>(`/api/audios/${audio.id}/like`); onChange?.(audio.id, r); }
    catch { onChange?.(audio.id, { liked: audio.liked, likes: audio.likes }); }
  };
  const copy = () => navigator.clipboard.writeText(`${location.origin}${audioPath(audio)}`).catch(() => {});
  const del = async () => {
    if (!confirm(`Delete "${audio.title}"?`)) return;
    await api.del(`/api/audios/${audio.id}`);
    player.remove(audio.id);
    onRemove?.(audio.id);
  };
  return (
    <div className={`group flex gap-4 rounded-2xl px-3 py-3 -mx-3 transition-colors ${isCur ? "bg-accent/10" : "hover:bg-surface"}`}>
      <div className="relative shrink-0 self-start">
        <Cover id={audio.id} size={88} rounded="rounded-xl" />
        <button
          className={`absolute inset-0 m-auto h-10 w-10 rounded-full flex items-center justify-center shadow ${ready ? `bg-accent text-white ${isCur ? "opacity-100" : "opacity-0 group-hover:opacity-100"}` : "bg-black/50 text-white"} transition-opacity`}
          onClick={() => ready && (playing ? player.pause() : player.play(audio, queue))} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
          {audio.status === "processing" ? <Loader2 size={18} className="animate-spin" /> : audio.status === "failed" ? <AlertTriangle size={18} /> : playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
        </button>
        <span className="mono absolute right-1 bottom-1 rounded-md bg-black/60 px-1 py-px text-[0.62rem] text-white">{ready ? fmtDuration(audio.duration) : audio.status}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {audience.slice(0, 2).map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="chip-audience">{displayTag(t)}</Link>)}
              <Link to={audioPath(audio)} className="font-bold leading-snug hover:text-accent-2">{audio.title}</Link>
            </div>
            <div className="mono mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.7rem] text-muted">
              {showUser && <Link to={userPath(audio.user)} className="text-fg/80 hover:text-fg">{audio.user.displayName}</Link>}
              <span>{fmtCount(audio.plays)} plays</span>
              <button onClick={like} className={`inline-flex items-center gap-1 hover:text-accent-2 ${audio.liked ? "text-accent-2" : ""}`} aria-label="Like"><Heart size={11} fill={audio.liked ? "currentColor" : "none"} /> {fmtCount(audio.likes)}</button>
              <span>{timeAgo(audio.createdAt)}</span>
              {audio.visibility === "private" && <Lock size={11} className="text-amber-400" />}
              {audio.visibility === "unlisted" && <Link2 size={11} className="text-sky-400" />}
            </div>
          </div>
          <Menu trigger={<span className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg text-base leading-none">···</span>}>
            <MenuItem icon={<ListPlus size={15} />} onClick={() => (user ? setShowPl(true) : nav("/login"))}>Save to playlist</MenuItem>
            <MenuItem icon={<Share2 size={15} />} onClick={copy}>Copy link</MenuItem>
            {audio.downloadUrl && <MenuItem icon={<Download size={15} />} href={audio.downloadUrl} download>Download</MenuItem>}
            {audio.isOwner && <>
              <div className="my-1 border-t border-border" />
              <MenuItem icon={<Pencil size={15} />} onClick={() => nav(`/edit/${audio.id}`)}>Edit</MenuItem>
              <MenuItem icon={<Trash2 size={15} />} onClick={del} danger>Delete</MenuItem>
            </>}
          </Menu>
        </div>
        {desc && <p className="mt-1.5 text-[0.82rem] leading-snug text-muted line-clamp-2">{desc}</p>}
        {audio.versions && <div className="mt-2"><VersionSwitch audio={audio} size="sm" /></div>}
        {rest.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {rest.slice(0, 6).map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="chip py-0.5 px-2 text-[0.68rem]">{t}</Link>)}
            {rest.length > 6 && <span className="chip py-0.5 px-2 text-[0.68rem]">+{rest.length - 6}</span>}
          </div>
        )}
      </div>
      {showPl && <AddToPlaylist audioId={audio.id} onClose={() => setShowPl(false)} />}
    </div>
  );
}

export type Layout = "grid" | "rows";
export function AudioList({ audios, showUser = true, empty = "Nothing here yet.", layout = "grid", onChange, onRemove }: { audios: ApiAudio[]; showUser?: boolean; empty?: React.ReactNode; layout?: Layout; onChange?: Props["onChange"]; onRemove?: Props["onRemove"] }) {
  if (!audios.length) return <div className="card border-dashed text-muted text-sm py-14 text-center">{empty}</div>;
  if (layout === "rows" || THEME === "ember") {
    return <div className="max-w-3xl divide-y divide-border/60">{audios.map((a) => <AudioRow key={a.id} audio={a} queue={audios} showUser={showUser} onChange={onChange} onRemove={onRemove} />)}</div>;
  }
  return (
    <div className="grid gap-x-5 gap-y-7 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {audios.map((a) => <AudioCard key={a.id} audio={a} queue={audios} showUser={showUser} onChange={onChange} onRemove={onRemove} />)}
    </div>
  );
}
