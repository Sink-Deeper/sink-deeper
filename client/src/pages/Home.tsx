import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePagedAudios } from "../lib/usePaged";
import { PagedList } from "../components/PagedList";
import { TagFilter, SortTabs } from "../components/TagFilter";
import { NewCreators } from "../components/NewCreators";
import { THEME } from "../lib/theme";

type Sort = "new" | "top" | "liked";
const SORTS: { value: Sort; label: string }[] = [{ value: "new", label: "Newest" }, { value: "top", label: "Most played" }, { value: "liked", label: "Most liked" }];

export function Home({ mode }: { mode: "explore" | "following" }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const sort = (params.get("sort") as Sort) || "new";
  const selected = useMemo(() => (params.get("tags") ?? "").split(",").filter(Boolean), [params]);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [stats, setStats] = useState<{ audios: number; hours: number; users: number } | null>(null);

  useEffect(() => {
    api.get<{ tags: any[] }>("/api/browse/tags").then((r) => setTags(r.tags)).catch(() => {});
    api.get<any>("/api/browse/stats").then(setStats).catch(() => {});
  }, []);

  const url =
    mode === "following"
      ? user ? "/api/browse/following" : null
      : selected.length ? `/api/browse/search?tags=${encodeURIComponent(selected.join(","))}&sort=${sort}` : `/api/browse/feed?sort=${sort}`;
  const paged = usePagedAudios(url);
  const set = (patch: { sort?: Sort; tags?: string[] }) => {
    const next = new URLSearchParams(params);
    if (patch.sort) next.set("sort", patch.sort);
    if (patch.tags) { if (patch.tags.length) next.set("tags", patch.tags.join(",")); else next.delete("tags"); }
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      {!user && mode === "explore" && THEME === "noir" && (
        <section className="pt-6 pb-12 border-b border-border">
          <h1 className="text-5xl sm:text-7xl leading-[0.95] max-w-4xl">Audio,<br />hosted properly.</h1>
          <div className="mt-8 flex flex-col sm:flex-row sm:items-end gap-6 sm:gap-12">
            <p className="text-muted max-w-md text-base leading-relaxed">Upload once, share a link, let people find you. A real player, tags, search and playlists. Stats for creators. Free, and no email needed.</p>
            <div className="flex gap-3">
              <Link to="/register" className="btn-primary px-5 py-2.5">Start uploading</Link>
              <Link to="/import" className="btn-outline px-5 py-2.5">Import from Soundgasm</Link>
            </div>
          </div>
        </section>
      )}
      {!user && mode === "explore" && THEME === "ember" && (
        <section className="pt-4 pb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-xl">
            <h1 className="text-4xl sm:text-5xl leading-[1.02]">Your audio, hosted properly.</h1>
            <p className="text-muted mt-3 text-lg">A real player, tags, search and playlists for listeners. Stats for you. Free, and no email needed.</p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link to="/register" className="btn-primary px-5 py-2.5">Start uploading</Link>
            <Link to="/import" className="btn-outline px-5 py-2.5">Import from Soundgasm</Link>
          </div>
        </section>
      )}
      {!user && mode === "explore" && (THEME === "violet" || THEME === "paper" || THEME === "rose" || THEME === "grape") && (
        <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-border">
          <div>
            <h1 className="text-2xl sm:text-[1.7rem] leading-tight">Free audio hosting for adults.</h1>
            <p className="text-muted text-sm mt-1">A real player, tags, search, playlists and creator stats. No email needed.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link to="/register" className="btn-primary">Start uploading</Link>
            <Link to="/import" className="btn-outline">Import from Soundgasm</Link>
          </div>
        </section>
      )}

      {mode === "explore" && !selected.length && <NewCreators />}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-2xl">{mode === "following" ? "From people you follow" : selected.length ? `Tagged ${selected.map((t) => "#" + t).join(" + ")}` : "Latest"}</h2>
        {mode === "explore" && <SortTabs value={sort} onChange={(s) => set({ sort: s })} options={SORTS} />}
      </div>

      {mode === "explore" && <TagFilter tags={tags} selected={selected} onChange={(t) => set({ tags: t })} />}

      {mode === "following" && !user ? (
        <p className="text-muted text-sm py-12 text-center"><Link to="/login" className="text-accent-2">Log in</Link> to see uploads from people you follow.</p>
      ) : (
        <PagedList {...paged} layout="rows" empty={
          mode === "following"
            ? <>Follow some creators and their uploads will show up here. <Link to="/creators" className="text-accent-2">Find creators</Link></>
            : selected.length ? "Nothing matches all of those tags. Try removing one." : "No uploads yet. Be the first!"
        } />
      )}
    </div>
  );
}
