import { coverColors } from "./Cover";

/** Round profile photo when the user has one, otherwise a monogram on a gradient derived from the name. */
export function Avatar({ name, src, size = 36, className = "" }: { name: string; src?: string | null; size?: number; className?: string }) {
  if (src) {
    return <img src={src} alt="" width={size} height={size} className={`shrink-0 rounded-full object-cover bg-surface-2 select-none ${className}`} style={{ width: size, height: size }} loading="lazy" draggable={false} />;
  }
  const { a, b } = coverColors(name.toLowerCase());
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center font-extrabold text-white select-none ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.44, background: `linear-gradient(135deg, ${a}, ${b})` }}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
