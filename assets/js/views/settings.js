/* ============================================================
   settings.js — language, theme, AI provider, exports,
   recording quality, workspace management, profile.
   ============================================================ */

import { store } from "../store.js";
import { aiService } from "../ai.js";
import { el, icon, esc, toast, modal } from "../ui.js";
import { applyTheme, go } from "../app.js";

export function settingsView() {
  const s = store.get();
  const set = s.settings;

  const root = el(`<div>
    <div class="page-head"><div>
      <div class="eyebrow">Preferences</div>
      <h1>Settings</h1>
      <div class="sub">Signed in as ${esc(s.user?.name || "Guest")} · ${esc(s.user?.email || "")}</div>
    </div><button class="btn btn-ghost" id="logout">${icon("logout")} Sign out</button></div>

    <div class="banner mb">◆ MirzaKateb runs entirely in your browser on GitHub Pages. To use real AI, add your own Gemini API key below — it's stored locally and never leaves your device except to call Google directly.</div>

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
      <h3 class="mb">AI Provider</h3>
      <div class="setting-row">
        <div><div class="label">Provider</div><div class="desc">The service layer is abstracted — swap providers freely</div></div>
        <div class="control"><select id="provider">
          <option value="demo">Demo (offline, no key)</option>
          <option value="gemini">Google Gemini</option>
        </select></div>
      </div>
      <div id="geminiCfg" class="${set.provider === "gemini" ? "" : "hidden"}">
        <div class="field mt"><label>Gemini API key</label><input type="password" id="gkey" placeholder="AIza…" value="${esc(set.geminiKey)}" /></div>
        <div class="field"><label>Model</label><select id="gmodel">
          ${["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash"].map((m) => `<option ${set.geminiModel === m ? "selected" : ""}>${m}</option>`).join("")}
        </select></div>
        <p class="muted" style="font-size:.82rem">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Currently active: <strong>${esc(aiService.providerName())}</strong>.</p>
      </div>
    </div>

    <div class="card mt2" style="max-width:760px">
      <h3 class="mb">Workspaces</h3>
      <ul class="list-clean" id="wsMan"></ul>
      <button class="btn btn-sm mt" id="addWsBtn">${icon("plus")} New workspace</button>
    </div>

    <div class="card mt2" style="max-width:760px">
      <h3 class="mb">Data</h3>
      <p class="muted" style="font-size:.9rem">Everything is stored locally in this browser.</p>
      <div class="row wrap mt">
        <button class="btn btn-sm" id="exportData">${icon("download")} Export data (JSON)</button>
        <button class="btn btn-sm btn-danger" id="reset">${icon("trash")} Reset to demo data</button>
      </div>
    </div>
  </div>`);

  // general
  root.querySelector("#lang").value = set.language;
  root.querySelector("#quality").value = set.recordingQuality;
  root.querySelector("#exp").value = set.exportDefault;
  root.querySelector("#provider").value = set.provider;

  root.querySelector("#lang").onchange = (e) => { store.setSetting("language", e.target.value); toast("Language set (UI copy stays English in this demo)"); };
  root.querySelector("#quality").onchange = (e) => { store.setSetting("recordingQuality", e.target.value); toast("Saved"); };
  root.querySelector("#exp").onchange = (e) => { store.setSetting("exportDefault", e.target.value); toast("Saved"); };
  root.querySelector("#dark").onchange = (e) => { const t = e.target.checked ? "dark" : "light"; store.setSetting("theme", t); applyTheme(t); };

  const provider = root.querySelector("#provider");
  provider.onchange = (e) => {
    store.setSetting("provider", e.target.value);
    root.querySelector("#geminiCfg").classList.toggle("hidden", e.target.value !== "gemini");
    toast(`Provider: ${e.target.value === "gemini" ? "Gemini" : "Demo"}`);
  };
  root.querySelector("#gkey").oninput = (e) => store.setSetting("geminiKey", e.target.value.trim());
  root.querySelector("#gmodel").onchange = (e) => store.setSetting("geminiModel", e.target.value);

  // workspaces
  const wsMan = root.querySelector("#wsMan");
  s.workspaces.forEach((w) => {
    const li = el(`<li class="setting-row"><div class="label">${esc(w.emoji)} ${esc(w.name)} <span class="muted" style="font-weight:400">· ${store.sessionsFor(w.id).length} sessions</span></div>
      <button class="icon-btn" title="Delete workspace">${icon("trash")}</button></li>`);
    li.querySelector("button").onclick = () => {
      if (s.workspaces.length <= 1) return toast("Keep at least one workspace");
      modal({ title: `Delete “${w.name}”?`, body: `<p class="muted">Its sessions and memory will be removed.</p>`, confirmText: "Delete", danger: true,
        onConfirm: () => { store.removeWorkspace(w.id); toast("Workspace removed"); go("settings"); } });
    };
    wsMan.appendChild(li);
  });
  root.querySelector("#addWsBtn").onclick = () => import("../layout.js").then((m) => m.addWorkspaceModal());

  // data
  root.querySelector("#logout").onclick = () => { store.logout(); toast("Signed out"); go("login"); };
  root.querySelector("#exportData").onclick = () => {
    const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "mirzakateb-data.json"; a.click();
    toast("Data exported");
  };
  root.querySelector("#reset").onclick = () => modal({
    title: "Reset everything?", body: `<p class="muted">This restores the original demo workspaces and deletes your sessions.</p>`,
    confirmText: "Reset", danger: true, onConfirm: () => { store.reset(); toast("Reset complete"); go(""); },
  });

  return root;
}
