import { useId, useState } from "react";
import { fmtDuration, fmtCount } from "../lib/format";

/* Single-series charts in plain SVG. One hue (the site accent); text uses text tokens; thin marks,
   rounded data ends, recessive grid, hover tooltip, and a table toggle for accessibility. */

const ACCENT = "var(--color-accent)";
const GRID = "rgba(139,139,158,0.18)";

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1 leading-none">{value}</div>
      {sub && <div className="text-xs text-muted mt-1.5">{sub}</div>}
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function shortDate(d: string) {
  const [, m, day] = d.split("-");
  return `${Number(day)} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1]}`;
}

export function DailyBars({ title, days, values, format = fmtCount, height = 160 }: { title: string; days: string[]; values: number[]; format?: (v: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const W = 640, H = height, padL = 36, padB = 20, padT = 8;
  const max = niceMax(Math.max(...values, 0));
  const n = values.length;
  const innerW = W - padL - 4, innerH = H - padB - padT;
  const step = innerW / n;
  const barW = Math.max(2, step - 2); // 2px surface gap between bars
  const total = values.reduce((a, b) => a + b, 0);
  const ticks = max <= 2 ? [0, max] : [0, 0.5, 1].map((f) => f * max);
  const labelEvery = Math.ceil(n / 6);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">{title} <span className="text-muted font-normal">· {format(total)} total</span></div>
        <button onClick={() => setTable((t) => !t)} className="text-xs text-muted hover:text-fg">{table ? "Chart" : "Table"}</button>
      </div>
      {table ? (
        <div className="max-h-48 overflow-y-auto text-xs">
          <table className="w-full"><tbody>
            {days.map((d, i) => values[i] > 0 && <tr key={d} className="border-t border-border"><td className="py-1 text-muted">{d}</td><td className="py-1 text-right tabular-nums">{format(values[i])}</td></tr>)}
            {total === 0 && <tr><td className="py-2 text-muted">No activity in this period.</td></tr>}
          </tbody></table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-labelledby={id} onMouseLeave={() => setHover(null)}>
            <title id={id}>{title}: daily values for the last {n} days</title>
            {ticks.map((t) => {
              const y = padT + innerH - (t / max) * innerH;
              return <g key={t}><line x1={padL} x2={W - 4} y1={y} y2={y} stroke={GRID} strokeWidth={1} /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--color-muted)">{format(t)}</text></g>;
            })}
            {values.map((v, i) => {
              const h = Math.max(v > 0 ? 2 : 0, (v / max) * innerH);
              const x = padL + i * step + (step - barW) / 2;
              const y = padT + innerH - h;
              const r = Math.min(4, barW / 2, h);
              const path = h > 0 ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z` : "";
              return (
                <g key={i}>
                  {path && <path d={path} fill={ACCENT} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  <rect x={padL + i * step} y={padT} width={step} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {i % labelEvery === 0 && <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-muted)">{shortDate(days[i])}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute -top-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs shadow-lg" style={{ left: `${((padL + hover * step + step / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
              <div className="text-muted">{days[hover]}</div><div className="font-medium tabular-nums">{format(values[hover])}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Share of listening sessions still going at each point of the file. */
export function RetentionCurve({ retention, duration }: { retention: (number | null)[]; duration: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = 1200, H = 240, padL = 40, padB = 20, padT = 8;
  const innerW = W - padL - 8, innerH = H - padB - padT;
  const pts = retention.map((r, i) => ({ x: padL + (i / (retention.length - 1)) * innerW, y: padT + innerH - (r ?? 0) * innerH, r }));
  const has = retention.some((r) => r !== null);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x},${padT + innerH} L${pts[0].x},${padT + innerH} Z`;
  return (
    <div className="card p-4">
      <div className="text-sm font-medium mb-2">Listener retention <span className="text-muted font-normal">· how far into the file people get</span></div>
      {!has ? <p className="text-xs text-muted py-8 text-center">No listening sessions recorded yet. Retention appears once people play this audio.</p> : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-labelledby={id} onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const f = ((e.clientX - r.left) / r.width * W - padL) / innerW; setHover(Math.max(0, Math.min(pts.length - 1, Math.round(f * (pts.length - 1))))); }}>
            <title id={id}>Retention curve: percentage of sessions reaching each point of the audio</title>
            {[0, 0.5, 1].map((t) => { const y = padT + innerH - t * innerH; return <g key={t}><line x1={padL} x2={W - 8} y1={y} y2={y} stroke={GRID} /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--color-muted)">{Math.round(t * 100)}%</text></g>; })}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={padL + t * innerW} y={H - 6} textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"} fontSize={10} fill="var(--color-muted)">{fmtDuration(t * duration)}</text>)}
            <path d={area} fill={ACCENT} opacity={0.12} />
            <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" />
            {hover !== null && <><line x1={pts[hover].x} x2={pts[hover].x} y1={padT} y2={padT + innerH} stroke="rgba(139,139,158,0.5)" /><circle cx={pts[hover].x} cy={pts[hover].y} r={4} fill={ACCENT} stroke="var(--color-surface)" strokeWidth={2} /></>}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute -top-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs shadow-lg" style={{ left: `${(pts[hover].x / W) * 100}%`, transform: "translateX(-50%)" }}>
              <div className="text-muted">at {fmtDuration((hover / (pts.length - 1)) * duration)}</div><div className="font-medium tabular-nums">{Math.round((pts[hover].r ?? 0) * 100)}% still listening</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
