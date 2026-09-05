/* ============================================================
   settings.js — preferences (local), account, workspaces.
   AI keys now live on the server (.env), not in the browser.
   ============================================================ */

import { store } from "../store.js";
import { aiService } from "../ai.js";
import { el, icon, esc, toast, modal, relDate } from "../ui.js";
import { applyTheme, go } from "../app.js";

export function settingsView() {
  const s = store.get();
  const set = s.settings;
  const u = s.user || {};

  const root = el(`<div>
    <div class="page-head"><div>
      <div class="eyebrow">Preferences</div>
      <h1>Settings</h1>
      <div class="sub">Signed in as ${esc(u.name || "")} · ${esc(u.email || "")}</div>
    </div><button class="btn btn-ghost" id="logout">${icon("logout")} Sign out</button></div>

    <div class="banner mb">${aiService.isReady()
      ? "◆ AI is configured on the server. Transcription & writing run securely server-side — no keys in your browser."
      : "⚠ AI isn't configured on the server yet. Recordings are still saved; an administrator must set the API key in the server .env."}</div>

    <div class="card" style="max-width:760px">
      <h3 class="mb">General</h3>
      <div class="setting-row">
        <div><div class="label">Language</div><div class="desc">Interface language</div></div>
        <div class="control"><select id="lang">
          <option value="en">English</option><option value="fa">فارسی (Persian)</option>
          <option value="ar">العربية</option><option value="fr">Français</option><option value="de">Deutsch</option>
        </select></div>
      </div>
      <div class="setting-row">
        <div><div class="label">Dark mode</div><div class="desc">Warm paper by day, soft ink by night</div></div>
        <div class="control" style="min-width:auto"><label class="switch"><input type="checkbox" id="dark" ${set.theme === "dark" ? "checked" : ""}><span class="slider-tr"></span></label></div>
      </div>
      <div class="setting-row">
        <div><div class="label">Recording quality</div><div class="desc">Higher quality uses more space</div></div>
        <div class="control"><select id="quality">
          <option value="standard">Standard (mono)</option><option value="high">High (stereo)</option><option value="voice">Voice-optimised</option>
        </select></div>
      </div>
      <div class="setting-row">
        <div><div class="label">Default export format</div><div class="desc">Used by the Export button</div></div>
        <div class="control"><select id="exp">
          <option value="md">Markdown</option><option value="txt">Plain text</option><option value="pdf">PDF</option><option value="docx">Word (.doc)</option>
        </select></div>
      </div>
    </div>

    <div class="card mt2" style="max-width:760px">
      <h3 class="mb">Account</h3>
      <div class="setting-row"><div><div class="label">Name</div><div class="desc">${esc(u.name || "")}</div></div></div>
      <div class="setting-row"><div><div class="label">Email</div><div class="desc">${esc(u.email || "")}</div></div></div>
      <div class="setting-row"><div><div class="label">Member since</div><div class="desc">${u.createdAt ? relDate(u.createdAt) : "—"}</div></div></div>
      ${store.isAdmin() ? `<div class="setting-row"><div><div class="label">Role</div><div class="desc">Administrator</div></div><div class="control" style="min-width:auto"><a class="btn btn-sm" href="#/admin">${icon("gear")} Admin panel</a></div></div>` : ""}
    </div>

    <div class="card mt2" style="max-width:760px">
      <h3 class="mb">Workspaces</h3>
      <ul class="list-clean" id="wsMan"></ul>
      <button class="btn btn-sm mt" id="addWsBtn">${icon("plus")} New workspace</button>
    </div>

    <div class="card mt2" style="max-width:760px">
      <h3 class="mb">Data</h3>
      <p class="muted" style="font-size:.9rem">Your recordings, transcripts and outputs are stored on the server against your account.</p>
      <div class="row wrap mt">
        <button class="btn btn-sm" id="exportData">${icon("download")} Export my data (JSON)</button>
      </div>
    </div>
  </div>`);

  root.querySelector("#lang").value = set.language;
  root.querySelector("#quality").value = set.recordingQuality;
  root.querySelector("#exp").value = set.exportDefault;

  root.querySelector("#lang").onchange = (e) => { store.setSetting("language", e.target.value); toast("Saved"); };
  root.querySelector("#quality").onchange = (e) => { store.setSetting("recordingQuality", e.target.value); toast("Saved"); };
  root.querySelector("#exp").onchange = (e) => { store.setSetting("exportDefault", e.target.value); toast("Saved"); };
  root.querySelector("#dark").onchange = (e) => { const t = e.target.checked ? "dark" : "light"; store.setSetting("theme", t); applyTheme(t); };

  // workspaces
  const wsMan = root.querySelector("#wsMan");
  s.workspaces.forEach((w) => {
    const li = el(`<li class="setting-row"><div class="label">${esc(w.emoji)} ${esc(w.name)} <span class="muted" style="font-weight:400">· ${store.sessionsFor(w.id).length} sessions</span></div>
      <button class="icon-btn" title="Delete workspace">${icon("trash")}</button></li>`);
    li.querySelector("button").onclick = () => {
      if (s.workspaces.length <= 1) return toast("Keep at least one workspace");
      modal({ title: `Delete “${w.name}”?`, body: `<p class="muted">Its sessions, audio and memory will be permanently removed.</p>`, confirmText: "Delete", danger: true,
        onConfirm: () => { store.removeWorkspace(w.id).then(() => { toast("Workspace removed"); go("settings"); }).catch((e) => toast(e.message)); } });
    };
    wsMan.appendChild(li);
  });
  root.querySelector("#addWsBtn").onclick = () => import("../layout.js").then((m) => m.addWorkspaceModal());

  root.querySelector("#logout").onclick = () => store.logout().then(() => { toast("Signed out"); go("login"); });
  root.querySelector("#exportData").onclick = () => {
    const data = { user: s.user, workspaces: s.workspaces, sessions: s.sessions, chats: s.chats };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "mirzakateb-data.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Data exported");
  };

  return root;
}
