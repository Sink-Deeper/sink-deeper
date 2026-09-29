/**
 * Generated cover art. Audio has no artwork, so every track gets a deterministic tile built from its id:
 * a two-tone gradient plus a bar field that reads as a waveform. Same id, same cover, everywhere.
 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let x = seed || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

export function coverColors(id: string) {
  const h = hash(id);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 60)) % 360;
  return { a: `hsl(${hue} 65% 52%)`, b: `hsl(${hue2} 70% 30%)`, hue };
}

export function Cover({ id, size = 160, className = "", rounded = "rounded-xl" }: { id: string; size?: number | string; className?: string; rounded?: string }) {
  const { a, b } = coverColors(id);
  const r = rng(hash(id + "bars"));
  const bars = Array.from({ length: 28 }, () => 0.15 + r() * 0.85);
  const style = typeof size === "number" ? { width: size, height: size } : { width: size, aspectRatio: "1 / 1" as const };
  return (
    <div data-cover className={`shrink-0 overflow-hidden ${rounded} ${className}`} style={style} aria-hidden>
      <svg viewBox="0 0 100 100" className="block h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#g-${id})`} />
        <rect width="100" height="100" fill="rgba(0,0,0,0.18)" />
        {bars.map((v, i) => {
          const w = 100 / bars.length;
          const hgt = v * 46;
          return <rect key={i} x={i * w + w * 0.22} y={62 - hgt / 2} width={w * 0.56} height={hgt} rx={w * 0.28} fill="rgba(255,255,255,0.82)" />;
        })}
      </svg>
    </div>
  );
}
