import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, type ApiUser } from "../lib/api";
import { useAuth } from "../lib/auth";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isReg = mode === "register";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { user } = await api.post<{ user: ApiUser }>(`/api/auth/${mode}`, { username, password });
      setUser(user);
      nav((loc.state as any)?.from ?? (isReg ? "/upload" : "/"), { replace: true });
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-sm mx-auto py-10">
      <h1 className="text-2xl mb-1">{isReg ? "Create an account" : "Welcome back"}</h1>
      <p className="text-sm text-muted mb-6">{isReg ? "No email required. Just pick a name and a password." : "Log in to upload, like and comment."}</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1.5">Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required pattern="[A-Za-z0-9_]{3,24}" title="3–24 letters, numbers or underscores" />
        </div>
        <div>
          <label className="block text-sm mb-1.5">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isReg ? "new-password" : "current-password"} required minLength={isReg ? 8 : 1} />
          {isReg && <p className="text-xs text-muted mt-1">At least 8 characters. There is no password reset, so keep it somewhere safe.</p>}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy} type="submit">{busy ? "…" : isReg ? "Sign up" : "Log in"}</button>
      </form>
      <p className="text-sm text-muted mt-6 text-center">
        {isReg ? <>Already have an account? <Link to="/login" className="text-accent-2">Log in</Link></> : <>New here? <Link to="/register" className="text-accent-2">Create an account</Link></>}
      </p>
    </div>
  );
}
