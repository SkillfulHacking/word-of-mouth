import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "./password";

export const ROLES = ["admin", "coordinator", "promoter", "attendee"] as const;
export type Role = (typeof ROLES)[number];

export type User = { id: number; username: string; role: Role };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','coordinator','promoter','attendee')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
-- The server never stores event details in plaintext or the AES key. Only the
-- sealed blob lives here; the key exists as Shamir shards on paper/NFC.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  coordinator_id INTEGER NOT NULL REFERENCES users(id),
  codename TEXT NOT NULL,
  zip TEXT NOT NULL,
  blob TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  theme TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS event_spots (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  label TEXT NOT NULL,
  clue TEXT NOT NULL,
  lat REAL,
  lon REAL,
  osm_ref TEXT,
  PRIMARY KEY (event_id, idx)
);
-- Word of mouth: coordinators give promoters a quota of invites; each invite is single-use.
CREATE TABLE IF NOT EXISTS event_promoters (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  promoter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota INTEGER NOT NULL CHECK (quota > 0),
  PRIMARY KEY (event_id, promoter_id)
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  redeemed_by INTEGER REFERENCES users(id),
  redeemed_at INTEGER,
  batch TEXT
);
-- A ticket is a redeemed invite. It proves the right to attend; it does not reveal where.
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE REFERENCES invites(code),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (event_id, user_id)
);
-- Door check-in (zero-knowledge). A pass registers only a PUBLIC commitment; the secret stays on the phone.
-- Registering links a commitment to a ticket, which is unavoidable. Check-ins are different: the checkins table
-- stores a nullifier only, with no column that points at a ticket or a user.
CREATE TABLE IF NOT EXISTS door_passes (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  commitment TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (event_id, commitment)
);
-- Every Merkle root the guest list has ever had, so a proof made a moment before someone else registered still counts.
CREATE TABLE IF NOT EXISTS group_roots (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  root TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (event_id, root)
);
CREATE TABLE IF NOT EXISTS door_challenges (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','admitted')),
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS checkins (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  nullifier TEXT NOT NULL,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_id, nullifier)
);
-- Pictures made by ComfyUI for an event. Files live on disk next to the database; only the event's
-- selected picture is public. The prompt is kept so a coordinator can see what made a picture.
CREATE TABLE IF NOT EXISTS event_images (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  negative TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  checkpoint TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  error TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Map lookups are cached so re-planning doesn't hammer the shared Overpass servers.
CREATE TABLE IF NOT EXISTS osm_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

/**
 * First start only: if the database has no users and WOM_ADMIN_PASSWORD is set, create the admin.
 * This is how a container gets its first login without a shell. It never touches an existing database.
 */
function bootstrapAdmin(d: Database.Database): void {
  const password = process.env.WOM_ADMIN_PASSWORD;
  if (!password) return;
  if ((d.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n > 0) return;
  if (password.length < 8) {
    console.error("WOM_ADMIN_PASSWORD must be at least 8 characters; no admin was created.");
    return;
  }
  const username = (process.env.WOM_ADMIN_USER ?? "admin").toLowerCase();
  d.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, ?, 'admin')").run(username, hashPassword(password));
  console.log(`Created the first admin "${username}".`);
}

/** Add a column to a table made by an earlier version of the app. CREATE TABLE IF NOT EXISTS won't. */
function ensureColumn(d: Database.Database, table: string, column: string, ddl: string): void {
  const have = (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!have) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function migrate(d: Database.Database): void {
  ensureColumn(d, "events", "theme", "TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(d, "invites", "batch", "TEXT");
  // A job that was mid-flight when the server stopped will never finish.
  d.prepare("UPDATE event_images SET status = 'failed', error = 'Interrupted by a restart.' WHERE status = 'running'").run();
}

function open(): Database.Database {
  const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "wom.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  migrate(d);
  bootstrapAdmin(d);
  return d;
}

declare global {
  var __womDb: Database.Database | undefined;
}

export const db: Database.Database = (globalThis.__womDb ??= open());
