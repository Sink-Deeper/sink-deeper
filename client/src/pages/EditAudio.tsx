import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, audioPath, type ApiAudio } from "../lib/api";
import { TagInput } from "../components/TagInput";
import { PageSpinner } from "../components/Spinner";
import { DownloadToggle } from "../components/DownloadToggle";
import { VersionsEditor } from "../components/VersionsEditor";
import { useAuth } from "../lib/auth";

export function EditAudioPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { features } = useAuth();
  const [audio, setAudio] = useState<ApiAudio | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<ApiAudio["visibility"]>("public");
  const [downloadable, setDownloadable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ audio: ApiAudio }>(`/api/audios/${id}`).then((r) => {
      setAudio(r.audio); setTitle(r.audio.title); setDescription(r.audio.description); setTags(r.audio.tags); setVisibility(r.audio.visibility); setDownloadable(r.audio.downloadable);
    }).catch((e) => setError(e.message));
  }, [id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.patch<{ audio: ApiAudio }>(`/api/audios/${id}`, { title, description, tags, visibility, downloadable });
      nav(audioPath(r.audio));
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  if (error && !audio) return <div className="py-20 text-center text-muted">{error}</div>;
  if (!audio) return <PageSpinner />;
  if (!audio.isOwner) return <div className="py-20 text-center text-muted">You can only edit your own uploads.</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl mb-6">Edit audio</h1>
      <form onSubmit={submit} className="space-y-5">
        <div><label className="block text-sm mb-1.5">Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} /></div>
        <div><label className="block text-sm mb-1.5">Description</label><textarea className="input min-h-32" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} /></div>
        <div><label className="block text-sm mb-1.5">Tags</label><TagInput value={tags} onChange={setTags} /></div>
        <div>
          <label className="block text-sm mb-1.5">Visibility</label>
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
            <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option>
          </select>
        </div>
        <DownloadToggle value={downloadable} onChange={setDownloadable} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary" type="submit" disabled={busy}>Save changes</button>
          <button className="btn-ghost" type="button" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </form>
      {features.versions && <div className="mt-10"><VersionsEditor audio={audio} /></div>}
    </div>
  );
}
