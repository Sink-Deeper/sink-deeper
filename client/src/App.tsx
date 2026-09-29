import { Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { CreatorsPage } from "./pages/Creators";
import { LibraryPage } from "./pages/Library";
import { AnalyticsPage, AudioAnalyticsPage } from "./pages/Analytics";
import { ImportPage } from "./pages/Import";
import { BulkUploadPage } from "./pages/BulkUpload";
import { Navigate } from "react-router-dom";
import { AuthPage } from "./pages/Auth";
import { UploadPage } from "./pages/Upload";
import { AudioPage } from "./pages/AudioPage";
import { EditAudioPage } from "./pages/EditAudio";
import { UserPage } from "./pages/UserPage";
import { PlaylistPage } from "./pages/PlaylistPage";
import { SearchPage, TagPage, TagsIndex } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { EmbedPage } from "./pages/Embed";
import { About, NotFound } from "./pages/Static";
import { FaqPage } from "./pages/Faq";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  const loc = useLocation();
  if (loc.pathname.startsWith("/embed/")) {
    return <Routes><Route path="/embed/:id" element={<EmbedPage />} /></Routes>;
  }
  return (
    <Layout>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home mode="explore" />} />
        <Route path="/top" element={<Navigate to="/?sort=top" replace />} />
        <Route path="/creators" element={<CreatorsPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/analytics/:id" element={<AudioAnalyticsPage />} />
        <Route path="/following" element={<Home mode="following" />} />
        <Route path="/login" element={<AuthPage key="login" mode="login" />} />
        <Route path="/register" element={<AuthPage key="register" mode="register" />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/upload/bulk" element={<BulkUploadPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/edit/:id" element={<EditAudioPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/tags" element={<TagsIndex />} />
        <Route path="/tags/:tag" element={<TagPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/about" element={<About />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/u/:username" element={<UserPage tab="audios" />} />
        <Route path="/u/:username/likes" element={<UserPage tab="likes" />} />
        <Route path="/u/:username/sets" element={<UserPage tab="sets" />} />
        <Route path="/u/:username/sets/:slug" element={<PlaylistPage />} />
        <Route path="/u/:username/:slug" element={<AudioPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
