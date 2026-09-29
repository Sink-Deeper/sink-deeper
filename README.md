# Sinkdeeper

The code behind [sinkdeeper.com](https://sinkdeeper.com), a free audio host for adult audio creators (internal codename
"Murmur"). It's a Soundgasm-style site with the things Soundgasm never had: tags, search, a persistent waveform player,
likes, comments, playlists, follows, creator analytics, unlisted and private links, and a one-click catalogue importer
that only works for the account's verified owner. No email is needed to sign up.

This repository is public so creators and listeners can check how the site works and what it does with their data,
rather than having to take that on trust.

## Privacy, in short

- **No email, no real name, one cookie.** The only cookie keeps you logged in. No analytics services, trackers or ad networks.
- **Anonymous listening is unlinkable.** Logged-out listeners are counted with a code made from their address and browser,
  scrambled with a random key that's replaced every day and never kept (`server/fingerprint.ts`). Raw addresses are never
  stored in the database.
- **Logs are masked and short-lived.** Web logs drop the last part of every address and are deleted after 7 days.
- **Exact addresses only for public actions.** Signing up, uploading, importing, commenting or changing a profile photo
  records the address used, for abuse and legal requests only, deleted after 90 days (`server/accountability.ts`).
- **Listening data is deleted after 400 days**, and accounts can be deleted from Settings along with everything in them
  (`server/account.ts`).

## Reporting a security problem

Please email **info@sinkdeeper.com** rather than opening a public issue. See [SECURITY.md](SECURITY.md).

## Licence

The source is published for transparency. No open-source licence has been chosen yet, so normal copyright applies:
you're welcome to read and review it, but not to reuse it without permission.

## Features

- Username + password signup, no email. Session cookies, scrypt hashing.
- Uploads transcoded to AAC with waveform peaks; range-request streaming; persistent player with speed control and keyboard/media-key support.
- Public, unlisted and private visibility per upload, plus a per-file **allow downloads** switch. Stream-only files return 403 on `?download=1` for everyone except the owner.
- Explore page with multi-tag filtering and sort (newest / most played / most liked), full-text search, tag index.
- Creators directory with search and sort; profiles with banner, bio, stats, per-profile tag filter and sort.
- Playlists: creators group their uploads into series shown on their profile; anyone can collect others' work. Reorder, public/private, edit.
- Likes, comments, follows with a following feed, embeddable player, share links, 18+ interstitial.

## Stack

- **Server**: Express 5 + TypeScript (run with `tsx`), SQLite via `better-sqlite3` (WAL mode, FTS5 full-text search),
  `ffmpeg`/`ffprobe` for transcoding and waveform peaks. Session cookies with scrypt-hashed passwords. No ORM.
- **Client**: React 19 + Vite + Tailwind v4 + React Router. Single global `<audio>` element behind a player context,
  canvas waveform rendered from server-computed peaks.
- **Storage**: local disk under `DATA_DIR` (`app.db`, `uploads/`, `media/`, `originals/`).

## Requirements

Node 22+, `ffmpeg` and `ffprobe` on `PATH`.

## Run

```bash
npm install
cp .env.example .env      # optional, defaults are fine for local
npm run dev               # server on :3000, Vite on :5173 (proxies /api and /media)
```

Production:

```bash
npm run build             # builds client/dist
npm start                 # serves API + built client on PORT (default 3000)
```

Put it behind a reverse proxy with TLS; `secure` cookies are enabled when `NODE_ENV=production`. Raise the proxy's body
size limit to match `MAX_UPLOAD_MB`.

## Configuration (`.env`)

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite db and audio files |
| `MAX_UPLOAD_MB` | `500` | Upload size cap |
| `KEEP_ORIGINALS` | `0` | Keep the source file next to the transcoded AAC copy |
| `PUBLIC_URL` | | Base URL for share links (optional) |
| `HOST` | `127.0.0.1` | Bind address; the app expects Caddy in front |
| `MAX_DURATION_MIN` | `360` | Longest audio accepted |
| `FFMPEG_TIMEOUT_MIN` | `30` | Per-step transcode/peaks timeout |
| `ANALYTICS_RETENTION_DAYS` | `400` | Raw play/download/listen rows older than this are pruned nightly |

## How uploads work

1. `POST /api/audios` (multipart) writes the file to `uploads/` and inserts a row with `status=processing`.
2. A single in-process queue runs `ffprobe` (duration), `ffmpeg` (AAC 160k `.m4a` with faststart), then decodes to
   8 kHz mono PCM and buckets it into 1200 normalized peaks stored as JSON on the row.
3. The row flips to `ready`; the client polls until then. Anything stuck in `processing` is re-queued on boot.
4. `/media/:id.m4a` streams with HTTP range support. Private audio is only served to its owner.

## API sketch

```
POST   /api/auth/register|login|logout      GET/PATCH /api/auth/me     POST /api/auth/password
POST   /api/audios (multipart)              GET /api/audios/:id        GET /api/audios/by/:user/:slug
PATCH  /api/audios/:id                      DELETE /api/audios/:id
POST   /api/audios/:id/like|play            GET/POST /api/audios/:id/comments   DELETE .../comments/:cid
GET    /api/browse/feed?sort=new|top|liked  GET /api/browse/following  GET /api/browse/search?q=&tags=a,b
GET    /api/browse/tags                     GET /api/browse/stats
GET    /api/users/:u  /audios  /likes       POST /api/users/:u/follow
GET    /api/playlists/mine  /user/:u  /by/:u/:slug   POST /api/playlists   PATCH|DELETE /api/playlists/:id
POST   /api/playlists/:id/items (toggle)    PUT /api/playlists/:id/order
GET    /media/:id.m4a[?download=1]          GET /embed/:id (iframe player)
```

## Bulk upload and Soundgasm import

- `/upload/bulk`: pick many files; titles are derived from filenames (editable), shared tags/visibility/download
  settings apply to all, `[bracketed]` title parts become tags, and 429s are waited out and retried automatically.
- `/import`: self-migration from a Soundgasm profile. The creator proves ownership by putting a per-account code
  (`GET /api/import/verification`) in a title, filename, or description on Soundgasm; `POST /api/import/preview`
  checks it (admins bypass), `POST /api/import` starts a background job (`server/importer.ts`) that reads each
  audio page (same markup patterns yt-dlp uses), downloads the m4a through the normal pipeline, and turns
  `[bracketed]` parts and audience codes (X4Y, e.g. F4M, FF4A, TF4M) in the title and description into tags,
  removing them from the stored title/description (`extractTags`/`stripTags` in `server/util.ts`). Skips already-imported URLs (`audios.source_url`), respects quota and
  size limits, 1.5 s between requests, resumes after restart, cancellable. A successful ownership check is valid for 24 h
  (`users.verified_at`), then the code must still be present to start another import. `POST /api/import/claim` is the
  reverse challenge: the real owner proves a profile with their own code and every audio imported from it by other accounts
  is set private and marked `claimed_by` for admin review (listed in the admin overview). Only soundgasm.net hosts are fetched
  (`IMPORT_ALLOWED_HOSTS` overrides this for tests against a mock server).

Audience tags (any `X4Y` code built from the letters F, M, A, T, N, B, X) are shown uppercase in an accent chip and
sorted first wherever tags appear. Tags are capped at 50 per audio.

## Creator analytics

`/analytics` (overview) and `/analytics/:id` (one audio) show plays, unique listeners, listening time, average
listen per session, completion rate, downloads, likes and comments, with daily charts and a retention curve.
Data sources: `play_events` (one row per listener per audio per day, already used for play counts),
`download_events` (same shape, written when `?download=1` is served), and `listens` (one row per listening
session; the player POSTs `/api/audios/:id/listen` heartbeats every ~15 s of real listening with accumulated
seconds and furthest position, so seeks and idle tabs don't count). API: `/api/analytics/overview?days=N` and
`/api/analytics/audio/:id?days=N`, owner or admin only.

## Limits, admins and bans

Abuse limits are enforced server-side with an in-memory fixed-window limiter (`server/ratelimit.ts`) plus DB-backed
quotas; all are env-tunable (see `.env.example`). Defaults: 20 uploads/day and 5 GB stored per user, 5 uploads per
10 minutes, 30 downloads/hour per listener, 5 registrations/day per IP, 10 login attempts/15 min per IP, 30
comments/hour, 100 playlists of up to 500 items, 300 likes/follows/playlist edits per hour, 600 API calls/min per IP.
Owners and admins are exempt from download limits; admins are exempt from everything. Registration only counts
*successful* signups; login adds a per-account cap on *failed* attempts (`MAX_LOGIN_FAILURES_PER_ACCOUNT_PER_15MIN`,
default 20); password change is capped at 5 per 15 minutes and logs out every other session. Passwords are hashed
with async scrypt (N=2^15, format `scrypt2$N$salt$hash`); older `scrypt$` hashes are upgraded transparently on login.
Anonymous limiter keys are the client IP, never the User-Agent.

Admins (`users.is_admin`) can edit/delete any audio or comment and ban users via `POST /api/admin/users/:username/ban`
(a Ban button appears on profiles). Banned users are logged out, can't log in, and their content vanishes from listings.
Grant admin on the server: `cd /opt/murmur && set -a && . /etc/murmur/env && set +a && npx tsx server/scripts/set-admin.ts <username>`.

## Media on Bunny.net (optional)

Set the five `BUNNY_*` vars (see `.env.example`) and new uploads go to a Bunny Storage zone after transcoding; the
app hands out signed CDN URLs (24 h, hour-aligned) for streaming and proxies downloads itself so it can set a
filename and enforce the per-file download switch. Provision the zones with
`BUNNY_API_KEY=... deploy/bunny-provision.py <zone-name> <region>` (idempotent; prints the env vars), and move any
existing local files with `server/scripts/migrate-to-bunny.ts`. Unset the vars and the app falls back to local disk.

## Deploying

`deploy/setup.sh` provisions an Ubuntu 24.04 box (Node 22, ffmpeg, Caddy, ufw, fail2ban, swap, systemd unit) and
`deploy/deploy.sh user@host` builds the client locally, rsyncs, installs deps, and restarts. App lives in `/opt/murmur`,
data in `/var/lib/murmur`, env in `/etc/murmur/env`, Caddy config in `/etc/caddy/Caddyfile`.

## Backups

`deploy/backup.sh` (installed as `/usr/local/bin/murmur-backup`, nightly at 04:00 UTC via `murmur-backup.timer`) pushes a
consistent SQLite copy, the server config, and every media file (from Bunny and any local disk) to a private Backblaze B2
bucket using `rclone copy` with a key that lacks `deleteFiles`. Such a key can still *hide* a file (B2's soft delete),
so the bucket's lifecycle rules keep hidden versions recoverable: 30 days for `db/` and `config/`, 90 days for `media/`
(`rclone ls --b2-versions` shows them). A compromised server therefore cannot permanently destroy history. Dumps are
hidden automatically 30 days after upload.

The DB copy has the `sessions` table stripped before it leaves the box. The config tarball holds every secret, so it is
encrypted with `BACKUP_PASSPHRASE` from `/etc/murmur/backup.env` (generated by `install-backup.sh`; **store it in a
password manager**, it is the only way to open those tarballs). Each run writes `$DATA_DIR/backup-status.json`, which
`GET /api/admin/overview` reports as `backup` (`stale` after 36 h without success or after a failure); a systemd
`OnFailure` unit writes the same marker if the script crashes early.
Provision with `B2_KEY_ID=... B2_APP_KEY=... deploy/b2-provision.py <bucket>` (account key, one-time), put the printed
lines in `/etc/murmur/backup.env`, then run `deploy/install-backup.sh` on the server. Check with
`systemctl status murmur-backup` / `journalctl -u murmur-backup`.

**Restore:** provision a fresh box with `deploy/setup.sh`, deploy the app, then `rclone copy b2:<bucket>/db/<latest>.db.gz`,
gunzip to `/var/lib/murmur/app.db`, restore `/etc/murmur/env` from `config/`, and either point the app at the existing Bunny
zone (rows reference `bunny:` keys, nothing else needed) or `rclone copy b2:<bucket>/media /var/lib/murmur/media` and set
`stream_path` back to local paths.

## Hardening notes

- Uploads: multer bounds file *and* text parts; ffmpeg runs with `-t` (max duration), `-fs` (max output size) and a kill
  timeout; a failed upload's raw file is removed and its row zeroed but still counts toward the daily cap. Deleting an
  audio mid-processing is safe (the worker checks the row between steps and removes what it created). `uploads/` is
  swept of unreferenced files older than an hour at boot and every 6 h.
- Search: `fts_source` mirrors what was indexed so the contentless FTS table can be updated/deleted correctly; if it is
  empty at boot while ready audio exists, the index is rebuilt.
- Importer: allowlist re-checked on every redirect hop, pages streamed with a size cap, cancel aborts the in-flight
  download, quota exhaustion stops the run, user-facing errors are scrubbed of paths. `IMPORT_TEST_MODE=1` (not just an
  allowlist override) is needed to relax the profile-URL shape for a mock server.
- Listen heartbeats: capped by wall-clock time since the session began and to 30 sessions per listener per audio per day.
- Playlists: items the viewer can't see are hidden; the owner gets an `unavailable` count and `POST /:id/prune`.
- HTTP: `/media` has its own per-IP limiter; Node's request timeout is 2 h for large uploads; Caddy sends
  `X-Frame-Options`/`frame-ancestors` for everything except `/embed/*`; `index.html` is `no-cache`, hashed assets
  immutable; `/api/health` for monitors.

## Not done yet / ideas

- User reports queue, CAPTCHA on registration, email-free account recovery codes.
- RSS feeds per user, notifications, series/collections, script-credit linking.
- Password reset (deliberately absent because there is no email; consider recovery codes).
