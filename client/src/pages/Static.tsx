import { Link } from "react-router-dom";

export function NotFound() {
  return <div className="py-24 text-center"><div className="text-6xl text-muted">404</div><p className="text-muted mt-2">That page doesn't exist.</p><Link to="/" className="btn-outline mt-6">Go home</Link></div>;
}

export function About() {
  return (
    <div className="max-w-2xl mx-auto prose-sm space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl">About Sinkdeeper</h1>
      <p>Sinkdeeper is a small, independent place to share audio. Upload a file, tag it, and get a clean link with a waveform player. No email address is needed to sign up.</p>
      <h2 className="font-semibold text-base pt-2">What you get</h2>
      <ul className="list-disc pl-5 space-y-1 text-muted">
        <li>Files that are already AAC are kept exactly as uploaded, with no re-encode. Other formats are converted to AAC once so they stream reliably on every device, with instant seeking.</li>
        <li>A persistent player that keeps playing while you browse, with speed control and keyboard shortcuts (space, ← →).</li>
        <li>Tags, full-text search, likes, comments, playlists and follows.</li>
        <li>Public, unlisted and private visibility per upload.</li>
        <li>Embeddable player for forums and blogs.</li>
      </ul>
      <h2 className="font-semibold text-base pt-2">Rules</h2>
      <p className="text-muted">Only upload audio you have the right to share. All performers must be adults. Content that breaks the law is removed and the account banned.</p>
      <h2 className="font-semibold text-base pt-2">Questions</h2>
      <p className="text-muted">Safety, privacy, importing, money, the rules: the <Link to="/faq" className="text-accent-2 hover:underline">FAQ</Link> answers the common ones in plain language.</p>
      <h2 className="font-semibold text-base pt-2">Contact</h2>
      <p className="text-muted">Questions, takedown requests, or anything else: <a href="mailto:info@sinkdeeper.com" className="text-accent-2 hover:underline">info@sinkdeeper.com</a>. Takedown requests should include a link to the audio and a way to confirm you hold the rights.</p>
    </div>
  );
}
