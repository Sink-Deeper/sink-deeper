import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Link2, Unlink, Star, Search } from "lucide-react";
import { api, audioPath, type ApiAudio, type VersionsView } from "../lib/api";

/**
 * Edit-page section for linking versions of the same work (F4M, F4A, a loop cut...). Linked versions list as one entry
 * with a switch; each keeps its own page, stats and comments.
 */
export function VersionsEditor({ audio }: { audio: ApiAudio }) {
  const [view, setView] = useState<VersionsView | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const base = `/api/audios/${audio.id}/versions`;

  const load = useCallback((query = "") => {
    const my = ++seq.current;
    api.get<VersionsView>(`${base}${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then((v) => { if (my === seq.current) setView(v); })
      .catch((e) => { if (my === seq.current) setErr(e.message); });
  }, [base]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(q.trim()), 250); return () => clearTimeout(t); }, [q, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); load(q.trim()); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const link = (otherId: string) => act(() => api.post(base, { with: otherId }));
  const unlink = (id: string) => act(() => api.del(`/api/audios/${id}/versions`));
  const makeMain = (id: string) => act(() => api.post(`/api/audios/${id}/versions/main`));
  const saveLabel = (id: string, label: string) => act(() => api.patch(`/api/audios/${id}/versions/label`, { label }));

  if (!view) return err ? <p className="text-sm text-red-400">{err}</p> : null;
  const grouped = view.members.length > 1;
  const path = (slug: string) => audioPath({ slug, user: audio.user });

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold">Versions</h2>
        <p className="text-sm text-muted mt-1">Uploaded the same audio for different listeners, like F4M and F4A, or a loop cut? Link them and they show as one entry with a switch between versions. Each version keeps its own link, plays and comments.</p>
      </div>

      {grouped && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {view.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <input
                className="input w-28 py-1.5 text-sm"
                defaultValue={m.customLabel}
                placeholder={m.label}
                maxLength={20}
                aria-label={`Label for ${m.title}`}
                onBlur={(e) => { if (e.currentTarget.value.trim() !== m.customLabel) void saveLabel(m.id, e.currentTarget.value); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
              <Link to={path(m.slug)} className="min-w-0 flex-1 truncate text-sm hover:text-accent-2">
                {m.title}{m.id === audio.id && <span className="text-muted"> (this one)</span>}
                {m.visibility !== "public" && <span className="text-muted"> · {m.visibility}</span>}
              </Link>
              {m.isMain
                ? <span className="inline-flex items-center gap-1 text-xs text-accent-2"><Star size={13} fill="currentColor" /> Shown in listings</span>
                : <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => makeMain(m.id)}><Star size={13} /> Show this one</button>}
              <button type="button" className="btn-ghost py-1 text-xs text-muted" disabled={busy} onClick={() => unlink(m.id)} title="Make this a separate audio again"><Unlink size={13} /> Unlink</button>
            </li>
          ))}
        </ul>
      )}
      {grouped && <p className="text-xs text-muted">Leave a label blank to use the audience tag, like F4A.</p>}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{grouped ? "Add another version" : "Link a version"}</h3>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9 text-sm" placeholder="Search your uploads" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {view.candidates.length ? (
          <ul className="space-y-1">
            {!q.trim() && <li className="text-xs text-muted">Looks like the same audio:</li>}
            {view.candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <Link to={path(c.slug)} className="min-w-0 flex-1 truncate text-sm">{c.title}</Link>
                {c.grouped && <span className="text-xs text-muted">has versions</span>}
                <button type="button" className="btn-outline py-1 text-xs" disabled={busy} onClick={() => link(c.id)}><Link2 size={13} /> Link</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">{q.trim() ? "Nothing matches that." : "No obvious matches among your uploads. Search above to find one."}</p>
        )}
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
    </section>
  );
}
