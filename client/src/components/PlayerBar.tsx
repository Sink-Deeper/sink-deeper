import { Link } from "react-router-dom";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Loader2, Repeat, Repeat1 } from "lucide-react";
import { usePlayer, SPEEDS } from "../lib/player";
import { audioPath, userPath } from "../lib/api";
import { fmtDuration } from "../lib/format";
import { Cover } from "./Cover";

export function PlayerBar() {
  const p = usePlayer();
  if (!p.current) return null;
  const a = p.current;
  const dur = p.duration || a.duration || 0;
  const frac = dur ? p.time / dur : 0;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md">
      <div
        className="h-1 w-full bg-surface-2 cursor-pointer group"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); p.seek(((e.clientX - r.left) / r.width) * dur); }}
      >
        <div className="h-full bg-accent group-hover:bg-accent-2" style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="mx-auto max-w-7xl px-3 sm:px-4 h-[72px] flex items-center gap-3 sm:gap-5">
        <div className="flex items-center gap-1">
          <button className="btn-ghost p-2" onClick={p.prev} aria-label="Previous"><SkipBack size={18} /></button>
          <button className="h-11 w-11 rounded-full bg-fg text-ink hover:bg-white flex items-center justify-center" onClick={() => p.toggle()} aria-label={p.playing ? "Pause" : "Play"}>
            {p.loading ? <Loader2 size={18} className="animate-spin" /> : p.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>
          <button className="btn-ghost p-2" onClick={p.next} aria-label="Next"><SkipForward size={18} /></button>
          <button
            className={`btn-ghost p-2 ${p.loop !== "off" ? "text-accent" : "text-muted"}`}
            onClick={p.cycleLoop}
            aria-label={p.loop === "one" ? "Repeating this audio" : p.loop === "all" ? "Playing through the list" : "Stops when this audio ends"}
            title={p.loop === "one" ? "Repeat this audio" : p.loop === "all" ? "Play through the list, then start again" : "Stop when this audio ends"}
          >
            {p.loop === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </button>
        </div>
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <Cover id={a.id} size={44} rounded="rounded-lg" className="hidden sm:block" />
          <div className="min-w-0">
            <Link to={audioPath(a)} className="block truncate text-sm font-bold hover:text-accent-2">{a.title}</Link>
            {p.error
              ? <span className="block truncate text-xs text-amber-300" role="status">{p.error}</span>
              : <Link to={userPath(a.user)} className="block truncate text-xs text-muted hover:text-fg">{a.user.displayName}</Link>}
          </div>
        </div>
        <div className="mono text-[0.72rem] text-muted whitespace-nowrap">{fmtDuration(p.time)} / {fmtDuration(dur)}</div>
        <select
          className="hidden sm:block bg-transparent text-xs text-muted hover:text-fg cursor-pointer outline-none"
          value={p.rate}
          onChange={(e) => p.setRate(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {SPEEDS.map((s) => <option key={s} value={s} className="bg-surface">{s}×</option>)}
        </select>
        <div className="hidden md:flex items-center gap-2">
          <button className="text-muted hover:text-fg" onClick={() => p.setVolume(p.volume ? 0 : 1)} aria-label="Mute">
            {p.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <input type="range" min={0} max={1} step={0.02} value={p.volume} onChange={(e) => p.setVolume(Number(e.target.value))} className="w-24 accent-accent" aria-label="Volume" />
        </div>
      </div>
    </div>
  );
}
