import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

export function TagInput({ value, onChange, placeholder = "Add tags, press Enter" }: { value: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft.split(/[,\[\]{}]+/).map((s) => s.trim().toLowerCase().replace(/^#/, "")).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])].slice(0, 30));
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
    else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="input flex flex-wrap gap-1.5 items-center min-h-10 cursor-text" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent/15 text-accent-2 px-2 py-0.5 text-xs">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="hover:text-white" aria-label={`Remove ${t}`}><X size={12} /></button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[8rem] bg-transparent outline-none text-sm placeholder:text-muted"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={value.length ? "" : placeholder}
      />
    </div>
  );
}
