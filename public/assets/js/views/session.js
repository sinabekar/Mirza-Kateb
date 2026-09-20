/* ============================================================
   session.js — a single session: audio, outputs (rich text,
   copy/download/edit/regenerate/version history), transcript,
   and editable action items.
   ============================================================ */

import { store } from "../store.js";

// Returns "rtl" if text contains significant Persian/Arabic content.
const textDir = (t = "") => /[؀-ۿ]{4,}/.test(t) ? "rtl" : "ltr";
import { aiService, TASKS } from "../ai.js";
import { renderWaveform, drawPlaceholderWave, fmtDuration } from "../audio.js";
import { el, icon, esc, md, relDate, copyText, exportDoc, toast, modal } from "../ui.js";
import { go } from "../app.js";

export function sessionView(id) {
  const se = store.session(id);
  if (!se) { const e = el(`<div class="empty"><div class="em-mark">م</div><h3>Session not found</h3><a class="btn mt" href="#/">Back to dashboard</a></div>`); return e; }

  const ws = store.workspace(se.workspace);
  let activeOutputId = se.outputs[0]?.id || null;
  let activeVersionIdx = 0;

  const root = el(`<div>
    <div class="page-head">
      <div style="min-width:0">
        <a class="btn btn-ghost btn-sm" href="#/" style="margin-bottom:.6rem">${icon("back")} ${esc(ws?.name || "Workspace")}</a>
        <div class="row" style="gap:.6rem">
          <span class="status-dot status-${se.status}"></span>
          <h1 id="sTitle" style="cursor:text" title="Click to rename">${esc(se.title)}</h1>
          <button class="fav ${se.favorite ? "on" : ""}" id="favBtn">${icon("star")}</button>
        </div>
        <div class="session-meta" style="margin-top:.4rem">
          <span>${icon("calendar")} ${relDate(se.date)}</span>
          <span>${icon("clock")} ${fmtDuration(se.duration)}</span>
          <span>${icon("doc")} “${esc(se.prompt)}”</span>
        </div>
      </div>
      <div class="row wrap">
        <button class="btn btn-sm" id="shareBtn">${icon("share")} Share</button>
        <button class="btn btn-ghost btn-danger btn-sm" id="delBtn">${icon("trash")} Delete</button>
      </div>
    </div>

    <div class="tags mb" id="tagRow"></div>

    <div class="card" style="padding:1.2rem 1.4rem;margin-bottom:1.4rem">
      <div class="row between wrap" style="margin-bottom:.6rem">
        <div class="eyebrow" style="color:var(--olive)">Original audio · ${esc(se.audioName || "recording")}</div>
        ${se.hasAudio ? `<button class="btn btn-sm" id="retranscribe">${icon("refresh")} Re-transcribe</button>` : ""}
      </div>
      <div class="wave-wrap" style="height:70px"><canvas class="wave-canvas" id="sessWave" style="height:70px"></canvas></div>
      ${se.hasAudio ? `<audio controls src="${store.audioUrl(se.id)}" style="width:100%;margin-top:.6rem"></audio>` : `<p class="muted" style="font-size:.82rem;margin:.4rem 0 0">No audio stored for this session.</p>`}
      <div id="retxStatus" class="mt" hidden></div>
    </div>

    <div class="tabs" id="tabs">
      <div class="tab active" data-t="outputs">Outputs</div>
      <div class="tab" data-t="actions">Action Items <span class="muted">(${se.actionItems.length})</span></div>
      <div class="tab" data-t="transcript">Transcript</div>
    </div>
    <div id="panel"></div>
  </div>`);

  // ---- header interactions ----
  root.querySelector("#favBtn").onclick = (e) => { store.toggleFavorite(id); e.currentTarget.classList.toggle("on"); };
  root.querySelector("#delBtn").onclick = () => modal({
    title: "Delete this session?", body: `<p class="muted">“${esc(se.title)}” and its outputs will be removed. This can't be undone.</p>`,
    confirmText: "Delete", danger: true, onConfirm: () => { store.removeSession(id); toast("Session deleted"); go(""); },
  });
  root.querySelector("#sTitle").onclick = () => renameTitle(id, root.querySelector("#sTitle"));
  root.querySelector("#shareBtn").onclick = () => openShareModal(id);

  // ---- re-transcribe the saved audio (re-runs server transcription) ----
  const retxBtn = root.querySelector("#retranscribe");
  if (retxBtn) retxBtn.onclick = () => {
    if (!aiService.isReady()) return toast("AI isn't configured on the server");
    modal({
      title: "Re-transcribe this recording?",
      body: `<p class="muted">This runs transcription again on the saved audio and adds a fresh “Convert to text” output. Useful if the first attempt came back empty.</p>`,
      confirmText: "Re-transcribe",
      onConfirm: (m) => {
        const status = root.querySelector("#retxStatus");
        status.hidden = false;
        status.innerHTML = `<div class="banner"><div class="spinner" style="width:20px;height:20px;margin:0 .5rem 0 0"></div> Transcribing the saved audio… long meetings are split into chunks, so this can take a while.</div>`;
        retxBtn.disabled = true;
        store.processSession(id, { taskKey: "transcribe", wantActions: true, language: "auto" })
          .then(() => { toast("Transcribed"); go("session/" + id); })
          .catch((e) => { status.innerHTML = `<div class="banner">⚠ ${esc(e.message)}</div>`; retxBtn.disabled = false; });
        // modal closes; progress shows in the page
      },
    });
  };

  renderTags();
  function renderTags() {
    const row = root.querySelector("#tagRow");
    row.innerHTML = se.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("") +
      `<span class="tag gold" id="addTag" style="cursor:pointer">${icon("plus", "ico")} tag</span>`;
    row.querySelector("#addTag").onclick = () => {
      const t = prompt("Add a tag");
      if (t && t.trim()) { store.updateSession(id, { tags: [...store.session(id).tags, t.trim().toLowerCase()] }); renderTags(); }
    };
  }

  // ---- waveform ----
  const canvas = root.querySelector("#sessWave");
  requestAnimationFrame(async () => {
    if (se.hasAudio) { try { await renderWaveform(canvas, store.audioUrl(se.id)); return; } catch {} }
    drawPlaceholderWave(canvas, se.title);
  });

  // ---- tabs ----
  const panel = root.querySelector("#panel");
  root.querySelectorAll("#tabs .tab").forEach((t) => t.onclick = () => {
    root.querySelectorAll("#tabs .tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    ({ outputs: renderOutputs, actions: renderActions, transcript: renderTranscript }[t.dataset.t])();
  });

  // ========== OUTPUTS ==========
  function renderOutputs() {
    const s2 = store.session(id);
    if (!s2.outputs.length) {
      panel.innerHTML = `<div class="empty"><div class="em-mark">❦</div><h3>No outputs yet</h3><p>Generate one from the transcript.</p></div>`;
      addGenerateBar();
      return;
    }
    if (!s2.outputs.find((o) => o.id === activeOutputId)) activeOutputId = s2.outputs[0].id;
    const out = s2.outputs.find((o) => o.id === activeOutputId);
    activeVersionIdx = Math.min(activeVersionIdx, out.versions.length - 1);
    const ver = out.versions[activeVersionIdx];

    panel.innerHTML = `
      <div class="row between wrap mb">
        <div class="chips" id="outTabs">
          ${s2.outputs.map((o) => `<button class="chip ${o.id === activeOutputId ? "active" : ""}" data-out="${o.id}">${esc(o.type)}</button>`).join("")}
          <button class="chip" id="newOutput" style="color:var(--gold)">${icon("plus", "ico")} New</button>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-sm" id="copyBtn">${icon("copy")} Copy</button>
        <button class="btn btn-sm" id="editBtn">${icon("edit")} Edit</button>
        <button class="btn btn-sm" id="regenBtn">${icon("refresh")} Regenerate</button>
        <div class="row" style="gap:.3rem;margin-left:auto">
          <select id="fmt" style="width:auto;padding:.4rem .6rem"><option value="md">Markdown</option><option value="txt">Text</option><option value="pdf">PDF</option><option value="docx">Word</option></select>
          <button class="btn btn-sm btn-primary" id="dlBtn">${icon("download")} Export</button>
        </div>
      </div>
      <div class="output-doc" id="doc" dir="${textDir(ver.content)}">${md(ver.content)}</div>
      ${out.versions.length > 1 ? `<div class="mt2"><div class="eyebrow">${icon("history", "ico")} Version history</div>
        <div class="version-list mt" id="versions">
          ${out.versions.map((v, i) => `<div class="version-item ${i === activeVersionIdx ? "current" : ""}" data-v="${i}">
            ${icon("clock")} <span>${i === 0 ? "Latest" : "Version " + (out.versions.length - i)}</span>
            <span class="muted" style="margin-left:auto">${relDate(v.created)}</span></div>`).join("")}
        </div></div>` : ""}`;

    panel.querySelectorAll("[data-out]").forEach((b) => b.onclick = () => { activeOutputId = b.dataset.out; activeVersionIdx = 0; renderOutputs(); });
    panel.querySelector("#newOutput").onclick = () => generateModal(id, renderOutputs);
    panel.querySelector("#copyBtn").onclick = () => copyText(ver.content);
    panel.querySelector("#editBtn").onclick = () => editOutput(id, out, ver, renderOutputs);
    panel.querySelector("#regenBtn").onclick = () => regenerate(id, out, renderOutputs);
    panel.querySelector("#dlBtn").onclick = () => exportDoc(out.type + " — " + s2.title, ver.content, panel.querySelector("#fmt").value);
    panel.querySelector("#fmt").value = store.get().settings.exportDefault;
    panel.querySelectorAll("[data-v]").forEach((v) => v.onclick = () => { activeVersionIdx = +v.dataset.v; renderOutputs(); });
  }

  function addGenerateBar() {
    const bar = el(`<div class="center mt"><button class="btn btn-primary" id="genFirst">${icon("send")} Generate an output</button></div>`);
    bar.querySelector("#genFirst").onclick = () => generateModal(id, renderOutputs);
    panel.appendChild(bar);
  }

  // ========== ACTION ITEMS ==========
  function renderActions() {
    const items = store.session(id).actionItems;
    panel.innerHTML = `
      <div class="row between wrap mb">
        <p class="muted" style="margin:0">Extracted automatically — edit any field.</p>
        <button class="btn btn-sm" id="addItem">${icon("plus")} Add item</button>
      </div>
      <div style="overflow-x:auto"><table class="ai-table"><thead><tr>
        <th style="width:34%">Task</th><th>Owner</th><th>Deadline</th><th>Priority</th><th>Status</th><th></th>
      </tr></thead><tbody id="aiBody"></tbody></table></div>`;
    const body = panel.querySelector("#aiBody");
    if (!items.length) body.innerHTML = `<tr><td colspan="6" class="muted center" style="padding:2rem">No action items. Add one or regenerate.</td></tr>`;

    const commit = () => store.setActionItems(id, items);
    items.forEach((it, idx) => {
      const tr = el(`<tr>
        <td><input value="${esc(it.task)}" data-k="task" dir="auto" /></td>
        <td><input value="${esc(it.owner || "")}" placeholder="—" data-k="owner" dir="auto" style="max-width:120px" /></td>
        <td><input value="${esc(it.deadline || "")}" placeholder="—" data-k="deadline" style="max-width:120px" /></td>
        <td><select data-k="priority">${["high", "medium", "low"].map((p) => `<option ${it.priority === p ? "selected" : ""}>${p}</option>`).join("")}</select></td>
        <td><select data-k="status">${["open", "in-progress", "done"].map((p) => `<option ${it.status === p ? "selected" : ""}>${p}</option>`).join("")}</select></td>
        <td><button class="icon-btn" title="Remove">${icon("trash")}</button></td>
      </tr>`);
      tr.querySelectorAll("[data-k]").forEach((inp) => inp.addEventListener("change", () => { items[idx][inp.dataset.k] = inp.value; commit(); }));
      tr.querySelector(".icon-btn").onclick = () => { items.splice(idx, 1); commit(); renderActions(); };
      body.appendChild(tr);
    });

    panel.querySelector("#addItem").onclick = () => { items.push({ id: store.uid(), task: "New task", owner: "", deadline: "", priority: "medium", status: "open" }); store.setActionItems(id, items); renderActions(); };
  }

  // ========== TRANSCRIPT ==========
  function renderTranscript() {
    const s2 = store.session(id);
    const tx = s2.transcript || "";
    const wordCount = tx.split(/\s+/).filter(Boolean).length;
    const isDiarized = /^\[Speaker \d+\]:/m.test(tx);
    panel.innerHTML = `<div class="toolbar">
      <button class="btn btn-sm" id="copyT">${icon("copy")} Copy transcript</button>
      ${isDiarized ? `<span class="pill low" style="font-size:.75rem">Speaker labels</span>` : ""}
      <span class="muted" style="font-size:.82rem;margin-left:auto">${wordCount} words</span>
    </div>
    <div class="output-doc" id="txBody" dir="${textDir(tx)}"></div>`;
    panel.querySelector("#copyT").onclick = () => copyText(tx);
    const txBody = panel.querySelector("#txBody");
    if (isDiarized) renderDiarizedTranscript(txBody, tx);
    else txBody.innerHTML = `<p style="white-space:pre-wrap;line-height:1.8">${esc(tx || "No transcript.")}</p>`;
  }

  function renderDiarizedTranscript(container, text) {
    const SPEAKER_COLORS = ["var(--olive)", "var(--gold)", "#7b6fa0", "#5b8c5a", "#8c5a5a"];
    const speakerMap = {};
    let colorIdx = 0;
    const lines = text.split("\n");
    let html = "";
    for (const line of lines) {
      const m = line.match(/^\[(.+?)\]:\s*(.*)/);
      if (m) {
        const speaker = m[1];
        if (!speakerMap[speaker]) speakerMap[speaker] = SPEAKER_COLORS[colorIdx++ % SPEAKER_COLORS.length];
        html += `<div class="speaker-turn"><span class="speaker-label" style="color:${speakerMap[speaker]}">${esc(speaker)}</span><span class="speaker-text" dir="auto">${esc(m[2])}</span></div>`;
      } else if (line.trim()) {
        html += `<p style="white-space:pre-wrap;margin:.2rem 0">${esc(line)}</p>`;
      }
    }
    container.innerHTML = html;
  }

  renderOutputs();
  return root;
}

/* ---------- shared actions ---------- */
function renameTitle(id, node) {
  const cur = store.session(id).title;
  const input = el(`<input type="text" value="${esc(cur)}" style="font-family:var(--display);font-size:2rem;font-weight:600" />`);
  node.replaceWith(input); input.focus(); input.select();
  const done = () => { const v = input.value.trim() || cur; store.updateSession(id, { title: v }); node.textContent = v; input.replaceWith(node); };
  input.addEventListener("blur", done);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}

function editOutput(id, out, ver, done) {
  modal({
    title: `Edit “${out.type}”`,
    body: `<p class="muted" style="margin-top:-.4rem">Saving creates a new version.</p>
      <textarea id="editArea" rows="14" style="font-family:var(--body)">${esc(ver.content)}</textarea>`,
    confirmText: "Save version",
    onConfirm: (root) => {
      const v = root.querySelector("#editArea").value;
      store.addVersion(id, out.id, v);
      toast("New version saved");
      done();
    },
  });
}

async function regenerate(id, out, done) {
  if (!aiService.isReady()) return toast("AI isn't configured on the server");
  const se = store.session(id);
  toast("Regenerating…");
  const taskKey = TASKS.find((t) => t.label === out.type)?.key || "custom";
  try {
    await store.generateOutput(id, { taskKey, prompt: se.prompt, outputId: out.id });
    toast("New version generated");
    done();
  } catch (e) { toast(e.message); }
}

async function openShareModal(id) {
  const se = store.session(id);

  // fetch existing share state
  let existingShare = null;
  try {
    const res = await store.api(`/api/sessions/${id}/share`);
    existingShare = res.share;
  } catch {}

  const inclTx   = existingShare ? existingShare.inclTx   : !!se.transcript;
  const inclOut  = existingShare ? existingShare.inclOut  : se.outputs.length > 0;
  const inclActs = existingShare ? existingShare.inclActs : se.actionItems.length > 0;

  modal({
    title: "Share this session",
    body: `
      <p class="muted" style="margin-top:-.4rem;margin-bottom:1rem">Choose what to include in the public link. Anyone with the link can view — no login required.</p>
      <div class="field" style="margin-bottom:.6rem">
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer">
          <input type="checkbox" id="sInclOut" ${inclOut && se.outputs.length ? "checked" : ""} ${se.outputs.length ? "" : "disabled"} />
          Output / Summary ${se.outputs.length === 0 ? '<span class="muted">(not generated yet)</span>' : ""}
        </label>
      </div>
      <div class="field" style="margin-bottom:.6rem">
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer">
          <input type="checkbox" id="sInclActs" ${inclActs && se.actionItems.length ? "checked" : ""} ${se.actionItems.length ? "" : "disabled"} />
          Action Items ${se.actionItems.length === 0 ? '<span class="muted">(none yet)</span>' : ""}
        </label>
      </div>
      <div class="field" style="margin-bottom:1rem">
        <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer">
          <input type="checkbox" id="sInclTx" ${inclTx && se.transcript ? "checked" : ""} ${se.transcript ? "" : "disabled"} />
          Transcript ${!se.transcript ? '<span class="muted">(not available)</span>' : ""}
        </label>
      </div>
      ${existingShare ? `<div id="sLinkBox" style="margin-top:.6rem">
        <div class="eyebrow" style="color:var(--olive);margin-bottom:.4rem">Current link</div>
        <div style="display:flex;gap:.5rem;align-items:center">
          <input id="sLinkInput" type="text" readonly value="${location.origin}/s/${existingShare.token}" style="flex:1;font-size:.82rem" onclick="this.select()" />
          <button class="btn btn-sm" id="sCopyBtn">Copy</button>
        </div>
        <button class="btn btn-ghost btn-danger btn-sm" id="sRevoke" style="margin-top:.6rem">Revoke link</button>
      </div>` : ""}`,
    confirmText: existingShare ? "Update link" : "Create link",
    onConfirm: async (root) => {
      const iOut   = root.querySelector("#sInclOut")?.checked  ?? false;
      const iActs  = root.querySelector("#sInclActs")?.checked ?? false;
      const iTx    = root.querySelector("#sInclTx")?.checked   ?? false;
      if (!iOut && !iActs && !iTx) { toast("Select at least one section to share"); return true; }

      const btn = root.querySelector("[data-ok]");
      btn.textContent = "Creating…"; btn.disabled = true;
      try {
        const { token } = await store.api(`/api/sessions/${id}/share`, {
          method: "POST", body: { inclTx: iTx, inclOut: iOut, inclActs: iActs },
        });
        const link = `${location.origin}/s/${token}`;
        root.querySelector("#sLinkBox")?.remove();

        // inject link box into modal body
        const linkBox = document.createElement("div");
        linkBox.style.marginTop = ".8rem";
        linkBox.innerHTML = `
          <div class="eyebrow" style="color:var(--olive);margin-bottom:.4rem">${existingShare ? "Updated link" : "Your share link"}</div>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input type="text" readonly value="${link}" style="flex:1;font-size:.82rem" onclick="this.select()" />
            <button class="btn btn-sm" id="newCopyBtn">Copy</button>
          </div>`;
        root.querySelector(".modal-body")?.appendChild(linkBox) || btn.parentElement.insertAdjacentElement("beforebegin", linkBox);
        linkBox.querySelector("#newCopyBtn").onclick = () => {
          navigator.clipboard.writeText(link).then(() => { linkBox.querySelector("#newCopyBtn").textContent = "Copied!"; });
        };
        btn.textContent = "Done"; btn.disabled = false;
        toast(existingShare ? "Link updated" : "Link created");
      } catch (e) { toast(e.message); btn.textContent = existingShare ? "Update link" : "Create link"; btn.disabled = false; }
      return true;
    },
  });

  // wire up existing copy/revoke buttons
  setTimeout(() => {
    document.querySelector("#sCopyBtn")?.addEventListener("click", () => {
      navigator.clipboard.writeText(document.querySelector("#sLinkInput").value)
        .then(() => { document.querySelector("#sCopyBtn").textContent = "Copied!"; });
    });
    document.querySelector("#sRevoke")?.addEventListener("click", async () => {
      if (!confirm("Revoke this link? Anyone with it won't be able to access the session anymore.")) return;
      try {
        await store.api(`/api/sessions/${id}/share`, { method: "DELETE" });
        toast("Link revoked");
        document.querySelector(".modal-backdrop")?.remove();
      } catch (e) { toast(e.message); }
    });
  }, 50);
}

function generateModal(id, done) {
  const se = store.session(id);
  if (!aiService.isReady()) return toast("AI isn't configured on the server");
  modal({
    title: "Generate a new output",
    body: `<p class="muted" style="margin-top:-.4rem">Choose a task or write a custom instruction.</p>
      <div class="chips" id="gChips" style="margin-bottom:1rem">
        ${TASKS.map((t) => `<button class="chip" data-task="${t.key}">${t.icon} ${esc(t.label)}</button>`).join("")}
      </div>
      <textarea id="gPrompt" rows="2" placeholder="Custom instruction (optional)…"></textarea>`,
    confirmText: "Generate",
    onConfirm: (root) => {
      const active = root.querySelector(".chip.active");
      const custom = root.querySelector("#gPrompt").value.trim();
      const taskKey = active?.dataset.task || (custom ? "custom" : null);
      if (!taskKey) return true;
      const ok = root.querySelector("[data-ok]"); ok.textContent = "Generating…"; ok.disabled = true;
      store.generateOutput(id, { taskKey, prompt: custom || se.prompt })
        .then(() => { toast("Output added"); root.remove(); done(); })
        .catch((e) => { toast(e.message); ok.textContent = "Generate"; ok.disabled = false; });
      return true; // keep modal open until the request resolves
    },
  });
  document.querySelectorAll("#gChips .chip").forEach((c) => c.onclick = () => {
    document.querySelectorAll("#gChips .chip").forEach((x) => x.classList.remove("active")); c.classList.add("active");
  });
}
