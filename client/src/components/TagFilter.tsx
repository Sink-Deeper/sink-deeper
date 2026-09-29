import { useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { displayTag, isAudienceTag } from "../lib/format";

export function TagFilter({ tags, selected, onChange, limit = 18 }: { tags: { name: string; count: number }[]; selected: string[]; onChange: (t: string[]) => void; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!tags.length && !selected.length) return null;
  // Audience tags (F4M, M4F...) always lead and are always offered; the rest are the most-used tags, listed
  // alphabetically so they're easy to scan.
  const audience = tags.filter((t) => isAudienceTag(t.name));
  const others = tags.filter((t) => !isAudienceTag(t.name));
  const shown = [...audience.sort((a, b) => a.name.localeCompare(b.name)), ...(all ? others : others.slice(0, limit)).sort((a, b) => a.name.localeCompare(b.name))];
  const toggle = (t: string) => onChange(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.filter((t) => !shown.some((s) => s.name === t)).map((t) => (
        <button key={t} onClick={() => toggle(t)} className="chip-active">{displayTag(t)} <X size={12} className="ml-1" /></button>
      ))}
      {shown.map((t) => {
        const on = selected.includes(t.name);
        return (
          <button key={t.name} onClick={() => toggle(t.name)} className={on ? "chip-active" : "chip"} title={`${t.count} audio${t.count === 1 ? "" : "s"}`}>
            {displayTag(t.name)}{on && <X size={12} className="ml-1" />}
          </button>
        );
      })}
      {others.length > limit && (
        <button onClick={() => setAll((a) => !a)} className="chip text-accent-2">
          {all ? <>less <ChevronUp size={12} className="ml-0.5" /></> : <>+{others.length - limit} more <ChevronDown size={12} className="ml-0.5" /></>}
        </button>
      )}
      {selected.length > 0 && <button onClick={() => onChange([])} className="text-xs text-muted hover:text-fg ml-1">clear</button>}
    </div>
  );
}

export function SortTabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-full bg-surface border border-border p-1 text-sm">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={`px-3.5 py-1.5 rounded-full font-semibold transition-colors ${value === o.value ? "bg-fg text-ink" : "text-muted hover:text-fg"}`}>{o.label}</button>
      ))}
    </div>
  );
}
