/**
 * Transactional email, used only for optional account recovery (verify an address, reset a password).
 * No provider configured means the whole feature is switched off: the routes refuse and the UI hides itself.
 * MAIL_PROVIDER=outbox writes messages to data/outbox instead of sending, for local testing.
 */
import crypto from "node:crypto";
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
  if (cfg.provider === "ses") return sendViaSes(m, cfg, signal);
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

// ---- Amazon SES ---------------------------------------------------------------------------------------------
// Signed with SigV4 by hand: the AWS SDK is a large dependency for one API call. Sends through the SESv2 endpoint
// in MAIL_REGION (default us-east-1).
type SesCfg = { from: string; apiKey: string; secretKey: string; region: string; replyTo: string | null };

const sha256hex = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac("sha256", key).update(data).digest();

/** AWS Signature Version 4 for a POST with a JSON body. */
export function signV4(opts: { method: string; host: string; path: string; region: string; service: string; body: string; accessKey: string; secretKey: string; now?: Date }): Record<string, string> {
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(opts.body);
  const canonicalHeaders = `content-type:application/json\nhost:${opts.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `${opts.method}\n${opts.path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`;
  const signing = hmac(hmac(hmac(hmac(`AWS4${opts.secretKey}`, dateStamp), opts.region), opts.service), "aws4_request");
  const signature = crypto.createHmac("sha256", signing).update(toSign).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    "X-Amz-Content-Sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function sendViaSes(m: Message, cfg: SesCfg, signal: AbortSignal): Promise<void> {
  const host = `email.${cfg.region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({
    FromEmailAddress: cfg.from,
    Destination: { ToAddresses: [m.to] },
    ...(cfg.replyTo ? { ReplyToAddresses: [cfg.replyTo] } : {}),
    Content: { Simple: { Subject: { Data: m.subject, Charset: "UTF-8" }, Body: { Text: { Data: m.text, Charset: "UTF-8" } } } },
  });
  const headers = signV4({ method: "POST", host, path, region: cfg.region, service: "ses", body, accessKey: cfg.apiKey, secretKey: cfg.secretKey });
  const res = await fetch(`https://${host}${path}`, { method: "POST", headers, body, signal });
  if (!res.ok) throw new Error(`mail provider ses returned ${res.status}`);
}
