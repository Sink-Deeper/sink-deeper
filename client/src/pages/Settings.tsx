import { useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar } from "../components/Avatar";
import { useNavigate } from "react-router-dom";
import { api, type ApiUser } from "../lib/api";
import { useAuth } from "../lib/auth";

export function SettingsPage() {
  const { user, loading, setUser, features } = useAuth();
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [del, setDel] = useState({ password: "", confirm: "" });
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [email, setEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!loading && !user) nav("/login"); if (user) { setDisplayName(user.displayName); setBio(user.bio); } }, [user, loading, nav]);
  if (!user) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { const r = await api.patch<{ user: ApiUser }>("/api/auth/me", { displayName, bio }); setUser(r.user); setMsg("Saved."); }
    catch (err: any) { setMsg(err.message); }
  };
  const uploadPhoto = async (f: File | undefined) => {
    if (!f) return;
    setPhotoMsg(null); setPhotoBusy(true);
    try {
      const form = new FormData(); form.append("file", f);
      const r = await api.post<{ user: ApiUser }>("/api/auth/me/avatar", form);
      setUser(r.user); setPhotoMsg("Photo updated.");
    } catch (err: any) { setPhotoMsg(err.message); }
    finally { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const removePhoto = async () => {
    setPhotoMsg(null); setPhotoBusy(true);
    try { const r = await api.del<{ user: ApiUser }>("/api/auth/me/avatar"); setUser(r.user); setPhotoMsg("Photo removed."); }
    catch (err: any) { setPhotoMsg(err.message); }
    finally { setPhotoBusy(false); }
  };
  const saveEmail = async (e: FormEvent) => {
    e.preventDefault();
    setEmailBusy(true); setEmailMsg(null);
    try { const r = await api.post<{ user: ApiUser }>("/api/auth/email", { email }); setUser(r.user); setEmail(""); setEmailMsg("Check your inbox for a confirmation link."); }
    catch (err: any) { setEmailMsg(err.message); } finally { setEmailBusy(false); }
  };
  const resendEmail = async () => {
    setEmailBusy(true); setEmailMsg(null);
    try { await api.post("/api/auth/email/resend"); setEmailMsg("Sent again. Check your inbox and spam folder."); }
    catch (err: any) { setEmailMsg(err.message); } finally { setEmailBusy(false); }
  };
  const removeEmail = async () => {
    if (!confirm("Remove your recovery email? Without one, a forgotten password means losing the account.")) return;
    setEmailBusy(true); setEmailMsg(null);
    try { const r = await api.del<{ user: ApiUser }>("/api/auth/email"); setUser(r.user); setEmailMsg("Removed."); }
    catch (err: any) { setEmailMsg(err.message); } finally { setEmailBusy(false); }
  };
  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm("Delete your account and every audio you've uploaded? This can't be undone.")) return;
    setDeleting(true); setDelMsg(null);
    try {
      await api.post("/api/auth/me/delete", del);
      setUser(null);
      nav("/", { replace: true });
    } catch (err: any) { setDelMsg(err.message); } finally { setDeleting(false); }
  };
  const savePw = async (e: FormEvent) => {
    e.preventDefault(); setPwMsg(null);
    try { await api.post("/api/auth/password", pw); setPw({ current: "", next: "" }); setPwMsg("Password changed."); }
    catch (err: any) { setPwMsg(err.message); }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <h1 className="text-2xl">Settings</h1>
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold">Profile photo</h2>
        <div className="flex items-center gap-5">
          <Avatar name={user.username} src={user.avatarUrl} size={88} className="ring-4 ring-bg" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-outline" disabled={photoBusy} onClick={() => fileRef.current?.click()}>{photoBusy ? "Working…" : user.avatarUrl ? "Change photo" : "Upload photo"}</button>
              {user.avatarUrl && <button type="button" className="btn-ghost text-muted" disabled={photoBusy} onClick={removePhoto}>Remove</button>}
            </div>
            <p className="text-xs text-muted">JPG, PNG, WebP or GIF up to 10 MB. It's cropped to a square and shown next to your name everywhere.</p>
            {photoMsg && <p className="text-sm text-muted">{photoMsg}</p>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhoto(e.target.files?.[0])} />
        </div>
      </div>
      <form onSubmit={saveProfile} className="card p-5 space-y-4">
        <h2 className="font-semibold">Profile</h2>
        <div><label className="block text-sm mb-1.5">Display name</label><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required /></div>
        <div><label className="block text-sm mb-1.5">Bio</label><textarea className="input min-h-28" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={2000} placeholder="Who you are, what you make, where else to find you." /></div>
        <div className="flex items-center gap-3"><button className="btn-primary" type="submit">Save</button>{msg && <span className="text-sm text-muted">{msg}</span>}</div>
      </form>
      {features.recovery && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Recovery email</h2>
          {user.email ? (
            <>
              <p className="text-sm">
                <b>{user.email}</b>{" "}
                {user.emailVerified
                  ? <span className="text-emerald-400">· confirmed</span>
                  : <span className="text-amber-300">· not confirmed yet, so it can't reset your password</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {!user.emailVerified && <button type="button" className="btn-outline" disabled={emailBusy} onClick={resendEmail}>Send the confirmation link again</button>}
                <button type="button" className="btn-ghost text-muted" disabled={emailBusy} onClick={removeEmail}>Remove</button>
              </div>
            </>
          ) : (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <b>This account can't be recovered.</b> If you forget your password, there's no way to prove the account is yours, and everything in it is lost. Adding an email fixes that.
            </p>
          )}
          <form onSubmit={saveEmail} className="space-y-2">
            <label className="block text-sm">{user.email ? "Use a different address" : "Add an address"}</label>
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-48" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" maxLength={200} required autoComplete="email" />
              <button className="btn-primary" type="submit" disabled={emailBusy}>{emailBusy ? "…" : "Save"}</button>
            </div>
            <p className="text-xs text-muted">Only ever used to reset your password. It's stored encrypted, never shown on your profile, never shared, and you can remove it any time.</p>
            {emailMsg && <p className="text-sm text-muted">{emailMsg}</p>}
          </form>
        </div>
      )}
      <form onSubmit={savePw} className="card p-5 space-y-4">
        <h2 className="font-semibold">Change password</h2>
        <div><label className="block text-sm mb-1.5">Current password</label><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" /></div>
        <div><label className="block text-sm mb-1.5">New password</label><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={8} autoComplete="new-password" /></div>
        <div className="flex items-center gap-3"><button className="btn-outline" type="submit">Change password</button>{pwMsg && <span className="text-sm text-muted">{pwMsg}</span>}</div>
      </form>

      <section className="card p-5 space-y-3 border-red-500/30">
        <h2 className="font-semibold">Delete account</h2>
        {!showDelete ? (
          <>
            <p className="text-sm text-muted">Removes your account, your uploads and your files for good. Downloads of your own audio are on each audio page if you want copies first.</p>
            <button type="button" className="btn-ghost text-red-400" onClick={() => setShowDelete(true)}>Delete my account…</button>
          </>
        ) : (
          <form onSubmit={deleteAccount} className="space-y-3">
            <p className="text-sm text-muted">This deletes your account and every audio you've uploaded, and can't be undone. The address you used to sign up or upload is kept for up to 90 days for abuse and legal requests, as the <a href="/faq" className="text-accent-2 hover:underline">FAQ</a> explains.</p>
            <div><label className="block text-sm mb-1.5">Password</label><input className="input" type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} required autoComplete="current-password" /></div>
            <div><label className="block text-sm mb-1.5">Type your username (<b className="text-fg">{user.username}</b>) to confirm</label><input className="input" value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} required autoCapitalize="none" /></div>
            <div className="flex items-center gap-3">
              <button className="btn-outline border-red-500/50 text-red-400" type="submit" disabled={deleting}>{deleting ? "Deleting…" : "Delete my account"}</button>
              <button className="btn-ghost" type="button" onClick={() => { setShowDelete(false); setDelMsg(null); }}>Cancel</button>
              {delMsg && <span className="text-sm text-red-400">{delMsg}</span>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
