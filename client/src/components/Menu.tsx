import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export function Menu({ children, label = "More", align = "right", trigger }: { children: ReactNode; label?: string; align?: "left" | "right"; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="rounded-md p-1.5 text-muted hover:text-fg hover:bg-surface-2" aria-label={label} aria-expanded={open}>
        {trigger ?? <MoreHorizontal size={18} />}
      </button>
      {open && (
        <div className={`absolute z-30 mt-1 min-w-44 card p-1 shadow-xl ${align === "right" ? "right-0" : "left-0"}`} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, href, danger, download }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; download?: boolean }) {
  const cls = `w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left hover:bg-surface-2 ${danger ? "text-red-400" : ""}`;
  if (href) return <a href={href} className={cls} download={download}>{icon}{children}</a>;
  return <button type="button" onClick={onClick} className={cls}>{icon}{children}</button>;
}
