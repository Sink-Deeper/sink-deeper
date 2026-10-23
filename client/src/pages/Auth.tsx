import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, type ApiUser } from "../lib/api";
import { useAuth } from "../lib/auth";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { setUser, features } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isReg = mode === "register";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { user } = await api.post<{ user: ApiUser }>(`/api/auth/${mode}`, { username, password, ...(isReg && email.trim() ? { email: email.trim() } : {}) });
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
          {isReg && <p className="text-xs text-muted mt-1">At least 8 characters.</p>}
        </div>
        {isReg && features.recovery && (
          <div>
            <label className="block text-sm mb-1.5">Recovery email <span className="text-muted font-normal">(optional)</span></label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} placeholder="you@example.com" />
            <p className="text-xs text-muted mt-1">
              {email.trim()
                ? "We'll send one message to confirm it. It's only ever used to reset your password, never for anything else."
                : "Only used to reset your password if you forget it. You can add one later in Settings."}
            </p>
          </div>
        )}
        {isReg && !email.trim() && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <b>Without an email there is no way to recover this account.</b> If you forget your password, the account and everything in it is gone for good, because there's nothing to prove it's yours. Keep your password somewhere safe.
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy} type="submit">{busy ? "…" : isReg ? "Sign up" : "Log in"}</button>
      </form>
      <p className="text-sm text-muted mt-6 text-center">
        {isReg ? <>Already have an account? <Link to="/login" className="text-accent-2">Log in</Link></> : <>New here? <Link to="/register" className="text-accent-2">Create an account</Link></>}
      </p>
      {!isReg && features.recovery && (
        <p className="text-sm text-muted mt-2 text-center"><Link to="/forgot-password" className="text-accent-2">Forgot your password?</Link></p>
      )}
    </div>
  );
}
