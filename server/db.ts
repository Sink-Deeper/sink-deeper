import Database from "better-sqlite3";
import { paths } from "./config.js";

export const db = new Database(paths.db);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
  error TEXT,
  original_filename TEXT NOT NULL,
  original_path TEXT,
  stream_path TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  peaks TEXT,
  plays INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_audios_user ON audios(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audios_public ON audios(visibility, status, created_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS audio_tags (
  audio_id TEXT NOT NULL REFERENCES audios(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (audio_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_audio_tags_tag ON audio_tags(tag_id);

CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audio_id TEXT NOT NULL REFERENCES audios(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, audio_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_audio ON likes(audio_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  audio_id TEXT NOT NULL REFERENCES audios(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_audio ON comments(audio_id, created_at);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, slug)
);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  audio_id TEXT NOT NULL REFERENCES audios(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, audio_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS play_events (
  audio_id TEXT NOT NULL REFERENCES audios(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (audio_id, fingerprint, day)
);

CREATE TABLE IF NOT EXISTS download_events (
  audio_id TEXT NOT NULL REFERENCES audios(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (audio_id, fingerprint, day)
);
CREATE INDEX IF NOT EXISTS idx_download_events_day ON download_events(audio_id, day);
CREATE INDEX IF NOT EXISTS idx_play_events_day ON play_events(audio_id, day);

-- One row per listening session (client-generated id), updated by periodic heartbeats
CREATE TABLE IF NOT EXISTS listens (
  id TEXT PRIMARY KEY,
  audio_id TEXT NOT NULL REFERENCES audios(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  day TEXT NOT NULL,
  seconds REAL NOT NULL DEFAULT 0,
  max_pos REAL NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listens_audio_day ON listens(audio_id, day);

-- Catalogue import jobs (Soundgasm self-migration)
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  downloadable INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS audios_fts USING fts5(
  title, description, tags, content='', tokenize='porter unicode61'
);
-- What was indexed for each rowid; contentless FTS5 needs the original values to delete/replace an entry
CREATE TABLE IF NOT EXISTS fts_source (
  rowid INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listens_fp_day ON listens(audio_id, fingerprint, day);
`);

// Guarded column additions (poor man's migrations)
function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn("audios", "downloadable", "INTEGER NOT NULL DEFAULT 1");
addColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "banned", "INTEGER NOT NULL DEFAULT 0");
addColumn("audios", "downloads", "INTEGER NOT NULL DEFAULT 0");
addColumn("audios", "source_url", "TEXT");
addColumn("users", "verify_code", "TEXT");
addColumn("users", "verified_source", "TEXT");
addColumn("users", "verified_at", "INTEGER");
addColumn("audios", "claimed_by", "TEXT");
addColumn("users", "avatar", "TEXT"); // profile photo: local path or bunny:avatars/<key>
addColumn("audios", "group_id", "TEXT"); // versions of the same work (F4M / F4A ...) share the primary audio's id
addColumn("audios", "variant_label", "TEXT"); // what the switcher calls this version; falls back to its audience tag // set when the real Soundgasm owner reclaims an import made by someone else
// Indexes on migrated columns must come after the columns exist
db.exec("CREATE INDEX IF NOT EXISTS idx_audios_source ON audios(user_id, source_url)");

export const now = () => Date.now();
db.exec("CREATE INDEX IF NOT EXISTS idx_audios_group ON audios(group_id) WHERE group_id IS NOT NULL");
db.exec(`CREATE TABLE IF NOT EXISTS action_ips (
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_action_ips_created ON action_ips(created_at);
CREATE INDEX IF NOT EXISTS idx_action_ips_user ON action_ips(user_id);`);
