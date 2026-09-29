import { Download } from "lucide-react";

export function DownloadToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="card p-3 flex items-center gap-3 cursor-pointer hover:border-muted/60">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${value ? "bg-accent/20 text-accent-2" : "bg-surface-2 text-muted"}`}><Download size={18} /></div>
      <div className="flex-1">
        <div className="text-sm font-medium">Allow downloads</div>
        <div className="text-xs text-muted">{value ? "Listeners get a Download button for the streaming-quality file." : "Stream only. You can still download your own copy."}</div>
      </div>
      <input type="checkbox" className="sr-only" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className={`relative h-6 w-11 rounded-full transition-colors ${value ? "bg-accent" : "bg-border"}`} aria-hidden>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value ? "translate-x-5.5 left-0" : "left-0.5"}`} />
      </span>
    </label>
  );
}
