import { useEffect, useRef, useState, type PointerEvent } from "react";

type Props = {
  peaks?: number[];
  progress: number; // 0..1
  onSeek?: (fraction: number) => void;
  height?: number;
  className?: string;
  interactive?: boolean;
};

const FALLBACK = Array.from({ length: 120 }, (_, i) => 0.3 + 0.2 * Math.sin(i / 3) + 0.1 * Math.sin(i / 7));

/** Bar-style waveform on canvas. Played portion in accent, hover ghost, click/drag to seek. */
export function Waveform({ peaks, progress, onSeek, height = 96, className = "", interactive = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const data = peaks && peaks.length ? peaks : FALLBACK;

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const w = wrap.clientWidth, h = height, dpr = window.devicePixelRatio || 1;
      if (!w) return;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const barW = 2, gap = 1, step = barW + gap;
      const bars = Math.floor(w / step);
      const per = data.length / bars;
      const mid = h * 0.62; // asymmetric: taller top, shorter mirrored bottom
      const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const accent = cssVar("--color-accent") || "#e0a458";
      const played = progress * bars;
      const hov = hover === null ? -1 : hover * bars;

      for (let i = 0; i < bars; i++) {
        let max = 0;
        const start = Math.floor(i * per), end = Math.max(start + 1, Math.floor((i + 1) * per));
        for (let j = start; j < end && j < data.length; j++) if (data[j] > max) max = data[j];
        const amp = Math.max(0.04, Math.pow(max, 0.85));
        const top = amp * mid * 0.95, bottom = amp * (h - mid) * 0.8;
        const x = i * step;
        const isPlayed = i < played, isHover = hov >= 0 && i < hov && !isPlayed;
        ctx.fillStyle = isPlayed ? accent : isHover ? "rgba(224,164,88,0.45)" : "rgba(139,139,158,0.55)";
        ctx.fillRect(x, mid - top, barW, top);
        ctx.fillStyle = isPlayed ? "rgba(224,164,88,0.55)" : isHover ? "rgba(224,164,88,0.25)" : "rgba(139,139,158,0.25)";
        ctx.fillRect(x, mid + 1, barW, bottom);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [data, progress, hover, height]);

  const frac = (e: PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  return (
    <div
      ref={wrapRef}
      className={`relative w-full select-none ${interactive ? "cursor-pointer" : ""} ${className}`}
      style={{ height }}
      onPointerMove={(e) => { if (!interactive) return; const f = frac(e); setHover(f); if (dragging.current) onSeek?.(f); }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => { if (!interactive) return; dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); onSeek?.(frac(e)); }}
      onPointerUp={() => { dragging.current = false; }}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
