// SQLite storage using Node's built-in node:sqlite (no native build step needed).
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'amg2026.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  designation TEXT,
  token TEXT NOT NULL UNIQUE,
  notify_whatsapp INTEGER NOT NULL DEFAULT 1,
  notify_email INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_email ON attendees(lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_phone ON attendees(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  media_path TEXT,
  media_type TEXT,          -- image | video | null
  link_url TEXT,            -- e.g. YouTube / livestream link
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,        -- YYYY-MM-DD
  start_time TEXT NOT NULL, -- HH:MM
  end_time TEXT NOT NULL,
  title TEXT NOT NULL,
  speaker TEXT,
  location TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('quiz','poll')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','closed')),
  results_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  opened_at TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  qtype TEXT NOT NULL DEFAULT 'choice' CHECK (qtype IN ('choice','text')),
  text TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  correct_index INTEGER,              -- quiz only
  points INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  started_at TEXT,
  submitted_at TEXT,
  duration_ms INTEGER,
  score INTEGER,
  UNIQUE (activity_id, attendee_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  option_index INTEGER,
  text_answer TEXT,
  is_correct INTEGER,
  answered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (question_id, attendee_id)
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendee_id INTEGER REFERENCES attendees(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  media_type TEXT NOT NULL,           -- image | video
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  official INTEGER NOT NULL DEFAULT 0, -- uploaded by organisers
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  to_id INTEGER REFERENCES attendees(id) ON DELETE CASCADE, -- NULL = lounge (group chat)
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_msg_pair ON messages(from_id, to_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch TEXT NOT NULL,
  attendee_id INTEGER REFERENCES attendees(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,   -- whatsapp | email
  subject TEXT,
  status TEXT NOT NULL,    -- sent | failed | dry-run | skipped
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wheels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  prizes TEXT NOT NULL DEFAULT '[]', -- JSON [{label, qty (null = unlimited), win}]
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wheel_spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wheel_id INTEGER NOT NULL REFERENCES wheels(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  prize_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  win INTEGER NOT NULL,
  spun_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wheel_id, attendee_id)
);

CREATE TABLE IF NOT EXISTS draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,                 -- the prize, e.g. "Weekend for two in Goa"
  winners_count INTEGER NOT NULL DEFAULT 1,
  checked_in_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS draw_winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_id INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'won' CHECK (status IN ('won','absent')),
  drawn_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (draw_id, attendee_id)
);

CREATE TABLE IF NOT EXISTS spotlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Columns added after launch (CREATE TABLE IF NOT EXISTS won't add them to an existing database).
const hasCol = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasCol('attendees', 'checked_in_at')) db.exec('ALTER TABLE attendees ADD COLUMN checked_in_at TEXT');
if (!hasCol('activities', 'image_path')) db.exec('ALTER TABLE activities ADD COLUMN image_path TEXT'); // artwork shown above a quiz/poll
if (!hasCol('attendees', 'wa_sent_at')) db.exec('ALTER TABLE attendees ADD COLUMN wa_sent_at TEXT'); // invite sent from the organiser's own WhatsApp
if (!hasCol('activities', 'cta_box')) db.exec('ALTER TABLE activities ADD COLUMN cta_box TEXT'); // JSON {x,y,w,h} in % : the artwork's button, made to glow

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value == null ? null : String(value));
}

// Run a function inside a transaction.
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, getSetting, setSetting, tx };
