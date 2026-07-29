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

    <div class="banner mb">◆ MirzaKateb runs entirely in your browser on GitHub Pages. AI is powered by your own Gemini API key — add it below to transcribe and process your recordings. The key is stored locally and only ever calls Google directly.</div>

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
        <div><div class="label">Provider</div><div class="desc">The service layer is abstracted — pick one, the rest of the app doesn't change</div></div>
        <div class="control"><select id="provider">
          <option value="gemini">Google Gemini</option>
          <option value="openai">OpenAI · GPT-4o mini</option>
        </select></div>
      </div>

      <div id="geminiCfg" class="${set.provider === "openai" ? "hidden" : ""}">
        <div class="field mt"><label>Gemini API key</label><input type="password" id="gkey" placeholder="AIza…" value="${esc(set.geminiKey)}" /></div>
        <div class="field"><label>Model</label><select id="gmodel">
          ${["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.0-flash", "gemini-pro-latest"].map((m) => `<option ${set.geminiModel === m ? "selected" : ""}>${m}</option>`).join("")}
        </select></div>
        <p class="muted" style="font-size:.82rem">Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> — use a classic <code>AIzaSy…</code> key (not an <code>AQ.</code> one).</p>
      </div>

      <div id="openaiCfg" class="${set.provider === "openai" ? "" : "hidden"}">
        <div class="field mt"><label>OpenAI API key</label><input type="password" id="okey" placeholder="sk-…" value="${esc(set.openaiKey)}" /></div>
        <div class="field"><label>Text model</label><select id="omodel">
          ${["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"].map((m) => `<option ${set.openaiModel === m ? "selected" : ""}>${m}</option>`).join("")}
        </select></div>
        <div class="field"><label>Transcription model</label><select id="otmodel">
          ${["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"].map((m) => `<option ${set.openaiTranscribeModel === m ? "selected" : ""}>${m}</option>`).join("")}
        </select></div>
        <p class="muted" style="font-size:.82rem">Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>. Whisper transcribes the audio; GPT-4o mini writes the output. Needs OpenAI billing credit.</p>
      </div>

      <p class="muted mt" style="font-size:.82rem">Status: <strong>${aiService.isReady() ? "✅ connected (" + esc(aiService.providerName()) + ")" : "⚠ no key yet"}</strong>. Keys are stored only in this browser and call the provider directly.</p>
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
        <button class="btn btn-sm btn-danger" id="reset">${icon("trash")} Erase all data</button>
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

  root.querySelector("#provider").onchange = (e) => {
    store.setSetting("provider", e.target.value);
    root.querySelector("#geminiCfg").classList.toggle("hidden", e.target.value === "openai");
    root.querySelector("#openaiCfg").classList.toggle("hidden", e.target.value !== "openai");
  };
  root.querySelector("#gkey").oninput = (e) => store.setSetting("geminiKey", e.target.value.trim());
  root.querySelector("#gmodel").onchange = (e) => store.setSetting("geminiModel", e.target.value);
  root.querySelector("#okey").oninput = (e) => store.setSetting("openaiKey", e.target.value.trim());
  root.querySelector("#omodel").onchange = (e) => store.setSetting("openaiModel", e.target.value);
  root.querySelector("#otmodel").onchange = (e) => store.setSetting("openaiTranscribeModel", e.target.value);
  root.querySelector("#gkey").onchange = () => go("settings");
  root.querySelector("#okey").onchange = () => go("settings"); // refresh status line

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
    title: "Erase all data?", body: `<p class="muted">This deletes every workspace, session and setting, and starts fresh with one empty workspace. It can't be undone.</p>`,
    confirmText: "Erase everything", danger: true, onConfirm: () => { store.reset(); toast("Reset complete"); go(""); },
  });

  return root;
}
