/* ============================================================
   store.js — application state, persisted to localStorage.
   Single source of truth. Everything flows through here.
   ============================================================ */

const KEY = "mirzakateb.v1";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const defaultSettings = {
  language: "en",
  theme: "light",
  provider: "demo",          // "demo" | "gemini"
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
  exportDefault: "md",
  recordingQuality: "standard",
};

function seed() {
  const now = Date.now();
  const day = 86400000;
  const wsPersonal = uid(), wsCompany = uid(), wsStartup = uid();

  const workspaces = [
    { id: wsPersonal, name: "Personal", emoji: "🌿", created: now - day * 40 },
    { id: wsCompany, name: "Company", emoji: "🏛", created: now - day * 30 },
    { id: wsStartup, name: "Startup", emoji: "✳", created: now - day * 20 },
  ];

  const sessions = [
    {
      id: uid(), workspace: wsCompany, title: "Q3 Marketing Sync",
      date: now - day * 3, duration: 1840, favorite: true, status: "ready",
      tags: ["marketing", "budget", "planning"],
      audioName: "q3-marketing-sync.m4a", audioUrl: null,
      transcript: "Sarah opened the meeting by reviewing Q3 goals. The team agreed to increase the paid-social budget to $18,000, up from $12,000 last quarter. Reza raised concerns about attribution tracking. It was decided that the new landing page would launch on the 15th. Mina will own the influencer outreach and report back by Friday. We also discussed pausing the print campaign as it under-performed.",
      prompt: "Meeting minutes with action items",
      outputs: [{
        id: uid(), type: "Meeting minutes", created: now - day * 3,
        versions: [{ id: uid(), created: now - day * 3, content:
`# Q3 Marketing Sync — Minutes

**Date:** 3 days ago · **Duration:** 30m 40s

## Decisions
- Increase paid-social budget to **$18,000** (from $12,000).
- New landing page launches on the **15th**.
- **Pause** the print campaign — under-performed last quarter.

## Discussion
- Reza flagged gaps in attribution tracking; to be revisited next sprint.
- Influencer outreach to be handled in-house.

> "Let's make the budget work harder, not just bigger." — Sarah`
        }]
      }],
      actionItems: [
        { id: uid(), task: "Own influencer outreach & report back", owner: "Mina", deadline: "Friday", priority: "high", status: "open" },
        { id: uid(), task: "Fix attribution tracking gaps", owner: "Reza", deadline: "", priority: "medium", status: "open" },
        { id: uid(), task: "Ship new landing page", owner: "", deadline: "15th", priority: "high", status: "in-progress" },
      ],
    },
    {
      id: uid(), workspace: wsCompany, title: "Design Review — Logo Direction",
      date: now - day * 9, duration: 1220, favorite: false, status: "ready",
      tags: ["design", "branding"],
      audioName: "logo-review.mp3", audioUrl: null,
      transcript: "The team reviewed three logo directions. Everyone preferred the serif mark. Leila will be responsible for the logo refinement and deliver final files next week. We agreed the color palette should stay warm and muted, avoiding bright tech colors.",
      prompt: "Summarize and extract decisions",
      outputs: [{
        id: uid(), type: "Summary", created: now - day * 9,
        versions: [{ id: uid(), created: now - day * 9, content:
`# Design Review — Summary

The team converged on the **serif logo mark** for its timeless feel. The palette stays **warm and muted**, deliberately avoiding bright tech colors.

**Owner:** Leila — final logo files due next week.` }]
      }],
      actionItems: [
        { id: uid(), task: "Refine logo & deliver final files", owner: "Leila", deadline: "next week", priority: "high", status: "open" },
      ],
    },
    {
      id: uid(), workspace: wsStartup, title: "Investor Update Prep",
      date: now - day * 1, duration: 940, favorite: false, status: "processing",
      tags: ["fundraising", "metrics"],
      audioName: "investor-prep.wav", audioUrl: null,
      transcript: "We walked through the metrics deck. MRR is up 22% month over month. Churn is our weak point at 4.1%. Amir will draft the investor email by Monday.",
      prompt: "Draft an investor update email",
      outputs: [],
      actionItems: [
        { id: uid(), task: "Draft investor update email", owner: "Amir", deadline: "Monday", priority: "high", status: "open" },
      ],
    },
    {
      id: uid(), workspace: wsPersonal, title: "Weekly Reflection",
      date: now - day * 6, duration: 480, favorite: true, status: "ready",
      tags: ["journal", "personal"],
      audioName: "reflection.m4a", audioUrl: null,
      transcript: "This week felt scattered but I made progress on the reading habit. I want to protect mornings for deep work and stop checking messages before 10am.",
      prompt: "Turn this into a short journal entry",
      outputs: [{
        id: uid(), type: "Custom prompt", created: now - day * 6,
        versions: [{ id: uid(), created: now - day * 6, content:
`# Weekly Reflection

A scattered week, but the reading habit is holding. The intention for next week is simple: **protect the mornings** for deep work, and don't touch messages before 10am.` }]
      }],
      actionItems: [
        { id: uid(), task: "No messages before 10am", owner: "", deadline: "", priority: "low", status: "open" },
      ],
    },
  ];

  const chats = {}; // workspaceId -> [{role, content, cites, ts}]

  return {
    user: null,
    workspaces,
    activeWorkspace: wsCompany,
    sessions,
    chats,
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
