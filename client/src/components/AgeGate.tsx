import { useState } from "react";

const KEY = "age-ok";
export function AgeGate() {
  const [ok, setOk] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } });
  if (ok) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 backdrop-blur-sm p-4">
      <div className="card max-w-md w-full p-8 text-center space-y-5">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent text-white font-extrabold">18+</div>
        <h1 className="text-2xl">Adult audio inside.</h1>
        <p className="text-muted text-sm leading-relaxed">
          People upload explicit recordings here. You need to be 18 or older, and of legal age where you live, to go any further.
        </p>
        <div className="flex gap-3 justify-center">
          <a href="https://www.google.com" className="btn-outline">Leave</a>
          <button className="btn-primary" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch {} setOk(true); }}>
            I'm 18 or older
          </button>
        </div>
      </div>
    </div>
  );
}
