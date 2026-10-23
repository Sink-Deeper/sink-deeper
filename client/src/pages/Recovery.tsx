import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

/** "I've forgotten my password": asks for a username or email and always gives the same answer. */
export function ForgotPasswordPage() {
  const { features } = useAuth();
  const [address, setAddress] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const r = await api.post<{ message: string }>("/api/auth/forgot", { email: address }); setSent(r.message); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  if (!features.recovery) return <div className="py-20 text-center text-muted">Password recovery isn't available on this site.</div>;
  return (
    <div className="max-w-sm mx-auto py-10">
      <h1 className="text-2xl mb-1">Forgotten password</h1>
      <p className="text-sm text-muted mb-6">Type the address you added as your recovery email. The site never stores addresses, so it can only check whether yours matches and send the link straight back to it.</p>
      {sent ? (
        <>
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">{sent}</p>
          <p className="text-xs text-muted mt-3">Check your spam folder too. The link lasts an hour and works once.</p>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1.5">Your recovery email</label>
            <input className="input" type="email" value={address} onChange={(e) => setAddress(e.target.value)} autoFocus required maxLength={200} autoComplete="email" />
            <p className="text-xs text-muted mt-1">It has to be the exact address you confirmed. There's no way for us to look it up or remind you.</p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy} type="submit">{busy ? "…" : "Send reset link"}</button>
        </form>
      )}
      <p className="text-sm text-muted mt-6 text-center"><Link to="/login" className="text-accent-2">Back to log in</Link></p>
    </div>
  );
}

/** Where the emailed reset link lands. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) { setError("Those passwords don't match"); return; }
    setBusy(true); setError(null);
    try { await api.post("/api/auth/reset", { token, password }); setDone(true); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  if (!token) return <div className="py-20 text-center text-muted">That link is missing its code. Request a new one from <Link to="/forgot-password" className="text-accent-2">forgotten password</Link>.</div>;
  return (
    <div className="max-w-sm mx-auto py-10">
      <h1 className="text-2xl mb-1">Choose a new password</h1>
      {done ? (
        <>
          <p className="text-sm text-muted mb-6">Your password has been changed, and anyone who was logged in to your account has been signed out.</p>
          <button className="btn-primary w-full" onClick={() => nav("/login", { replace: true })}>Log in</button>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4 mt-6">
          <div>
            <label className="block text-sm mb-1.5">New password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required minLength={8} />
            <p className="text-xs text-muted mt-1">At least 8 characters.</p>
          </div>
          <div>
            <label className="block text-sm mb-1.5">Type it again</label>
            <input className="input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required minLength={8} />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy} type="submit">{busy ? "…" : "Change password"}</button>
        </form>
      )}
    </div>
  );
}

/** Where the emailed confirmation link lands. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!token) { setState({ ok: false, message: "That link is missing its code." }); return; }
    api.post("/api/auth/email/verify", { token })
      .then(() => { setState({ ok: true, message: "Your recovery email is confirmed. If you ever forget your password, you can reset it from the log-in page." }); void refresh(); })
      .catch((e: any) => setState({ ok: false, message: e.message }));
  }, [token, refresh]);

  return (
    <div className="max-w-sm mx-auto py-16 text-center">
      <h1 className="text-2xl mb-3">Recovery email</h1>
      <p className={`text-sm ${state ? (state.ok ? "text-emerald-300" : "text-red-400") : "text-muted"}`}>{state?.message ?? "Checking the link…"}</p>
      <Link to={state?.ok ? "/" : "/settings"} className="btn-outline mt-6 inline-flex">{state?.ok ? "Go to the site" : "Open Settings"}</Link>
    </div>
  );
}
