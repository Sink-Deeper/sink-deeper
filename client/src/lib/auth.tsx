import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type ApiUser, type ApiQuota, type ApiFeatures } from "./api";

type AuthCtx = {
  user: ApiUser | null;
  quota: ApiQuota | null;
  features: ApiFeatures;
  loading: boolean;
  setUser: (u: ApiUser | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};
const NO_FEATURES: ApiFeatures = { versions: false };
const Ctx = createContext<AuthCtx>({ user: null, quota: null, features: NO_FEATURES, loading: true, setUser: () => {}, refresh: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [quota, setQuota] = useState<ApiQuota | null>(null);
  const [features, setFeatures] = useState<ApiFeatures>(NO_FEATURES);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: ApiUser | null; quota: ApiQuota | null; features?: ApiFeatures }>("/api/auth/me");
      setUser(r.user); setQuota(r.quota); setFeatures({ ...NO_FEATURES, ...r.features });
    } catch {}
  }, []);
  useEffect(() => { void refresh().finally(() => setLoading(false)); }, [refresh]);
  const logout = useCallback(async () => {
    await api.post("/api/auth/logout");
    setUser(null); setQuota(null);
  }, []);
  return <Ctx.Provider value={{ user, quota, features, loading, setUser, refresh, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
