import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtCount, fmtDuration } from "../lib/format";
import { StatTile, DailyBars, RetentionCurve } from "../components/Charts";
import { SortTabs } from "../components/TagFilter";
import { PageSpinner } from "../components/Spinner";

type Range = "7" | "30" | "90" | "365";
const RANGES = [{ value: "7" as Range, label: "7 days" }, { value: "30" as Range, label: "30 days" }, { value: "90" as Range, label: "90 days" }, { value: "365" as Range, label: "Year" }];
const hours = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`);
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

function useRange(): [Range, (r: Range) => void] {
  const [params, setParams] = useSearchParams();
  const r = (params.get("days") as Range) || "30";
  return [RANGES.some((x) => x.value === r) ? r : "30", (v) => setParams({ days: v }, { replace: true })];
}

export function AnalyticsPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [range, setRange] = useRange();
  const [data, setData] = useState<any>(null);
  const seq = useRef(0);
  useEffect(() => { if (!loading && !user) nav("/login", { state: { from: "/analytics" } }); }, [user, loading, nav]);
  useEffect(() => {
    if (!user) return;
    const my = ++seq.current; setData(null);
    api.get(`/api/analytics/overview?days=${range}`).then((d) => { if (my === seq.current) setData(d); }).catch(() => { if (my === seq.current) setData({ error: true }); });
  }, [user, range]);
  if (!user) return null;
  if (!data) return <PageSpinner />;
  if (data.error) return <p className="text-muted py-20 text-center">Couldn't load analytics.</p>;
  const { lifetime, period, daily, days, audios } = data;
  const avgListen = period.sessions ? period.listenSeconds / period.sessions : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl">Analytics</h1>
          <p className="text-sm text-muted">Plays are counted once per listener per day. Listen time comes from the player as people listen. Days are in UTC.</p>
        </div>
        <SortTabs value={range} onChange={setRange} options={RANGES} />
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Plays" value={fmtCount(period.plays)} sub={`${fmtCount(lifetime.plays)} all time`} />
        <StatTile label="Unique listeners" value={fmtCount(period.uniques)} sub="in this period" />
        <StatTile label="Listening time" value={hours(period.listenSeconds)} sub={`${hours(lifetime.listenSeconds)} all time`} />
        <StatTile label="Avg. per session" value={avgListen === null ? "–" : fmtDuration(avgListen)} sub={`${fmtCount(period.sessions)} sessions`} />
        <StatTile label="Downloads" value={fmtCount(period.downloads)} sub={`${fmtCount(lifetime.downloads)} all time`} />
        <StatTile label="Followers" value={fmtCount(lifetime.followers)} sub={`${fmtCount(lifetime.likes)} likes · ${fmtCount(lifetime.comments)} comments`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyBars title="Plays per day" days={days} values={daily.plays} />
        <DailyBars title="Listening time per day" days={days} values={daily.listenSeconds} format={hours} />
      </div>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-medium">Your audio <span className="text-muted font-normal">· ranked by plays in this period</span></div>
        {audios.length === 0 ? <p className="p-8 text-center text-sm text-muted">Nothing uploaded yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted text-left">
                <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
                  <th>Title</th><th className="text-right">Plays</th><th className="text-right">Avg. listen</th><th className="text-right">Finished</th><th className="text-right">Downloads</th><th className="text-right">Likes</th><th className="text-right">Comments</th>
                </tr>
              </thead>
              <tbody>
                {audios.map((a: any) => (
                  <tr key={a.id} className="border-t border-border hover:bg-surface-2/60 [&>td]:px-4 [&>td]:py-2 tabular-nums">
                    <td className="max-w-xs">
                      <Link to={`/analytics/${a.id}`} className="block truncate font-medium hover:text-accent-2">{a.title}</Link>
                      <div className="text-xs text-muted">{fmtDuration(a.duration)}{a.visibility !== "public" && ` · ${a.visibility}`}</div>
                    </td>
                    <td className="text-right">{fmtCount(a.plays)} <span className="text-muted text-xs">/ {fmtCount(a.lifetimePlays)}</span></td>
                    <td className="text-right">{a.avgListen === null ? "–" : fmtDuration(a.avgListen)}</td>
                    <td className="text-right">{pct(a.completion)}</td>
                    <td className="text-right">{fmtCount(a.downloads)}</td>
                    <td className="text-right">{fmtCount(a.likes)}</td>
                    <td className="text-right">{fmtCount(a.comments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function AudioAnalyticsPage() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [range, setRange] = useRange();
  const [data, setData] = useState<any>(null);
  const seq = useRef(0);
  useEffect(() => { if (!loading && !user) nav("/login"); }, [user, loading, nav]);
  useEffect(() => {
    if (!user) return;
    const my = ++seq.current; setData(null);
    api.get(`/api/analytics/audio/${id}?days=${range}`).then((d) => { if (my === seq.current) setData(d); }).catch((e) => { if (my === seq.current) setData({ error: e.message }); });
  }, [user, id, range]);
  if (!user) return null;
  if (!data) return <PageSpinner />;
  if (data.error) return <p className="text-muted py-20 text-center">{data.error}</p>;
  const { audio, lifetime, period, daily, days, retention } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Link to="/analytics" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1"><ArrowLeft size={12} /> All analytics</Link>
          <h1 className="text-2xl truncate">{audio.title}</h1>
          <p className="text-sm text-muted">{fmtDuration(audio.duration)} · <Link to={`/u/${audio.username}/${audio.slug}`} className="hover:text-fg">open audio</Link></p>
        </div>
        <SortTabs value={range} onChange={setRange} options={RANGES} />
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Plays" value={fmtCount(period.plays)} sub={`${fmtCount(lifetime.plays)} all time`} />
        <StatTile label="Unique listeners" value={fmtCount(period.uniques)} sub={`${fmtCount(lifetime.uniques)} all time`} />
        <StatTile label="Avg. listen time" value={period.sessions ? fmtDuration(period.avgListen) : "–"} sub={lifetime.sessions ? `${fmtDuration(lifetime.avgListen)} all time` : "no sessions yet"} />
        <StatTile label="Finished" value={pct(lifetime.completion)} sub="reached 90% of the file" />
        <StatTile label="Downloads" value={fmtCount(period.downloads)} sub={`${fmtCount(lifetime.downloads)} all time`} />
        <StatTile label="Likes" value={fmtCount(lifetime.likes)} sub={`${fmtCount(lifetime.comments)} comments`} />
      </div>

      <RetentionCurve retention={retention} duration={audio.duration} />

      <div className="grid gap-4 lg:grid-cols-3">
        <DailyBars title="Plays per day" days={days} values={daily.plays} />
        <DailyBars title="Downloads per day" days={days} values={daily.downloads} />
        <DailyBars title="Listening time per day" days={days} values={daily.listenSeconds} format={hours} />
      </div>
    </div>
  );
}
