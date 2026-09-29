import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, userPath } from "../lib/api";
import { usePagedAudios } from "../lib/usePaged";
import { PagedList } from "../components/PagedList";
import { Avatar } from "../components/Avatar";
import { displayTag } from "../lib/format";

type Sort = "new" | "top" | "liked";
function SortTabs({ sort, setSort }: { sort: Sort; setSort: (s: Sort) => void }) {
  return (
    <div className="flex gap-1 text-sm">
      {(["new", "top", "liked"] as Sort[]).map((s) => (
        <button key={s} onClick={() => setSort(s)} className={`px-3 py-1.5 rounded-lg ${sort === s ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}>
          {s === "new" ? "Newest" : s === "top" ? "Most played" : "Most liked"}
        </button>
      ))}
    </div>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = (params.get("sort") as Sort) || "new";
  const paged = usePagedAudios(`/api/browse/search?q=${encodeURIComponent(q)}&sort=${sort}`);
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => {
    api.get<{ users: any[] }>(`/api/browse/search?q=${encodeURIComponent(q)}`).then((r) => setUsers(r.users)).catch(() => {});
  }, [q]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl">Results for “{q}”</h1>
        <SortTabs sort={sort} setSort={(s) => setParams({ q, sort: s })} />
      </div>
      {users.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {users.map((u) => (
            <Link key={u.id} to={userPath(u)} className="card px-3 py-2 flex items-center gap-2 hover:border-muted/50">
              <Avatar name={u.username} src={u.avatarUrl} size={28} />
              <div><div className="text-sm font-medium leading-tight">{u.displayName}</div><div className="text-xs text-muted">{u.audioCount} audios</div></div>
            </Link>
          ))}
        </div>
      )}
      <PagedList {...paged} layout="rows" empty="No matches. Try fewer words, or browse by tag." />
    </div>
  );
}

export function TagPage() {
  const { tag = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const sort = (params.get("sort") as Sort) || "new";
  const paged = usePagedAudios(`/api/browse/search?tags=${encodeURIComponent(tag)}&sort=${sort}`);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl">#{displayTag(tag)}</h1>
        <SortTabs sort={sort} setSort={(s) => setParams({ sort: s })} />
      </div>
      <PagedList {...paged} layout="rows" empty="Nothing tagged with this yet." />
    </div>
  );
}

export function TagsIndex() {
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  useEffect(() => { api.get<{ tags: any[] }>("/api/browse/tags").then((r) => setTags(r.tags)).catch(() => {}); }, []);
  const max = tags[0]?.count ?? 1;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl">Browse by tag</h1>
      {tags.length === 0 && <p className="text-muted text-sm">No tags yet.</p>}
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <Link key={t.name} to={`/tags/${encodeURIComponent(t.name)}`} className="chip py-1 px-3" style={{ fontSize: `${0.8 + 0.6 * (t.count / max)}rem` }}>
            {displayTag(t.name)} <span className="opacity-60 ml-1">{t.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
