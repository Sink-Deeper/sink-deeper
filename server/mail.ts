/**
 * Transactional email, used only for optional account recovery (verify an address, reset a password).
 * No provider configured means the whole feature is switched off: the routes refuse and the UI hides itself.
 * MAIL_PROVIDER=outbox writes messages to data/outbox instead of sending, for local testing.
 */
import fs from "node:fs";
import path from "node:path";
import { config, paths } from "./config.js";

export const mailEnabled = !!config.mail;

export type Message = { to: string; subject: string; text: string };

export async function sendMail(m: Message): Promise<void> {
  const cfg = config.mail;
  if (!cfg) throw new Error("email is not configured");
  if (cfg.provider === "outbox") {
    const file = path.join(paths.outbox, `${Date.now()}-${m.to.replace(/[^a-z0-9@._-]/gi, "_")}.txt`);
    fs.writeFileSync(file, `To: ${m.to}\nFrom: ${cfg.from}\nSubject: ${m.subject}\n\n${m.text}\n`, { mode: 0o600 });
    return;
  }
  const signal = AbortSignal.timeout(20_000);
  const res = cfg.provider === "resend"
    ? await fetch("https://api.resend.com/emails", {
        method: "POST", signal,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, text: m.text, ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) }),
      })
    : await fetch("https://api.postmarkapp.com/email", {
        method: "POST", signal,
        headers: { "X-Postmark-Server-Token": cfg.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ From: cfg.from, To: m.to, Subject: m.subject, TextBody: m.text, MessageStream: "outbound", ...(cfg.replyTo ? { ReplyTo: cfg.replyTo } : {}) }),
      });
  if (!res.ok) {
    // The provider's reply can quote the address; keep it out of the logs
    throw new Error(`mail provider ${cfg.provider} returned ${res.status}`);
  }
}

/** Where a link in an email should point. Falls back to the live site if PUBLIC_URL isn't set. */
export const linkTo = (p: string): string => `${config.publicUrl || "https://sinkdeeper.com"}${p}`;
