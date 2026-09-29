import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ApiAudio } from "./api";

export type LoopMode = "off" | "all" | "one";
type PlayerState = {
  loop: LoopMode;
  current: ApiAudio | null;
  queue: ApiAudio[];
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  rate: number;
  loading: boolean;
  error: string | null;
};
type PlayerCtx = PlayerState & {
  play: (audio: ApiAudio, queue?: ApiAudio[]) => void;
  toggle: (audio?: ApiAudio) => void;
  pause: () => void;
  seek: (sec: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  setRate: (r: number) => void;
  setLoop: (m: LoopMode) => void;
  cycleLoop: () => void;
  /** Drop an audio from the player (after it was deleted). Stops it if it's the one playing. */
  remove: (id: string) => void;
  isCurrent: (id: string) => boolean;
};

const Ctx = createContext<PlayerCtx | null>(null);

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
export { SPEEDS };

/** Read a number from localStorage, falling back when missing, malformed, or out of range. */
function storedNumber(key: string, def: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max && localStorage.getItem(key) !== null ? v : def;
  } catch { return def; }
}
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>(() => ({
    current: null, queue: [], playing: false, time: 0, duration: 0, loading: false, error: null,
    volume: storedNumber("vol", 1, 0, 1),
    rate: SPEEDS.includes(storedNumber("rate", 1, 0.5, 2)) ? storedNumber("rate", 1, 0.5, 2) : 1,
    loop: ((): LoopMode => { try { const v = localStorage.getItem("loop"); return v === "one" || v === "all" ? v : "off"; } catch { return "off"; } })(),
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const countedRef = useRef<string | null>(null);
  // Playback resilience. Phones drop or switch networks when the screen locks; the player must resume the same
  // audio from the same spot rather than give up or jump to another file.
  const wantPlayRef = useRef(false);   // the listener wants sound: set by play/load, cleared by any real pause or stop
  const reloadingRef = useRef(false);  // we're swapping the source ourselves; ignore the pause/timeupdate noise it causes
  const lastGoodRef = useRef(0);       // last position that actually played, to resume from
  const recoverRef = useRef<{ id: string; tries: number; timer: ReturnType<typeof setTimeout> | null; resumedAt: number }>({ id: "", tries: 0, timer: null, resumedAt: 0 });
  const stallRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; at: number }>({ timer: null, at: 0 });
  // Listening session for analytics: accumulates real listened seconds and furthest *played-through* position,
  // flushed every ~15s of listening and on pause/end/switch/unload. Seeks don't advance either number.
  const listenRef = useRef<{ audioId: string; sid: string; seconds: number; maxPos: number; lastT: number; sentAt: number } | null>(null);
  const flushListen = useCallback((keepalive = false) => {
    const l = listenRef.current;
    if (!l || l.seconds < 1 || l.seconds - l.sentAt < 0.5) return;
    l.sentAt = l.seconds;
    const body = JSON.stringify({ sid: l.sid, seconds: Math.round(l.seconds), position: Math.round(l.maxPos) });
    fetch(`/api/audios/${l.audioId}/listen`, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "same-origin", keepalive }).catch(() => {});
  }, []);

  const clearStall = () => { const st = stallRef.current; if (st.timer) { clearTimeout(st.timer); st.timer = null; } };

  // Lazily create the single <audio> element
  if (!audioRef.current && typeof window !== "undefined") {
    const el = new Audio();
    el.preload = "metadata";
    el.volume = state.volume;
    el.playbackRate = state.rate;
    audioRef.current = el;
  }

  const load = useCallback((audio: ApiAudio, queue?: ApiAudio[]) => {
    const el = audioRef.current!;
    if (!audio.streamUrl) return;
    flushListen();
    listenRef.current = { audioId: audio.id, sid: Math.random().toString(36).slice(2, 14), seconds: 0, maxPos: 0, lastT: 0, sentAt: 0 };
    wantPlayRef.current = true;
    lastGoodRef.current = 0;
    const r = recoverRef.current;
    if (r.timer) clearTimeout(r.timer);
    recoverRef.current = { id: audio.id, tries: 0, timer: null, resumedAt: 0 };
    clearStall();
    // Switching sources can emit a stray pause; don't let it cancel the listener's intent to hear this file
    reloadingRef.current = true;
    el.src = audio.streamUrl;
    el.load();
    // Some browsers reset playbackRate when the source changes
    el.playbackRate = stateRef.current.rate;
    setState((s) => ({ ...s, current: audio, queue: queue ?? s.queue, time: 0, duration: audio.duration, loading: true, error: null }));
    el.play().catch(() => {}).finally(() => { reloadingRef.current = false; });
    if (countedRef.current !== audio.id) {
      countedRef.current = audio.id;
      api.post(`/api/audios/${audio.id}/play`).catch(() => {});
    }
    if ("mediaSession" in navigator) {
      const art = audio.user.avatarUrl
        ? [{ src: audio.user.avatarUrl, sizes: "512x512", type: "image/webp" }]
        : [{ src: `${location.origin}/icon-512.png`, sizes: "512x512", type: "image/png" }];
      navigator.mediaSession.metadata = new MediaMetadata({ title: audio.title, artist: audio.user.displayName, album: "Sinkdeeper", artwork: art });
    }
  }, [flushListen]);

  const next = useCallback(() => {
    const { current, queue } = stateRef.current;
    const i = queue.findIndex((a) => a.id === current?.id);
    // Skip anything that can't play (still processing, failed)
    const n = queue.slice(i + 1).find((a) => a.status === "ready" && a.streamUrl);
    if (n) load(n); else setState((s) => ({ ...s, playing: false }));
  }, [load]);

  // What happens when a track ends depends on the loop mode
  const onEndedRef = useRef<() => void>(() => {});
  onEndedRef.current = () => {
    const el = audioRef.current!;
    const { loop, current, queue } = stateRef.current;
    if (loop === "one") { el.currentTime = 0; void el.play().catch(() => {}); return; }
    if (loop === "all") {
      const i = queue.findIndex((a) => a.id === current?.id);
      const rest = queue.slice(i + 1).find((a) => a.status === "ready" && a.streamUrl);
      const first = queue.find((a) => a.status === "ready" && a.streamUrl);
      if (rest) load(rest);
      else if (first && first.id !== current?.id) load(first);
      else { el.currentTime = 0; void el.play().catch(() => {}); }
      return;
    }
    // Loop off: stop when this audio ends. Never start a different file on its own.
    wantPlayRef.current = false;
    setState((s) => ({ ...s, playing: false }));
  };

  /**
   * Resume the current audio after a network drop, stall, or expired link: fetch a fresh signed URL (keeping the
   * old one if that fails), reload, and seek back to the last position that played. Backs off between attempts and
   * gives up after about a minute, leaving the player paused on the same audio. It never moves to another file.
   */
  const BACKOFF_S = [0, 1, 2, 4, 8, 15, 30];
  const recover = useCallback((immediate = false) => {
    const cur = stateRef.current.current;
    if (!cur || !wantPlayRef.current) return;
    const r = recoverRef.current;
    if (r.id !== cur.id) recoverRef.current = { id: cur.id, tries: 0, timer: null, resumedAt: 0 };
    const rr = recoverRef.current;
    if (rr.timer) { if (!immediate) return; clearTimeout(rr.timer); rr.timer = null; }
    if (rr.tries >= BACKOFF_S.length) {
      wantPlayRef.current = false;
      audioRef.current!.pause(); // leave the element in a clean paused state for the lock screen and the play button
      setState((s) => ({ ...s, playing: false, loading: false, error: "Lost the connection. Press play to pick up where you left off." }));
      return;
    }
    const delay = immediate ? 0 : BACKOFF_S[rr.tries] * 1000;
    rr.tries++;
    setState((s) => ({ ...s, loading: true }));
    rr.timer = setTimeout(async () => {
      rr.timer = null;
      if (!wantPlayRef.current || stateRef.current.current?.id !== cur.id) return;
      let url = stateRef.current.current?.streamUrl ?? cur.streamUrl;
      try {
        const { audio } = await api.get<{ audio: ApiAudio }>(`/api/audios/${cur.id}`);
        if (audio.streamUrl) {
          url = audio.streamUrl;
          setState((s) => (s.current?.id === audio.id ? { ...s, current: audio, queue: s.queue.map((q) => (q.id === audio.id ? audio : q)) } : s));
        }
      } catch { /* offline: try the link we have */ }
      if (!url || !wantPlayRef.current || stateRef.current.current?.id !== cur.id) return;
      const el = audioRef.current!;
      const pos = lastGoodRef.current;
      reloadingRef.current = true;
      rr.resumedAt = pos;
      el.src = url;
      el.load();
      el.playbackRate = stateRef.current.rate;
      el.addEventListener("loadedmetadata", () => { if (pos > 0) el.currentTime = pos; }, { once: true });
      el.play().catch(() => {}).finally(() => { reloadingRef.current = false; });
    }, delay);
  }, []);

  /** Update the lock-screen / notification controls with the real state and position. */
  const syncSession = useCallback(() => {
    if (!("mediaSession" in navigator)) return;
    const el = audioRef.current!;
    try { navigator.mediaSession.playbackState = stateRef.current.current ? (el.paused ? "paused" : "playing") : "none"; } catch {}
    if ("setPositionState" in navigator.mediaSession && Number.isFinite(el.duration) && el.duration > 0) {
      try { navigator.mediaSession.setPositionState({ duration: el.duration, playbackRate: el.playbackRate || 1, position: Math.min(Math.max(0, el.currentTime), el.duration) }); } catch {}
    }
  }, []);

  useEffect(() => {
    const el = audioRef.current!;
    const onTime = () => {
      if (!reloadingRef.current && !el.paused && el.currentTime > 0) {
        lastGoodRef.current = el.currentTime;
        // Progress means the stream is healthy again
        const st = stallRef.current;
        if (st.timer && el.currentTime - st.at > 0.5) clearStall();
        const r = recoverRef.current;
        if (r.tries && el.currentTime - r.resumedAt > 5) r.tries = 0;
      }
      const l = listenRef.current;
      if (l && !el.paused) {
        const d = el.currentTime - l.lastT;
        if (d > 0 && d < 2) { // natural playback; a seek jumps further than this
          l.seconds += d;
          if (el.currentTime > l.maxPos) l.maxPos = el.currentTime;
        }
        if (l.seconds - l.sentAt >= 15) flushListen();
      }
      if (l) l.lastT = el.currentTime;
      setState((s) => ({ ...s, time: el.currentTime }));
    };
    const onMeta = () => { setState((s) => ({ ...s, duration: el.duration || s.current?.duration || 0, loading: false })); syncSession(); };
    const onPlay = () => { setState((s) => ({ ...s, playing: true, error: null })); syncSession(); };
    const onPause = () => {
      flushListen();
      clearStall();
      // Any pause we didn't cause ourselves is intentional (button, lock screen, headphones unplugged, a call):
      // respect it and don't resume on our own later.
      if (!reloadingRef.current && !el.ended) wantPlayRef.current = false;
      if (!reloadingRef.current) setState((s) => ({ ...s, playing: false }));
      syncSession();
    };
    // Buffering: if the position hasn't moved after a while, the connection is gone; reload and resume.
    const onStall = () => {
      setState((s) => ({ ...s, loading: true }));
      const st = stallRef.current;
      if (!wantPlayRef.current || el.paused || st.timer) return;
      st.at = el.currentTime;
      st.timer = setTimeout(() => {
        st.timer = null;
        if (wantPlayRef.current && !el.paused && Math.abs(el.currentTime - st.at) < 0.5) recover();
      }, 10_000);
    };
    const onCanPlay = () => setState((s) => ({ ...s, loading: false }));
    const onEnded = () => { flushListen(); clearStall(); onEndedRef.current(); syncSession(); };
    const onError = () => { clearStall(); if (wantPlayRef.current) recover(); else setState((s) => ({ ...s, loading: false })); };
    const onUnload = () => flushListen(true);
    // Coming back online or unlocking the phone: if playback is broken, fix it now rather than waiting out the backoff.
    const onBackOnline = () => {
      if (!wantPlayRef.current || !stateRef.current.current) return;
      const stuck = !!el.error || (!el.paused && el.readyState < 3);
      if (stuck || recoverRef.current.timer) recover(true);
    };
    const onVisible = () => { if (document.visibilityState === "visible") onBackOnline(); };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("online", onBackOnline);
    document.addEventListener("visibilitychange", onVisible);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onStall);
    el.addEventListener("stalled", onStall);
    el.addEventListener("seeked", syncSession);
    el.addEventListener("ratechange", syncSession);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onStall);
      el.removeEventListener("stalled", onStall);
      el.removeEventListener("seeked", syncSession);
      el.removeEventListener("ratechange", syncSession);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("online", onBackOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearStall();
    };
  }, [flushListen, recover, syncSession]);

  const play = useCallback((audio: ApiAudio, queue?: ApiAudio[]) => {
    const el = audioRef.current!;
    if (stateRef.current.current?.id === audio.id) {
      wantPlayRef.current = true;
      if (queue) setState((s) => ({ ...s, queue }));
      if (stateRef.current.error || el.error) { recoverRef.current.tries = 0; recover(true); return; }
      void el.play().catch(() => {});
      return;
    }
    load(audio, queue);
  }, [load, recover]);

  const pause = useCallback(() => { wantPlayRef.current = false; audioRef.current!.pause(); }, []);
  const toggle = useCallback((audio?: ApiAudio) => {
    const el = audioRef.current!;
    const cur = stateRef.current.current;
    if (audio && cur?.id !== audio.id) return load(audio);
    if (!cur) return;
    // After a failed load the element can still report paused=false, so check for trouble first
    if (stateRef.current.error || el.error) { wantPlayRef.current = true; recoverRef.current.tries = 0; recover(true); return; }
    if (el.paused) { wantPlayRef.current = true; void el.play().catch(() => {}); }
    else { wantPlayRef.current = false; el.pause(); }
  }, [load, recover]);
  const seek = useCallback((sec: number) => {
    const el = audioRef.current!;
    el.currentTime = Math.max(0, Math.min(sec, el.duration || sec));
    lastGoodRef.current = el.currentTime;
    setState((s) => ({ ...s, time: el.currentTime }));
  }, []);

  const setLoop = useCallback((m: LoopMode) => { store("loop", m); setState((s) => ({ ...s, loop: m })); }, []);
  const cycleLoop = useCallback(() => {
    const order: LoopMode[] = ["off", "all", "one"];
    setLoop(order[(order.indexOf(stateRef.current.loop) + 1) % order.length]);
  }, [setLoop]);
  const prev = useCallback(() => {
    const el = audioRef.current!;
    if (el.currentTime > 3) return seek(0);
    const { current, queue } = stateRef.current;
    const i = queue.findIndex((a) => a.id === current?.id);
    const p = queue.slice(0, Math.max(0, i)).reverse().find((a) => a.status === "ready" && a.streamUrl);
    if (p) load(p); else seek(0);
  }, [load, seek]);

  const setVolume = useCallback((v: number) => {
    audioRef.current!.volume = v;
    store("vol", String(v));
    setState((s) => ({ ...s, volume: v }));
  }, []);
  const setRate = useCallback((r: number) => {
    audioRef.current!.playbackRate = r;
    store("rate", String(r));
    setState((s) => ({ ...s, rate: r }));
  }, []);

  const remove = useCallback((id: string) => {
    const el = audioRef.current!;
    const { current } = stateRef.current;
    if (current?.id === id) {
      wantPlayRef.current = false;
      el.pause();
      el.removeAttribute("src"); el.load();
      listenRef.current = null;
    }
    setState((s) => ({
      ...s,
      queue: s.queue.filter((a) => a.id !== id),
      ...(s.current?.id === id ? { current: null, playing: false, time: 0, duration: 0, loading: false } : {}),
    }));
  }, []);

  // Keyboard: space toggles when not typing or on a control; arrows seek
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName) || t.isContentEditable)) return;
      if (e.code === "Space") { e.preventDefault(); toggle(); }
      if (e.code === "ArrowRight" && stateRef.current.current) seek(audioRef.current!.currentTime + 10);
      if (e.code === "ArrowLeft" && stateRef.current.current) seek(audioRef.current!.currentTime - 10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h); } catch {} };
    set("play", () => { if (audioRef.current!.paused) toggle(); });
    set("pause", () => pause());
    set("stop", () => pause());
    set("nexttrack", () => next());
    set("previoustrack", () => prev());
    set("seekbackward", (d) => { seek(audioRef.current!.currentTime - (d.seekOffset ?? 15)); syncSession(); });
    set("seekforward", (d) => { seek(audioRef.current!.currentTime + (d.seekOffset ?? 15)); syncSession(); });
    set("seekto", (d) => { if (d.seekTime != null) { seek(d.seekTime); syncSession(); } });
  }, [toggle, pause, next, prev, seek, syncSession]);

  const value = useMemo<PlayerCtx>(
    () => ({ ...state, play, toggle, pause, seek, next, prev, setVolume, setRate, setLoop, cycleLoop, remove, isCurrent: (id) => state.current?.id === id }),
    [state, play, toggle, pause, seek, next, prev, setVolume, setRate, setLoop, cycleLoop, remove],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
}
