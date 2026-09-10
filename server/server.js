// ============================================================
// server.js — MirzaKateb API + static frontend.
// ============================================================
import "./env.js"; // MUST be first — loads .env before db/auth/ai read process.env
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";

import db, { seedAdmin, Users, Workspaces, Sessions, Chats, Admin, UPLOAD_DIR } from "./db.js";
import { attachUser, requireAuth, requireAdmin, issueCookie, clearCookie, isValidEmail } from "./auth.js";
import { transcribeLong, runTask, extractActions, askMemory, cleanTranscript, aiConfigured, TASKS, inferTask } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

seedAdmin();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(attachUser);

// ---- audio upload (saved to disk before any processing) ----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || extFromMime(file.mimetype);
    cb(null, Sessions.uid() + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 60 * 1024 * 1024 } }); // 60 MB

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: e.message || "Server error" });
});

// ================= AUTH =================
app.post("/api/auth/register", wrap((req, res) => {
  let { name, email, password } = req.body || {};
  name = (name || "").trim(); email = (email || "").trim().toLowerCase();
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password are required." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email." });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (Users.byEmail(email)) return res.status(409).json({ error: "An account with this email already exists." });
  const user = Users.create({ name, email, password });
  Workspaces.ensureDefault(user.id);
  Users.touchLogin(user.id);
  issueCookie(res, user);
  res.json({ user: Users.publicView(user) });
}));

app.post("/api/auth/login", wrap((req, res) => {
  let { email, password } = req.body || {};
  email = (email || "").trim().toLowerCase();
  const user = Users.byEmail(email);
  if (!user || !Users.verify(user, password || "")) return res.status(401).json({ error: "Wrong email or password." });
  if (user.is_active === 0) return res.status(403).json({ error: "This account has been suspended. Contact your administrator." });
  Workspaces.ensureDefault(user.id);
  Users.touchLogin(user.id);
  issueCookie(res, user);
  res.json({ user: Users.publicView(user) });
}));

app.post("/api/auth/logout", (req, res) => { clearCookie(res); res.json({ ok: true }); });
app.get("/api/auth/me", (req, res) => res.json({ user: req.user ? Users.publicView(req.user) : null, aiConfigured: aiConfigured() }));

// ================= STATE (hydration) =================
app.get("/api/state", requireAuth, wrap((req, res) => {
  const uid = req.user.id;
  res.json({
    user: Users.publicView(req.user),
    workspaces: Workspaces.listFor(uid),
    sessions: Sessions.listFor(uid),
    chats: Chats.allFor(uid),
    aiConfigured: aiConfigured(),
    tasks: TASKS,
  });
}));

// ================= WORKSPACES =================
app.post("/api/workspaces", requireAuth, wrap((req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  res.json({ workspace: Workspaces.create(req.user.id, { name, emoji: req.body?.emoji }) });
}));

app.delete("/api/workspaces/:id", requireAuth, wrap((req, res) => {
  const ok = Workspaces.remove(req.user.id, req.params.id);
  res.json({ ok });
}));

// ================= SESSIONS =================
// 1) Upload audio + create the session FIRST (audio is safely stored before processing).
app.post("/api/sessions", requireAuth, upload.single("audio"), wrap((req, res) => {
  const { workspace, title, prompt } = req.body || {};
  if (!workspace || !Workspaces.byId(req.user.id, workspace)) return res.status(400).json({ error: "Unknown workspace." });
  if (req.user.max_sessions != null) {
    const count = db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=?").get(req.user.id).c;
    if (count >= req.user.max_sessions) return res.status(403).json({ error: `Session limit reached (max ${req.user.max_sessions} sessions allowed on this account).` });
  }
  if (req.user.max_minutes != null) {
    const totalSecs = db.prepare("SELECT COALESCE(SUM(duration),0) t FROM sessions WHERE user_id=?").get(req.user.id).t;
    const newSecs = Number(req.body?.duration) || 0;
    if ((totalSecs + newSecs) > req.user.max_minutes * 60) {
      return res.status(403).json({ error: `Recording time limit reached (max ${req.user.max_minutes} minutes total allowed on this account).` });
    }
  }
  const session = Sessions.create(req.user.id, {
    workspace, title: title || "New recording",
    audioFile: req.file ? req.file.filename : null,
    audioMime: req.file ? req.file.mimetype : null,
    duration: Number(req.body?.duration) || 0,
    prompt: prompt || "", status: req.file ? "uploaded" : "draft",
  });
  res.json({ session });
}));

// 2) Process: transcribe (audio is already saved) → run task → extract actions.
app.post("/api/sessions/:id/process", requireAuth, wrap(async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: "AI is not configured on the server. Set OPENAI_API_KEY in .env." });
  const raw = Sessions.rawById(req.user.id, req.params.id);
  if (!raw) return res.status(404).json({ error: "Session not found." });
  if (!raw.audio_file) return res.status(400).json({ error: "This session has no audio." });

  const { taskKey, prompt, wantActions = true, language = "auto" } = req.body || {};
  const audioPath = path.join(UPLOAD_DIR, raw.audio_file);
  Sessions.update(req.user.id, raw.id, { status: "processing" });

  try {
    const rawTranscript = (await transcribeLong(audioPath, raw.audio_mime, language) || "").trim();
    console.log(`[process] session ${raw.id}: transcript ${rawTranscript.length} chars (${raw.audio_mime})`);
    if (rawTranscript.length < 3) {
      throw new Error("No speech was detected. The recording may be silent or an unsupported format — make sure you spoke (and, for meetings, that 'Share tab audio' was on), or upload an MP3/WAV.");
    }
    const transcript = await cleanTranscript(rawTranscript);

    const key = taskKey || inferTask(prompt);
    const label = TASKS.find((t) => t.key === key)?.label || "Convert to text";
    const content = await runTask({ transcript, prompt, taskKey: key });
    const output = { id: Sessions.uid(), type: label, created: Date.now(), versions: [{ id: Sessions.uid(), created: Date.now(), content }] };
    const actionItems = wantActions ? await extractActions(transcript) : [];

    const session = Sessions.update(req.user.id, raw.id, {
      transcript, prompt: prompt || label, status: "ready",
      title: deriveTitle(content, raw.title), outputs: [output], actionItems,
    });
    res.json({ session });
  } catch (e) {
    Sessions.update(req.user.id, raw.id, { status: "uploaded" }); // keep audio; allow retry
    res.status(502).json({ error: e.message });
  }
}));

// Generate an additional output from the stored transcript.
app.post("/api/sessions/:id/outputs", requireAuth, wrap(async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: "AI is not configured on the server." });
  const raw = Sessions.rawById(req.user.id, req.params.id);
  if (!raw) return res.status(404).json({ error: "Session not found." });
  const transcript = (raw.transcript || "").trim();
  if (transcript.length < 3) return res.status(400).json({ error: "This session has no transcript to work from. Re-record with clear audio, or upload an MP3/WAV." });
  const { taskKey, prompt, outputId } = req.body || {};
  const key = taskKey || inferTask(prompt);
  const label = TASKS.find((t) => t.key === key)?.label || "Custom prompt";
  const content = await runTask({ transcript, prompt, taskKey: key });
  const outputs = JSON.parse(raw.outputs || "[]");
  if (outputId) { // add a version to an existing output (regenerate)
    const out = outputs.find((o) => o.id === outputId);
    if (out) out.versions.unshift({ id: Sessions.uid(), created: Date.now(), content });
  } else {
    outputs.unshift({ id: Sessions.uid(), type: label, created: Date.now(), versions: [{ id: Sessions.uid(), created: Date.now(), content }] });
  }
  res.json({ session: Sessions.update(req.user.id, raw.id, { outputs }) });
}));

app.patch("/api/sessions/:id", requireAuth, wrap((req, res) => {
  const allowed = {};
  for (const k of ["title", "tags", "favorite", "actionItems", "outputs"]) if (k in (req.body || {})) allowed[k] = req.body[k];
  const session = Sessions.update(req.user.id, req.params.id, allowed);
  if (!session) return res.status(404).json({ error: "Session not found." });
  res.json({ session });
}));

app.delete("/api/sessions/:id", requireAuth, wrap((req, res) => {
  const raw = Sessions.rawById(req.user.id, req.params.id);
  if (raw?.audio_file) fs.promises.unlink(path.join(UPLOAD_DIR, raw.audio_file)).catch(() => {});
  res.json({ ok: Sessions.remove(req.user.id, req.params.id) });
}));

app.get("/api/sessions/:id/audio", requireAuth, wrap((req, res) => {
  const raw = Sessions.rawById(req.user.id, req.params.id);
  if (!raw?.audio_file) return res.status(404).end();
  const p = path.join(UPLOAD_DIR, raw.audio_file);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader("Content-Type", raw.audio_mime || "application/octet-stream");
  fs.createReadStream(p).pipe(res);
}));

// ================= CHAT (workspace memory) =================
app.post("/api/workspaces/:id/chat", requireAuth, wrap(async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: "AI is not configured on the server." });
  const wsId = req.params.id;
  if (!Workspaces.byId(req.user.id, wsId)) return res.status(404).json({ error: "Workspace not found." });
  const question = (req.body?.question || "").trim();
  if (!question) return res.status(400).json({ error: "Empty question." });

  const memory = Sessions.transcriptsFor(req.user.id, wsId);
  const answer = await askMemory({ question, memory });
  const messages = Chats.get(req.user.id, wsId);
  messages.push({ role: "user", content: question, ts: Date.now() });
  messages.push({ role: "ai", content: answer.content, cites: answer.cites, ts: Date.now() });
  Chats.set(req.user.id, wsId, messages);
  res.json(answer);
}));

app.delete("/api/workspaces/:id/chat", requireAuth, wrap((req, res) => {
  Chats.set(req.user.id, req.params.id, []); res.json({ ok: true });
}));

// ================= ADMIN =================
app.get("/api/admin/stats", requireAuth, requireAdmin, wrap((_req, res) => res.json(Admin.stats())));
app.get("/api/admin/users", requireAuth, requireAdmin, wrap((_req, res) => res.json({ users: Admin.users() })));
app.get("/api/admin/users/:id", requireAuth, requireAdmin, wrap((req, res) => {
  const detail = Admin.userDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "User not found." });
  res.json(detail);
}));

app.post("/api/admin/users", requireAuth, requireAdmin, wrap((req, res) => {
  let { name, email, password, role, maxSessions, maxStorageMb, maxMinutes } = req.body || {};
  name = (name || "").trim(); email = (email || "").trim().toLowerCase();
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password are required." });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (!["user", "admin"].includes(role)) role = "user";
  const toNum = (v) => v != null && v !== "" ? Number(v) : null;
  const detail = Admin.createUser({ name, email, password, role, maxSessions: toNum(maxSessions), maxStorageMb: toNum(maxStorageMb), maxMinutes: toNum(maxMinutes) });
  Workspaces.ensureDefault(detail.user.id);
  res.json(detail);
}));

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, wrap((req, res) => {
  const patch = {};
  const b = req.body || {};
  const toNum = (v) => v != null && v !== "" ? Number(v) : null;
  if ("name" in b && (b.name || "").trim()) patch.name = b.name.trim();
  if ("email" in b && (b.email || "").trim()) patch.email = b.email.trim().toLowerCase();
  if ("role" in b && ["user", "admin"].includes(b.role)) patch.role = b.role;
  if ("isActive" in b) patch.isActive = !!b.isActive;
  if ("maxSessions" in b) patch.maxSessions = toNum(b.maxSessions);
  if ("maxStorageMb" in b) patch.maxStorageMb = toNum(b.maxStorageMb);
  if ("maxMinutes" in b) patch.maxMinutes = toNum(b.maxMinutes);
  if ("password" in b && b.password && String(b.password).length >= 6) patch.password = b.password;
  const detail = Admin.updateUser(req.params.id, patch);
  if (!detail) return res.status(404).json({ error: "User not found." });
  res.json(detail);
}));

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, wrap((req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot delete your own account." });
  const ok = Admin.deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ error: "User not found." });
  res.json({ ok: true });
}));

// ================= STATIC + SPA =================
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"), // always revalidate → picks up updates
}));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`MirzaKateb running on http://localhost:${PORT}  (AI ${aiConfigured() ? "configured" : "NOT configured — set OPENAI_API_KEY"})`);
});

// ---- helpers ----
function extFromMime(mime = "") {
  const t = mime.toLowerCase();
  if (t.includes("webm")) return ".webm";
  if (t.includes("mp4") || t.includes("m4a")) return ".m4a";
  if (t.includes("wav")) return ".wav";
  if (t.includes("ogg")) return ".ogg";
  if (t.includes("mpeg") || t.includes("mp3")) return ".mp3";
  return ".dat";
}
function deriveTitle(content, fallback) {
  const h = content.match(/^#\s+(.+)/m);
  if (h) return h[1].replace(/[—–-].*$/, "").trim().slice(0, 60);
  return fallback || "Untitled session";
}
