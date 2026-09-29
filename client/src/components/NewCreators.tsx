import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ApiNewCreator } from "../lib/api";
import { Avatar } from "./Avatar";

const fmtHours = (h: number) => (h >= 1 ? `${h.toFixed(h < 10 ? 1 : 0)} hours` : `${Math.max(1, Math.round(h * 60))} min`);

/** Homepage row for creators who just arrived, so their first uploads find listeners. Hidden unless there are two or more. */
export function NewCreators() {
  const [list, setList] = useState<ApiNewCreator[] | null>(null);
  useEffect(() => {
    api.get<{ creators: ApiNewCreator[] }>("/api/browse/new-creators").then((r) => setList(r.creators)).catch(() => setList([]));
  }, []);
  if (!list || list.length < 2) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="eyebrow">New on Sinkdeeper</h3>
        <Link to="/creators" className="text-xs text-accent-2 hover:underline">All creators</Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {list.map((c) => (
          <Link key={c.id} to={`/u/${c.username}`} className="card snap-start shrink-0 w-64 p-3 flex gap-3 items-center hover:border-muted/60 transition-colors">
            <Avatar name={c.username} src={c.avatarUrl} size={44} />
            <div className="min-w-0">
              <div className="font-semibold truncate">{c.displayName}</div>
              <div className="mono text-[0.68rem] text-muted">{c.audioCount} audio{c.audioCount === 1 ? "" : "s"} · {fmtHours(c.hours)}</div>
              {c.latest && <div className="text-xs text-muted truncate mt-0.5">Latest: {c.latest.title}</div>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
