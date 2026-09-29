import { Link } from "react-router-dom";

const faqs: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is this?",
    a: "A place to upload audio and share it with a link. It's built for adult audio: roleplay, ASMR, hypnosis, scripts read aloud. You get a player, tags, search, playlists and stats. Listeners get a site that actually lets them find things.",
  },
  {
    q: "Is it free?",
    a: "Yes. Uploading, hosting and listening are free. Audio is cheap to host, so the site can run on very little. If it ever grows big enough that costs matter, the plan is a donation page, then optional creator tools like tips, never charging for hosting.",
  },
  {
    q: "Who runs it?",
    a: <>One person. It's a side project, not a company. That means fixes happen fast and there's a real human at <a href="mailto:info@sinkdeeper.com" className="text-accent-2 hover:underline">info@sinkdeeper.com</a>, but also that you should keep your own copies of your recordings, which is good advice for any site.</>,
  },
  {
    q: "Will my files be safe here? What if the site disappears?",
    a: "Your files live on a storage provider that explicitly allows adult content, so the site isn't one complaint away from being shut off. Everything is copied to a second, separate provider every night. And you can download your own files any time, so you're never locked in. If the site ever had to close, there'd be weeks of notice and time to grab everything.",
  },
  {
    q: "Do I need an email address to sign up?",
    a: "No. Just a username and a password. That also means there's no password reset, so put your password somewhere safe.",
  },
  {
    q: "What do you store about me?",
    a: "Your username, your password (scrambled, never readable), your uploads, and listening stats like play counts. There's no email address, no real name, and only one cookie, which keeps you logged in. If you're logged in, what you listen to is linked to your account so plays and stats count properly; only the site admin can see that, and creators only ever see totals. If you're not logged in, plays are counted with a code made from your internet address and browser, scrambled with a secret key that's replaced every day and then thrown away, so it can't be traced back to you and doesn't follow you from one day to the next. Listening records are deleted after 400 days. Like any website, the server keeps a basic access log for up to 7 days to fix problems, with the last part of every internet address removed so it can't point to a single person. If you sign up, upload, import, comment or change your profile photo, the internet address you used is kept for 90 days, only to deal with abuse or legal requests. Listening never records it. There are no tracking pixels or third-party trackers, and your data isn't sold to anyone.",
  },
  {
    q: "How does importing from Soundgasm work?",
    a: <>You paste your Soundgasm profile link on the <Link to="/import" className="text-accent-2 hover:underline">Import</Link> page and the site gives you a short code. Put that code in the title or description of any one of your Soundgasm audios, click Check, and the site copies your whole catalogue over: titles, descriptions and tags included. It takes about 20 seconds per audio, so a 100-audio catalogue is roughly half an hour, and you can close the page while it runs. You can delete the code from Soundgasm afterwards.</>,
  },
  {
    q: "Couldn't someone import my catalogue without me?",
    a: "No. The import only runs if the site finds your unique code on that Soundgasm profile, and the only way to put it there is to be logged into that Soundgasm account. The check happens on our server, over an encrypted connection to Soundgasm, so it can't be faked from a browser.",
  },
  {
    q: "Someone did put my recordings here. What do I do?",
    a: <>If they came through the importer, you can fix it yourself in two minutes: on the <Link to="/import" className="text-accent-2 hover:underline">Import</Link> page, prove the Soundgasm profile is yours with your code and everything imported from it by other accounts is hidden immediately and flagged for removal. If the files were uploaded by hand, email <a href="mailto:info@sinkdeeper.com" className="text-accent-2 hover:underline">info@sinkdeeper.com</a> with links and they'll be taken down.</>,
  },
  {
    q: "Can I delete my account?",
    a: "Yes, any time, in Settings. It removes your account, every audio you've uploaded and the stored files, straight away and for good, so download anything you want to keep first. The internet address you used to sign up or upload is kept for up to 90 days afterwards, only for abuse and legal requests.",
  },
  {
    q: "Can I stop people downloading my files?",
    a: "Yes. Every upload has a switch for downloads, on or off, and you can change it later. With downloads off, people can only stream. Bear in mind that anything streamable can be recorded by a determined person, which is true of every audio site.",
  },
  {
    q: "Who can see my uploads?",
    a: "You choose per file: public (in feeds and search), unlisted (only people with the link), or private (only you). You can change it any time, and you can delete anything you've uploaded.",
  },
  {
    q: "What are the rules?",
    a: "You must be 18 or older to be here, and so must everyone in any recording. Only upload audio you made or have the rights to share. Nothing illegal. Anything that breaks those rules is removed and the account is banned.",
  },
  {
    q: "What about AI-generated audio?",
    a: "Say so in the description. Listeners here care a great deal about hearing a real person, and passing generated audio off as your own voice is the fastest way to lose their trust. Undisclosed AI content reported by listeners will be removed.",
  },
  {
    q: "How do I report something or send a takedown request?",
    a: <>Email <a href="mailto:info@sinkdeeper.com" className="text-accent-2 hover:underline">info@sinkdeeper.com</a> with a link to the audio and, for takedowns, a way to show you hold the rights. Requests are read by a person and handled within a day.</>,
  },
  {
    q: "How do I delete my account?",
    a: <>You can delete your uploads yourself from each file's menu. For full account deletion, email <a href="mailto:info@sinkdeeper.com" className="text-accent-2 hover:underline">info@sinkdeeper.com</a> from the account and it'll be done the same day. A self-service button is on the list.</>,
  },
];

export function FaqPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl">Questions people ask</h1>
      <p className="text-muted mt-2">Plain answers. If yours isn't here, <a href="mailto:info@sinkdeeper.com" className="text-accent-2 hover:underline">email</a> and it probably will be soon.</p>
      <div className="mt-8 divide-y divide-border">
        {faqs.map((f) => (
          <details key={f.q} className="group py-4">
            <summary className="cursor-pointer list-none flex items-start justify-between gap-4 font-semibold text-[1.02rem] hover:text-accent-2">
              <span>{f.q}</span>
              <span className="mt-1 shrink-0 text-muted transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <div className="mt-2 text-sm leading-relaxed text-muted max-w-prose">{f.a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
