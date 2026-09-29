import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Play, Heart, Users, Music } from "lucide-react";
import { api, type ApiCreator } from "../lib/api";
import { Avatar } from "../components/Avatar";
import { PageSpinner } from "../components/Spinner";
import { SortTabs } from "../components/TagFilter";
import { fmtCount } from "../lib/format";

type Sort = "plays" | "followers" | "new";

export function CreatorsPage() {
  const [params, setParams] = useSearchParams();
  const sort = (params.get("sort") as Sort) || "plays";
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const [creators, setCreators] = useState<ApiCreator[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const load = (p: number, append: boolean) =>
    api.get<{ creators: ApiCreator[]; hasMore: boolean }>(`/api/browse/creators?sort=${sort}&q=${encodeURIComponent(q)}&page=${p}`)
      .then((r) => { setCreators((c) => (append && c ? [...c, ...r.creators] : r.creators)); setHasMore(r.hasMore); setPage(p); })
      .catch(() => setCreators([]));
  useEffect(() => { setCreators(null); void load(1, false); }, [sort, q]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl">Creators</h1>
          <p className="text-sm text-muted">Everyone with public uploads. Follow to get their new work in your feed.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <form onSubmit={(e) => { e.preventDefault(); setParams({ sort, q: draft }); }}>
            <input className="input w-56 py-1.5" placeholder="Find a creator" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </form>
          <SortTabs value={sort} onChange={(s) => setParams({ sort: s, q })} options={[{ value: "plays", label: "Most played" }, { value: "followers", label: "Most followed" }, { value: "new", label: "Newest" }]} />
        </div>
      </div>
      {creators === null ? <PageSpinner /> : creators.length === 0 ? (
        <div className="card border-dashed text-muted text-sm py-14 text-center">No creators found.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {creators.map((c) => (
            <Link key={c.id} to={`/u/${c.username}`} className="card p-4 flex gap-4 hover:border-muted/60 hover:shadow-lg hover:shadow-black/30 transition-all">
              <Avatar name={c.username} src={c.avatarUrl} size={56} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{c.displayName}</div>
                <div className="text-xs text-muted">@{c.username}</div>
                {c.bio && <p className="text-xs text-muted mt-1.5 line-clamp-2">{c.bio}</p>}
                <div className="mt-2 flex gap-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1"><Music size={11} /> {c.audioCount}</span>
                  <span className="inline-flex items-center gap-1"><Play size={11} /> {fmtCount(c.plays)}</span>
                  <span className="inline-flex items-center gap-1"><Heart size={11} /> {fmtCount(c.likes)}</span>
                  <span className="inline-flex items-center gap-1"><Users size={11} /> {fmtCount(c.followers)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {hasMore && <div className="flex justify-center py-4"><button className="btn-outline" onClick={() => load(page + 1, true)}>Load more</button></div>}
    </div>
  );
}
