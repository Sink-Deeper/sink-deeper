export type ApiUser = {
  id: string; username: string; displayName: string; avatarUrl?: string | null; bio: string; createdAt: number;
  audioCount: number; followers: number; following: number; isSelf: boolean;
  isFollowing?: boolean; totalPlays?: number; totalLikes?: number; isAdmin?: boolean; banned?: boolean;
};
export type ApiQuota = { usedBytes: number; quotaBytes: number; uploadsToday: number; uploadsPerDay: number; maxUploadBytes: number };
export type ApiAudio = {
  id: string; slug: string; title: string; description: string;
  visibility: "public" | "unlisted" | "private"; status: "processing" | "ready" | "failed"; error?: string | null;
  duration: number; size: number; plays: number; likes: number; comments: number; downloads: number;
  createdAt: number; updatedAt: number; tags: string[];
  user: { id: string; username: string; displayName: string; avatarUrl?: string | null };
  streamUrl: string | null; downloadUrl: string | null; downloadable: boolean; hasOriginal: boolean;
  peaks?: number[]; liked: boolean; isOwner: boolean;
  /** Other versions of the same work (F4M / F4A ...), including this one; only present when there are 2+. */
  versions?: ApiVersion[];
};
export type ApiVersion = { id: string; slug: string; label: string };
export type ApiFeatures = { versions: boolean };
export type ApiStatus = { storage: { ok: boolean; since: number | null } };
export type VersionsView = {
  main: string;
  members: { id: string; slug: string; title: string; visibility: string; status: string; label: string; customLabel: string; isMain: boolean }[];
  candidates: { id: string; slug: string; title: string; grouped: boolean; match: number }[];
};
export type ApiComment = {
  id: string; body: string; createdAt: number; canDelete: boolean;
  user: { id: string; username: string; displayName: string; avatarUrl?: string | null };
};
export type ApiPlaylist = {
  id: string; slug: string; title: string; description: string; isPublic: boolean; createdAt: number; itemCount: number;
  user: { id: string; username: string; displayName: string; avatarUrl?: string | null }; isOwner: boolean; contains?: boolean;
};
export type ApiCreator = {
  id: string; username: string; displayName: string; avatarUrl?: string | null; bio: string; createdAt: number;
  audioCount: number; plays: number; likes: number; followers: number;
};
export type Page<T> = { audios: T[]; page: number; hasMore: boolean };
export type PlaylistView = { playlist: ApiPlaylist; audios: ApiAudio[]; unavailable: number };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: isForm || body === undefined ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** Upload with progress via XHR (fetch has no upload progress). */
export function uploadAudio(form: FormData, onProgress: (pct: number) => void): Promise<{ audio: ApiAudio }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/audios");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error ?? "Upload failed"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error"));
    xhr.send(form);
  });
}

export const audioPath = (a: Pick<ApiAudio, "slug" | "user">) => `/u/${a.user.username}/${a.slug}`;
export const userPath = (u: { username: string }) => `/u/${u.username}`;
export const playlistPath = (p: ApiPlaylist) => `/u/${p.user.username}/sets/${p.slug}`;
export type ApiNewCreator = {
  id: string; username: string; displayName: string; avatarUrl?: string | null;
  audioCount: number; hours: number; since: number; latest: { slug: string; title: string } | null;
};
