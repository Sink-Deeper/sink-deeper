import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/** A read-only field showing a link (or embed code) with a copy button. Click the text to select it all. */
export function CopyField({ value, label, mono = true, textarea = false }: { value: string; label?: string; mono?: boolean; textarea?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); }
    catch { return; } // clipboard blocked (insecure context): the field is still selectable
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const cls = `input flex-1 min-w-0 ${mono ? "mono text-[0.75rem]" : "text-sm"} bg-surface-2/60`;
  return (
    <div className="space-y-1">
      {label && <div className="eyebrow">{label}</div>}
      <div className="flex items-center gap-2">
        {textarea
          ? <textarea readOnly value={value} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} className={`${cls} min-h-16 resize-none`} spellCheck={false} />
          : <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} className={cls} spellCheck={false} />}
        <button type="button" onClick={copy} className="btn-outline shrink-0" aria-label={`Copy ${label ?? "link"}`}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
