import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api, type ApiStatus } from "../lib/api";

/** Shown only while file storage is failing, so listeners know playback is broken and creators don't upload into a hole. */
export function StorageBanner() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => api.get<ApiStatus>("/api/status").then((s) => live && setDown(!s.storage.ok)).catch(() => {});
    check();
    const t = setInterval(check, 120_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!down) return null;
  return (
    <div role="status" className="bg-amber-500/15 border-b border-amber-500/40 text-amber-200 text-sm">
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>Playing and uploading audio isn't working right now: our file storage is having problems. Nothing has been lost, and it's being fixed.</span>
      </div>
    </div>
  );
}
