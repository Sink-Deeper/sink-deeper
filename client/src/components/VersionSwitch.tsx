import { Link } from "react-router-dom";
import { audioPath, type ApiAudio } from "../lib/api";

/**
 * Pills for the versions of one work (F4M / F4A ...). Each version keeps its own page, so switching is a link and
 * shared URLs keep pointing at the version that was shared.
 */
export function VersionSwitch({ audio, size = "md" }: { audio: Pick<ApiAudio, "id" | "user" | "versions">; size?: "sm" | "md" }) {
  const versions = audio.versions;
  if (!versions || versions.length < 2) return null;
  const sm = size === "sm";
  return (
    <div className={`inline-flex flex-wrap items-center gap-1 ${sm ? "" : "rounded-full border border-border bg-surface p-1"}`} role="group" aria-label="Versions">
      {sm && <span className="mono text-[0.68rem] text-muted mr-0.5">{versions.length} versions</span>}
      {versions.map((v) => {
        const on = v.id === audio.id;
        const cls = sm
          ? `rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${on ? "bg-accent/20 text-accent-2" : "bg-surface-2 text-muted hover:text-fg"}`
          : `rounded-full px-3.5 py-1 text-sm font-semibold transition-colors ${on ? "bg-accent text-white" : "text-muted hover:text-fg hover:bg-surface-2"}`;
        return on
          ? <span key={v.id} className={cls} aria-current="true">{v.label}</span>
          : <Link key={v.id} to={audioPath({ slug: v.slug, user: audio.user })} className={cls} title={`Switch to the ${v.label} version`}>{v.label}</Link>;
      })}
    </div>
  );
}
