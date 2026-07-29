/* ============================================================
   store.js — application state, persisted to localStorage.
   Single source of truth. Everything flows through here.
   ============================================================ */

const KEY = "mirzakateb.v2";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const defaultSettings = {
  language: "en",
  theme: "light",
  provider: "gemini",        // "gemini" | "openai" — abstracted so more can slot in
  geminiKey: "",
  geminiModel: "gemini-flash-latest",
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  openaiTranscribeModel: "whisper-1",
  openaiBaseUrl: "https://api.openai.com/v1", // any OpenAI-compatible gateway (AvalAI, OpenRouter, Groq…)
  exportDefault: "md",
  recordingQuality: "standard",
};

function seed() {
  // Clean start — a single empty workspace, no sample content.
  const wsPersonal = uid();
  return {
    user: null,
    workspaces: [{ id: wsPersonal, name: "Personal", emoji: "🌿", created: Date.now() }],
    activeWorkspace: wsPersonal,
    sessions: [],
    chats: {}, // workspaceId -> [{ role, content, cites, ts }]
    settings: { ...defaultSettings },
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.settings = { ...defaultSettings, ...(parsed.settings || {}) };
      return parsed;
    }
  } catch (e) { console.warn("load failed", e); }
  return seed();
}

function persist() {
  try {
    // Do not persist blob URLs (they don't survive reload); keep metadata only.
    localStorage.setItem(KEY, JSON.stringify(state, (k, v) => (k === "audioUrl" && typeof v === "string" && v.startsWith("blob:")) ? null : v));
  } catch (e) { console.warn("persist failed", e); }
}

const subs = new Set();
function notify() { subs.forEach((fn) => fn(state)); }

export const store = {
  get: () => state,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  update(mutator) { mutator(state); persist(); notify(); },
  reset() { localStorage.removeItem(KEY); state = seed(); persist(); notify(); },
  uid,

  // -- selectors --
  sessionsFor(wsId) { return state.sessions.filter((s) => s.workspace === wsId).sort((a, b) => b.date - a.date); },
  session(id) { return state.sessions.find((s) => s.id === id); },
  workspace(id) { return state.workspaces.find((w) => w.id === id); },
  allActionItems(wsId) {
    return state.sessions
      .filter((s) => !wsId || s.workspace === wsId)
      .flatMap((s) => (s.actionItems || []).map((a) => ({ ...a, sessionId: s.id, sessionTitle: s.title })));
  },

  // -- mutations --
  login(user) { this.update((s) => { s.user = user; }); },
  logout() { this.update((s) => { s.user = null; }); },
  setSetting(key, val) { this.update((s) => { s.settings[key] = val; }); },
  setActiveWorkspace(id) { this.update((s) => { s.activeWorkspace = id; }); },

  addWorkspace(name, emoji) {
    const id = uid();
    this.update((s) => { s.workspaces.push({ id, name, emoji: emoji || "◇", created: Date.now() }); s.activeWorkspace = id; });
    return id;
  },
  removeWorkspace(id) {
    this.update((s) => {
      s.workspaces = s.workspaces.filter((w) => w.id !== id);
      s.sessions = s.sessions.filter((se) => se.workspace !== id);
      delete s.chats[id];
      if (s.activeWorkspace === id) s.activeWorkspace = s.workspaces[0]?.id || null;
    });
  },

  addSession(session) {
    const full = {
      id: uid(), date: Date.now(), favorite: false, status: "draft",
      tags: [], outputs: [], actionItems: [], transcript: "", prompt: "",
      duration: 0, audioName: "", audioUrl: null, ...session,
    };
    this.update((s) => s.sessions.unshift(full));
    return full.id;
  },
  updateSession(id, patch) { this.update((s) => { const se = s.sessions.find((x) => x.id === id); if (se) Object.assign(se, patch); }); },
  removeSession(id) { this.update((s) => { s.sessions = s.sessions.filter((x) => x.id !== id); }); },
  toggleFavorite(id) { this.update((s) => { const se = s.sessions.find((x) => x.id === id); if (se) se.favorite = !se.favorite; }); },

  addOutput(sessionId, type, content) {
    const outId = uid();
    this.update((s) => {
      const se = s.sessions.find((x) => x.id === sessionId);
      if (!se) return;
      se.outputs.unshift({ id: outId, type, created: Date.now(), versions: [{ id: uid(), created: Date.now(), content }] });
      se.status = "ready";
    });
    return outId;
  },
  addVersion(sessionId, outputId, content) {
    this.update((s) => {
      const se = s.sessions.find((x) => x.id === sessionId);
      const out = se?.outputs.find((o) => o.id === outputId);
      if (out) out.versions.unshift({ id: uid(), created: Date.now(), content });
    });
  },
  setActionItems(sessionId, items) { this.update((s) => { const se = s.sessions.find((x) => x.id === sessionId); if (se) se.actionItems = items; }); },

  pushChat(wsId, msg) { this.update((s) => { (s.chats[wsId] ||= []).push({ ...msg, ts: Date.now() }); }); },
  clearChat(wsId) { this.update((s) => { s.chats[wsId] = []; }); },
};
