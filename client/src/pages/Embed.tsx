import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Play, Pause } from "lucide-react";
import { api, audioPath, type ApiAudio } from "../lib/api";
import { Waveform } from "../components/Waveform";
import { fmtDuration } from "../lib/format";

/** Standalone embeddable player (no site chrome, own <audio>). */
export function EmbedPage() {
  const { id } = useParams();
  const [audio, setAudio] = useState<ApiAudio | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [ok, setOk] = useState(() => { try { return localStorage.getItem("age-ok") === "1"; } catch { return false; } });
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { api.get<{ audio: ApiAudio }>(`/api/audios/${id}`).then((r) => setAudio(r.audio)).catch(() => {}); }, [id]);
  if (!audio || !audio.streamUrl) return <div className="p-4 text-sm text-muted">Unavailable</div>;
  const dur = audio.duration;
  if (!ok) {
    return (
      <div className="p-3 flex gap-3 items-center h-screen bg-surface">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{audio.title} <span className="text-muted">· {audio.user.displayName}</span></div>
          <div className="text-xs text-muted mt-0.5">This audio may contain adult content. Listeners must be 18 or older.</div>
        </div>
        <button className="btn-primary py-1.5 shrink-0" onClick={() => { try { localStorage.setItem("age-ok", "1"); } catch {} setOk(true); }}>I'm 18+, play</button>
      </div>
    );
  }
  return (
    <div className="p-3 flex gap-3 items-center h-screen bg-surface">
      <audio ref={ref} src={audio.streamUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} preload="metadata" />
      <button className="h-12 w-12 shrink-0 rounded-full bg-accent text-ink flex items-center justify-center" onClick={() => (playing ? ref.current?.pause() : ref.current?.play())}>
        {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between text-xs mb-1">
          <a href={audioPath(audio)} target="_blank" rel="noopener" className="truncate font-medium hover:text-accent-2">{audio.title} <span className="text-muted">· {audio.user.displayName}</span></a>
          <span className="text-muted tabular-nums shrink-0 ml-2">{fmtDuration(time)} / {fmtDuration(dur)}</span>
        </div>
        <Waveform peaks={audio.peaks} progress={dur ? time / dur : 0} height={56} onSeek={(f) => { if (ref.current) { ref.current.currentTime = f * dur; void ref.current.play(); } }} />
      </div>
    </div>
  );
}
