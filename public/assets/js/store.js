/* ============================================================
   store.js — client data layer, backed by the server API.
   Keeps an in-memory cache (so views read synchronously) and
   writes through to the backend. Only UI prefs live locally.
   ============================================================ */

async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const PREFS_KEY = "mirzakateb.prefs";
const defaultPrefs = { theme: "light", language: "en", exportDefault: "md", recordingQuality: "standard" };
function loadPrefs() { try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return { ...defaultPrefs }; } }

let state = {
  user: null,
  workspaces: [],
  activeWorkspace: null,
  sessions: [],
  chats: {},
  aiConfigured: false,
  settings: loadPrefs(),
  loaded: false,
};

const subs = new Set();
const notify = () => subs.forEach((fn) => fn(state));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export const store = {
  api,
  get: () => state,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  uid,

  // ---- session / auth ----
  async me() {
    const d = await api("/api/auth/me");
    state.user = d.user; state.aiConfigured = !!d.aiConfigured;
    return d.user;
  },
  async hydrate() {
    const d = await api("/api/state");
    state.user = d.user;
    state.workspaces = d.workspaces || [];
    state.sessions = d.sessions || [];
    state.chats = d.chats || {};
    state.aiConfigured = !!d.aiConfigured;
    if (!state.activeWorkspace || !state.workspaces.find((w) => w.id === state.activeWorkspace)) {
      state.activeWorkspace = state.workspaces[0]?.id || null;
    }
    state.loaded = true;
    notify();
  },
  async register(info) { const d = await api("/api/auth/register", { method: "POST", body: info }); state.user = d.user; await this.hydrate(); return d.user; },
  async login(info) { const d = await api("/api/auth/login", { method: "POST", body: info }); state.user = d.user; await this.hydrate(); return d.user; },
  async logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    state.user = null; state.workspaces = []; state.sessions = []; state.chats = {}; state.activeWorkspace = null; state.loaded = false;
    notify();
  },
  isAdmin() { return state.user?.role === "admin"; },

  // ---- selectors ----
  sessionsFor: (ws) => state.sessions.filter((s) => s.workspace === ws).sort((a, b) => b.date - a.date),
  session: (id) => state.sessions.find((s) => s.id === id),
  workspace: (id) => state.workspaces.find((w) => w.id === id),
  allActionItems: (ws) => state.sessions.filter((s) => !ws || s.workspace === ws)
    .flatMap((s) => (s.actionItems || []).map((a) => ({ ...a, sessionId: s.id, sessionTitle: s.title }))),
  audioUrl: (id) => `/api/sessions/${id}/audio`,

  // ---- prefs (local only) ----
  setSetting(key, val) { state.settings[key] = val; try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.settings)); } catch {} notify(); },
  setActiveWorkspace(id) { state.activeWorkspace = id; notify(); },

  // ---- workspaces ----
  async addWorkspace(name, emoji) {
    const d = await api("/api/workspaces", { method: "POST", body: { name, emoji } });
    state.workspaces.push(d.workspace); state.activeWorkspace = d.workspace.id; notify();
    return d.workspace.id;
  },
  async removeWorkspace(id) {
    await api(`/api/workspaces/${id}`, { method: "DELETE" });
    state.workspaces = state.workspaces.filter((w) => w.id !== id);
    state.sessions = state.sessions.filter((s) => s.workspace !== id);
    delete state.chats[id];
    if (state.activeWorkspace === id) state.activeWorkspace = state.workspaces[0]?.id || null;
    notify();
  },

  // ---- sessions ----
  applySession(sess) {
    const i = state.sessions.findIndex((s) => s.id === sess.id);
    if (i >= 0) state.sessions[i] = sess; else state.sessions.unshift(sess);
    notify(); return sess;
  },
  createSession(form) { return api("/api/sessions", { method: "POST", form }).then((d) => this.applySession(d.session)); },
  processSession(id, opts) { return api(`/api/sessions/${id}/process`, { method: "POST", body: opts }).then((d) => this.applySession(d.session)); },
  generateOutput(id, opts) { return api(`/api/sessions/${id}/outputs`, { method: "POST", body: opts }).then((d) => this.applySession(d.session)); },
  async removeSession(id) { state.sessions = state.sessions.filter((s) => s.id !== id); notify(); try { await api(`/api/sessions/${id}`, { method: "DELETE" }); } catch {} },
  async toggleFavorite(id) {
    const s = this.session(id); if (!s) return;
    s.favorite = !s.favorite; notify();
    try { await api(`/api/sessions/${id}`, { method: "PATCH", body: { favorite: s.favorite } }); } catch {}
  },
  updateSession(id, patch) {
    const s = this.session(id); if (s) Object.assign(s, patch); notify();
    return api(`/api/sessions/${id}`, { method: "PATCH", body: patch }).then((d) => this.applySession(d.session)).catch(() => {});
  },
  setActionItems(id, items) {
    const s = this.session(id); if (s) s.actionItems = items; notify();
    return api(`/api/sessions/${id}`, { method: "PATCH", body: { actionItems: items } }).catch(() => {});
  },
  addVersion(id, outputId, content) {
    const s = this.session(id); const out = s?.outputs.find((o) => o.id === outputId);
    if (!out) return Promise.resolve();
    out.versions.unshift({ id: uid(), created: Date.now(), content }); notify();
    return api(`/api/sessions/${id}`, { method: "PATCH", body: { outputs: s.outputs } }).catch(() => {});
  },

  // ---- chat (workspace memory) ----
  async askMemory(wsId, question) {
    (state.chats[wsId] ||= []).push({ role: "user", content: question, ts: Date.now() }); notify();
    const d = await api(`/api/workspaces/${wsId}/chat`, { method: "POST", body: { question } });
    state.chats[wsId].push({ role: "ai", content: d.content, cites: d.cites, ts: Date.now() }); notify();
    return d;
  },
  async clearChat(wsId) { state.chats[wsId] = []; notify(); try { await api(`/api/workspaces/${wsId}/chat`, { method: "DELETE" }); } catch {} },
};
