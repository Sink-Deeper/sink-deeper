import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiAudio, type Page } from "./api";

/** Paginated audio list loader. `url` should not include page=. */
export function usePagedAudios(url: string | null) {
  const [audios, setAudios] = useState<ApiAudio[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const busy = useRef<number | null>(null); // page currently being fetched; auto-load can fire more than once
  const load = useCallback((p: number, append: boolean) => {
    if (!url) return;
    if (append && busy.current === p) return;
    busy.current = p;
    const my = ++seq.current;
    setLoading(true);
    const sep = url.includes("?") ? "&" : "?";
    api.get<Page<ApiAudio>>(`${url}${sep}page=${p}`)
      .then((r) => { if (my !== seq.current) return; setAudios((a) => (append ? [...a, ...r.audios] : r.audios)); setHasMore(r.hasMore); setPage(p); setError(null); })
      .catch((e) => my === seq.current && setError(e.message))
      .finally(() => { if (my === seq.current) { setLoading(false); busy.current = null; } });
  }, [url]);

  useEffect(() => { setAudios([]); setError(null); load(1, false); }, [load]);
  const loadMore = () => load(page + 1, true);
  const update = (id: string, patch: Partial<ApiAudio>) => setAudios((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const remove = (id: string) => setAudios((as) => as.filter((a) => a.id !== id));
  return { audios, hasMore, loading, error, loadMore, update, remove, reload: () => load(1, false) };
}
