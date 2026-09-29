import { AudioList, type Layout } from "./AudioCard";
import { PageSpinner } from "./Spinner";
import type { ApiAudio } from "../lib/api";
import { useEffect, useRef, type ReactNode } from "react";

export function PagedList({ audios, loading, hasMore, error, loadMore, update, remove, showUser = true, empty, layout }: {
  audios: ApiAudio[]; loading: boolean; hasMore: boolean; error: string | null; loadMore: () => void;
  update?: (id: string, patch: Partial<ApiAudio>) => void; remove?: (id: string) => void; showUser?: boolean; empty?: ReactNode; layout?: Layout;
}) {
  // Load the next page when the sentinel under the list scrolls into view (a little early, via rootMargin).
  // Only the first few pages load on scroll; after that a button takes over so the page can't grow without
  // a deliberate click and the footer stays reachable.
  const AUTO_PAGES = 3;
  const autoLoads = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef({ loadMore, loading, hasMore });
  latest.current = { loadMore, loading, hasMore };
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      const l = latest.current;
      if (autoLoads.current >= AUTO_PAGES - 1) return;
      if (entries.some((e) => e.isIntersecting) && l.hasMore && !l.loading) { autoLoads.current++; l.loadMore(); }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, audios.length]);
  const prevKey = useRef(audios[0]?.id);
  if (audios.length && audios[0]?.id !== prevKey.current) { prevKey.current = audios[0]?.id; autoLoads.current = 0; } // new query/list: reset

  if (error && !audios.length) return <p className="text-red-400 text-sm py-8 text-center">{error}</p>;
  if (loading && !audios.length) return <PageSpinner />;
  return (
    <>
      <AudioList audios={audios} showUser={showUser} empty={empty} layout={layout} onChange={update} onRemove={remove} />
      {hasMore && (
        <div ref={sentinel} className="flex justify-center py-6 min-h-16">
          {loading ? <PageSpinner /> : error ? <button className="btn-outline" onClick={loadMore}>Couldn't load more. Retry</button> : <button className={autoLoads.current >= AUTO_PAGES - 1 ? "btn-outline" : "btn-ghost text-muted text-sm"} onClick={loadMore}>Show more</button>}
        </div>
      )}
    </>
  );
}
