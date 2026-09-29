import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { Search, Upload, LogOut, Settings, Menu, X, CircleHelp } from "lucide-react";
import { StorageBanner } from "./StorageBanner";
import { useAuth } from "../lib/auth";
import { usePlayer } from "../lib/player";
import { PlayerBar } from "./PlayerBar";
import { AgeGate } from "./AgeGate";
import { Avatar } from "./Avatar";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const player = usePlayer();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [menu, setMenu] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const navCls = ({ isActive }: { isActive: boolean }) => `px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`;

  return (
    <div className={`min-h-screen flex flex-col ${player.current ? "pb-20" : ""}`}>
      <AgeGate />
      <StorageBanner />
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-5">
          <Link to="/" className="flex items-center gap-2 text-[1.2rem] font-extrabold tracking-tight text-fg">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-white"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 10v.5M6.5 6v8M10 3v14M13.5 7v6M17 9v2"/></svg></span>
            sinkdeeper
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/" end className={navCls}>Explore</NavLink>
            <NavLink to="/creators" className={navCls}>Creators</NavLink>
            <NavLink to="/tags" className={navCls}>Tags</NavLink>
            {user && <NavLink to="/following" className={navCls}>Following</NavLink>}
            {user && <NavLink to="/library" className={navCls}>Library</NavLink>}
          </nav>
          <form onSubmit={submit} className="flex-1 max-w-md ml-auto relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="w-full rounded-full border border-border bg-surface pl-10 pr-4 py-2 text-sm placeholder:text-muted focus:outline-none focus:border-accent" placeholder="Search audio, tags, creators" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="hidden md:flex items-center gap-2">
            <div className="relative group">
              <button className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg" aria-label="Help"><CircleHelp size={18} /></button>
              <div className="absolute right-0 top-full pt-2 hidden group-hover:block group-focus-within:block">
                <div className="card w-44 p-1 shadow-xl">
                  <Link to="/faq" className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">FAQ</Link>
                  <Link to="/about" className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">About</Link>
                  <a href="mailto:info@sinkdeeper.com" className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">Contact</a>
                </div>
              </div>
            </div>
            {user ? (
              <>
                <Link to="/upload" className="btn-primary py-1.5"><Upload size={16} /> Upload</Link>
                <div className="relative group">
                  <button className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2"><Avatar name={user.username} src={user.avatarUrl} size={30} /></button>
                  <div className="absolute right-0 top-full pt-2 hidden group-hover:block group-focus-within:block">
                    <div className="card w-48 p-1 shadow-xl">
                      <Link to={`/u/${user.username}`} className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">My profile</Link>
                      <Link to="/library" className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">Library</Link>
                      <Link to="/analytics" className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">Analytics</Link>
                      <Link to="/upload/bulk" className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">Bulk upload</Link>
                      <Link to="/import" className="block px-3 py-2 text-sm rounded-md hover:bg-surface-2">Import from Soundgasm</Link>
                      <Link to="/settings" className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-surface-2"><Settings size={14} /> Settings</Link>
                      <button onClick={() => void logout().then(() => nav("/"))} className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-surface-2 text-muted"><LogOut size={14} /> Log out</button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-ghost py-1.5">Log in</Link>
                <Link to="/register" className="btn-primary py-1.5">Sign up</Link>
              </>
            )}
          </div>
          <button className="md:hidden btn-ghost p-2" onClick={() => setMenu((m) => !m)} aria-label="Menu">{menu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
        {menu && (
          <div className="md:hidden border-t border-border px-4 py-3 flex flex-col gap-1" onClick={() => setMenu(false)}>
            <NavLink to="/" end className={navCls}>Explore</NavLink>
            <NavLink to="/creators" className={navCls}>Creators</NavLink>
            <NavLink to="/tags" className={navCls}>Tags</NavLink>
            {user ? (
              <>
                <NavLink to="/following" className={navCls}>Following</NavLink>
                <NavLink to="/upload" className={navCls}>Upload</NavLink>
                <NavLink to={`/u/${user.username}`} className={navCls}>My profile</NavLink>
                <NavLink to="/library" className={navCls}>Library</NavLink>
                <NavLink to="/settings" className={navCls}>Settings</NavLink>
                <button onClick={() => void logout().then(() => nav("/"))} className="px-3 py-1.5 text-left text-sm text-muted">Log out</button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navCls}>Log in</NavLink>
                <NavLink to="/register" className={navCls}>Sign up</NavLink>
              </>
            )}
            <div className="my-1 border-t border-border" />
            <NavLink to="/faq" className={navCls}>FAQ</NavLink>
            <NavLink to="/about" className={navCls}>About</NavLink>
            <a href="mailto:info@sinkdeeper.com" className="px-3 py-1.5 text-sm text-muted">Contact</a>
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 flex-1">{children}</main>
      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-7xl px-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span className="font-semibold text-fg">sinkdeeper <span className="text-muted font-normal">· audio hosting for adults</span></span>
          <span className="flex gap-5">
            <Link to="/about" className="hover:text-fg">About</Link>
            <Link to="/faq" className="hover:text-fg">FAQ</Link>
            <a href="mailto:info@sinkdeeper.com" className="hover:text-fg">info@sinkdeeper.com</a>
            <span>18+ only</span>
          </span>
        </div>
      </footer>
      <PlayerBar />
    </div>
  );
}
