// ============================================================
// db.js — SQLite schema + helpers. Single-file, zero-config.
// ============================================================
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "mirzakateb.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '◇',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  audio_file    TEXT,
  audio_mime    TEXT,
  duration      INTEGER DEFAULT 0,
  transcript    TEXT DEFAULT '',
  prompt        TEXT DEFAULT '',
  tags          TEXT DEFAULT '[]',
  status        TEXT DEFAULT 'uploaded',
  favorite      INTEGER DEFAULT 0,
  outputs       TEXT DEFAULT '[]',
  action_items  TEXT DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_ws   ON sessions(workspace_id);

CREATE TABLE IF NOT EXISTS chats (
  user_id      TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  messages     TEXT DEFAULT '[]',
  PRIMARY KEY (user_id, workspace_id)
);
`);

// Migrate: add new user fields if absent (safe to re-run on existing DB)
try { db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN max_sessions INTEGER"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN max_storage_mb INTEGER"); } catch {}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ---- Seed the admin account (credentials overridable via env) ----
export function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin1245@";
  const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(email);
  if (existing) {
    if (existing.role !== "admin") db.prepare("UPDATE users SET role='admin' WHERE id=?").run(existing.id);
    return;
  }
  db.prepare("INSERT INTO users (id,email,name,pass_hash,role,created_at) VALUES (?,?,?,?,?,?)")
    .run(uid(), email, "Administrator", bcrypt.hashSync(password, 10), "admin", Date.now());
  console.log(`[db] seeded admin account "${email}"`);
}

// ---- Users ----
export const Users = {
  create({ email, name, password }) {
    const id = uid();
    db.prepare("INSERT INTO users (id,email,name,pass_hash,role,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, email, name, bcrypt.hashSync(password, 10), "user", Date.now());
    return Users.byId(id);
  },
  byEmail: (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email),
  byId: (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id),
  verify: (user, password) => bcrypt.compareSync(password, user.pass_hash),
  touchLogin: (id) => db.prepare("UPDATE users SET last_login=? WHERE id=?").run(Date.now(), id),
  publicView: (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.is_active !== 0, createdAt: u.created_at, lastLogin: u.last_login }),
};

// ---- Workspaces ----
export const Workspaces = {
  create(userId, { name, emoji }) {
    const id = uid();
    db.prepare("INSERT INTO workspaces (id,user_id,name,emoji,created_at) VALUES (?,?,?,?,?)")
      .run(id, userId, name, emoji || "◇", Date.now());
    return Workspaces.byId(userId, id);
  },
  byId: (userId, id) => db.prepare("SELECT * FROM workspaces WHERE id=? AND user_id=?").get(id, userId),
  listFor: (userId) => db.prepare("SELECT * FROM workspaces WHERE user_id=? ORDER BY created_at").all(userId)
    .map((w) => ({ id: w.id, name: w.name, emoji: w.emoji, created: w.created_at })),
  remove(userId, id) {
    db.prepare("DELETE FROM sessions WHERE workspace_id=? AND user_id=?").run(id, userId);
    db.prepare("DELETE FROM chats WHERE workspace_id=? AND user_id=?").run(id, userId);
    return db.prepare("DELETE FROM workspaces WHERE id=? AND user_id=?").run(id, userId).changes > 0;
  },
  ensureDefault(userId) {
    if (Workspaces.listFor(userId).length === 0) Workspaces.create(userId, { name: "Personal", emoji: "🌿" });
  },
};

// ---- Sessions ----
const rowToSession = (r) => ({
  id: r.id, workspace: r.workspace_id, title: r.title,
  audioName: r.audio_file ? path.basename(r.audio_file) : "",
  hasAudio: !!r.audio_file, duration: r.duration,
  transcript: r.transcript, prompt: r.prompt,
  tags: JSON.parse(r.tags || "[]"), status: r.status,
  favorite: !!r.favorite, outputs: JSON.parse(r.outputs || "[]"),
  actionItems: JSON.parse(r.action_items || "[]"),
  date: r.created_at, updated: r.updated_at,
});

export const Sessions = {
  uid,
  create(userId, s) {
    const id = uid(); const now = Date.now();
    db.prepare(`INSERT INTO sessions
      (id,user_id,workspace_id,title,audio_file,audio_mime,duration,transcript,prompt,tags,status,favorite,outputs,action_items,created_at,updated_at)
      VALUES (@id,@user_id,@workspace_id,@title,@audio_file,@audio_mime,@duration,@transcript,@prompt,@tags,@status,@favorite,@outputs,@action_items,@created_at,@updated_at)`)
      .run({
        id, user_id: userId, workspace_id: s.workspace, title: s.title || "Untitled",
        audio_file: s.audioFile || null, audio_mime: s.audioMime || null, duration: s.duration || 0,
        transcript: s.transcript || "", prompt: s.prompt || "", tags: JSON.stringify(s.tags || []),
        status: s.status || "uploaded", favorite: s.favorite ? 1 : 0,
        outputs: JSON.stringify(s.outputs || []), action_items: JSON.stringify(s.actionItems || []),
        created_at: now, updated_at: now,
      });
    return Sessions.byId(userId, id);
  },
  rawById: (userId, id) => db.prepare("SELECT * FROM sessions WHERE id=? AND user_id=?").get(id, userId),
  byId(userId, id) { const r = Sessions.rawById(userId, id); return r ? rowToSession(r) : null; },
  listFor: (userId) => db.prepare("SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC").all(userId).map(rowToSession),
  update(userId, id, patch) {
    const r = Sessions.rawById(userId, id); if (!r) return null;
    const map = {
      title: "title", duration: "duration", transcript: "transcript", prompt: "prompt",
      status: "status", audioFile: "audio_file", audioMime: "audio_mime",
    };
    const sets = []; const vals = {};
    for (const [k, col] of Object.entries(map)) if (k in patch) { sets.push(`${col}=@${col}`); vals[col] = patch[k]; }
    if ("tags" in patch) { sets.push("tags=@tags"); vals.tags = JSON.stringify(patch.tags); }
    if ("favorite" in patch) { sets.push("favorite=@favorite"); vals.favorite = patch.favorite ? 1 : 0; }
    if ("outputs" in patch) { sets.push("outputs=@outputs"); vals.outputs = JSON.stringify(patch.outputs); }
    if ("actionItems" in patch) { sets.push("action_items=@action_items"); vals.action_items = JSON.stringify(patch.actionItems); }
    sets.push("updated_at=@updated_at"); vals.updated_at = Date.now();
    db.prepare(`UPDATE sessions SET ${sets.join(",")} WHERE id=@id AND user_id=@user_id`).run({ ...vals, id, user_id: userId });
    return Sessions.byId(userId, id);
  },
  remove: (userId, id) => db.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").run(id, userId).changes > 0,
  transcriptsFor: (userId, wsId) =>
    db.prepare("SELECT id,title,transcript FROM sessions WHERE user_id=? AND workspace_id=?").all(userId, wsId)
      .map((r) => ({ id: r.id, title: r.title, transcript: r.transcript || "" })),
};

// ---- Chats ----
export const Chats = {
  get: (userId, wsId) => JSON.parse(db.prepare("SELECT messages FROM chats WHERE user_id=? AND workspace_id=?").get(userId, wsId)?.messages || "[]"),
  set(userId, wsId, messages) {
    db.prepare(`INSERT INTO chats (user_id,workspace_id,messages) VALUES (?,?,?)
      ON CONFLICT(user_id,workspace_id) DO UPDATE SET messages=excluded.messages`)
      .run(userId, wsId, JSON.stringify(messages));
  },
  allFor: (userId) => {
    const out = {};
    for (const r of db.prepare("SELECT workspace_id, messages FROM chats WHERE user_id=?").all(userId))
      out[r.workspace_id] = JSON.parse(r.messages || "[]");
    return out;
  },
};

// ---- Admin analytics + CRUD ----
export const Admin = {
  stats() {
    const users = db.prepare("SELECT COUNT(*) c FROM users WHERE role!='admin'").get().c;
    const sessions = db.prepare("SELECT COUNT(*) c FROM sessions").get().c;
    const workspaces = db.prepare("SELECT COUNT(*) c FROM workspaces").get().c;
    const withAudio = db.prepare("SELECT COUNT(*) c FROM sessions WHERE audio_file IS NOT NULL").get().c;
    return { users, sessions, workspaces, withAudio };
  },
  users() {
    return db.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.is_active, u.max_sessions, u.max_storage_mb,
        u.created_at, u.last_login,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id) AS sessions,
        (SELECT COUNT(*) FROM workspaces w WHERE w.user_id=u.id) AS workspaces
      FROM users u ORDER BY u.created_at DESC
    `).all().map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      isActive: u.is_active !== 0,
      maxSessions: u.max_sessions ?? null,
      maxStorageMb: u.max_storage_mb ?? null,
      createdAt: u.created_at, lastLogin: u.last_login,
      sessions: u.sessions, workspaces: u.workspaces,
    }));
  },
  userDetail(id) {
    const u = Users.byId(id); if (!u) return null;
    const sessions = db.prepare("SELECT id,title,workspace_id,status,duration,created_at FROM sessions WHERE user_id=? ORDER BY created_at DESC").all(id)
      .map((s) => ({ id: s.id, title: s.title, status: s.status, duration: s.duration, date: s.created_at }));
    return { user: Users.publicView(u), sessions };
  },
  createUser({ name, email, password, role = "user", maxSessions, maxStorageMb }) {
    if (Users.byEmail(email)) throw new Error("An account with this email already exists.");
    const id = uid();
    db.prepare("INSERT INTO users (id,email,name,pass_hash,role,is_active,max_sessions,max_storage_mb,created_at) VALUES (?,?,?,?,?,1,?,?,?)")
      .run(id, email, name, bcrypt.hashSync(password, 10), role, maxSessions ?? null, maxStorageMb ?? null, Date.now());
    return Admin.userDetail(id);
  },
  updateUser(id, patch) {
    if (!Users.byId(id)) return null;
    const sets = []; const vals = { id };
    if ("name" in patch) { sets.push("name=@name"); vals.name = patch.name; }
    if ("email" in patch) { sets.push("email=@email"); vals.email = patch.email; }
    if ("role" in patch) { sets.push("role=@role"); vals.role = patch.role; }
    if ("isActive" in patch) { sets.push("is_active=@is_active"); vals.is_active = patch.isActive ? 1 : 0; }
    if ("maxSessions" in patch) { sets.push("max_sessions=@max_sessions"); vals.max_sessions = patch.maxSessions ?? null; }
    if ("maxStorageMb" in patch) { sets.push("max_storage_mb=@max_storage_mb"); vals.max_storage_mb = patch.maxStorageMb ?? null; }
    if (patch.password) { sets.push("pass_hash=@pass_hash"); vals.pass_hash = bcrypt.hashSync(patch.password, 10); }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=@id`).run(vals);
    return Admin.userDetail(id);
  },
  deleteUser(id) {
    return db.prepare("DELETE FROM users WHERE id=?").run(id).changes > 0;
  },
};

export default db;
