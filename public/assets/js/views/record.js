/* ============================================================
   record.js — capture step: record OR upload audio, show a
   waveform, then ask "what would you like me to do?" and run AI.
   ============================================================ */

import { store } from "../store.js";
import { aiService, TASKS } from "../ai.js";
import { Recorder, renderWaveform, drawPlaceholderWave, fmtClock } from "../audio.js";
import { el, icon, esc, toast } from "../ui.js";
import { go } from "../app.js";

const ACCEPT = ".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4,audio/webm";

export function recordView() {
  const captured = { blob: null, url: null, name: "", duration: 0 };
  let recorder = null;

  const root = el(`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">New Session</div>
        <h1>Capture a recording</h1>
        <div class="sub">Record live or upload a file — then tell MirzaKateb what to make of it.</div>
      </div>
      <a class="btn btn-ghost" href="#/">${icon("back")} Cancel</a>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;gap:1.4rem" id="captureRow">
      <div class="recorder" id="recPane">
        <div class="eyebrow" style="color:var(--olive)">Record</div>
        <div class="rec-timer" id="timer" style="margin:.6rem 0"><span class="rec-dot" id="recDot" style="opacity:0"></span>00:00</div>
        <div class="wave-wrap"><canvas class="wave-canvas" id="liveWave"></canvas></div>
        <div class="rec-controls" id="recControls">
          <button class="btn btn-primary" id="startBtn">${icon("mic")} Start recording</button>
        </div>
        <p class="muted" style="font-size:.82rem;margin-top:1rem">Your microphone stays in the browser. Nothing is uploaded.</p>
      </div>

      <div class="dropzone" id="drop">
        <div style="font-size:2rem;color:var(--olive)">${icon("upload", "ico")}</div>
        <h3 style="margin:.6rem 0 .3rem">Upload audio</h3>
        <p class="muted" style="font-size:.9rem">Drag &amp; drop, or click to choose.<br>MP3 · WAV · M4A</p>
        <input type="file" id="fileInput" accept="${ACCEPT}" hidden />
      </div>
    </div>

    <div id="captured" class="hidden mt2"></div>
    <div id="promptStep" class="hidden mt2"></div>
  </div>`);

  const timer = root.querySelector("#timer");
  const recDot = root.querySelector("#recDot");
  const liveWave = root.querySelector("#liveWave");
  const controls = root.querySelector("#recControls");
  let tick;

  function setTimer() { timer.innerHTML = `<span class="rec-dot ${recorder?.state === "recording" ? "live" : ""}" style="opacity:${recorder ? 1 : 0}"></span>${fmtClock(recorder?.seconds || 0)}`; }

  root.querySelector("#startBtn").onclick = async () => {
    recorder = new Recorder();
    try { await recorder.start(liveWave); }
    catch { toast("Microphone permission denied"); recorder = null; return; }
    tick = setInterval(setTimer, 200);
    controls.innerHTML = `
      <button class="icon-btn" id="pauseBtn" title="Pause" style="border:1px solid var(--line-strong)">${icon("pause")}</button>
      <button class="btn btn-gold" id="stopBtn">${icon("stop")} Stop</button>`;
    controls.querySelector("#pauseBtn").onclick = togglePause;
    controls.querySelector("#stopBtn").onclick = stopRec;
  };

  function togglePause(e) {
    if (recorder.state === "recording") { recorder.pause(); e.currentTarget.innerHTML = icon("play"); e.currentTarget.title = "Resume"; }
    else { recorder.resume(); e.currentTarget.innerHTML = icon("pause"); e.currentTarget.title = "Pause"; }
    setTimer();
  }

  async function stopRec() {
    clearInterval(tick);
    const res = await recorder.stop();
    recorder = null;
    if (!res) return;
    captured.blob = res.blob; captured.url = res.url; captured.duration = res.duration;
    captured.name = `recording-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.webm`;
    showCaptured();
  }

  // ---- Upload ----
  const drop = root.querySelector("#drop");
  const fileInput = root.querySelector("#fileInput");
  drop.onclick = () => fileInput.click();
  fileInput.onchange = () => fileInput.files[0] && handleFile(fileInput.files[0]);
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]));

  async function handleFile(file) {
    if (!/\.(mp3|wav|m4a)$/i.test(file.name) && !file.type.startsWith("audio")) { toast("Please choose an MP3, WAV or M4A file"); return; }
    captured.blob = file; captured.url = URL.createObjectURL(file); captured.name = file.name;
    // best-effort duration
    try {
      const a = new Audio(captured.url);
      await new Promise((r) => { a.onloadedmetadata = r; a.onerror = r; setTimeout(r, 1500); });
      captured.duration = Math.round(a.duration) || 0;
    } catch { captured.duration = 0; }
    showCaptured();
  }

  // ---- Captured preview + waveform ----
  const capturedBox = root.querySelector("#captured");
  async function showCaptured() {
    root.querySelector("#captureRow").classList.add("hidden");
    capturedBox.classList.remove("hidden");
    capturedBox.innerHTML = `<div class="recorder" style="text-align:left">
      <div class="row between wrap">
        <div><div class="eyebrow" style="color:var(--olive)">Captured</div>
        <h3 style="margin-top:.2rem">${esc(captured.name)}</h3>
        <div class="muted" style="font-size:.85rem">${fmtClock(captured.duration)} · ready to process</div></div>
        <button class="btn btn-ghost btn-sm" id="redo">${icon("refresh")} Redo</button>
      </div>
      <div class="wave-wrap"><canvas class="wave-canvas" id="staticWave"></canvas></div>
      <audio controls src="${captured.url}" style="width:100%"></audio>
    </div>`;
    capturedBox.querySelector("#redo").onclick = () => go("new");
    const canvas = capturedBox.querySelector("#staticWave");
    try {
      const buf = await captured.blob.arrayBuffer();
      await renderWaveform(canvas, buf);
    } catch { drawPlaceholderWave(canvas, captured.name); }
    showPrompt();
  }

  // ---- Prompt step ----
  const promptStep = root.querySelector("#promptStep");
  function showPrompt() {
    promptStep.classList.remove("hidden");
    promptStep.innerHTML = `
      <div class="eyebrow" style="color:var(--gold)">Instruct the scribe</div>
      <h2 style="margin:.3rem 0 1rem">What would you like me to do with this recording?</h2>
      ${aiService.isReady() ? "" : `<div class="banner mb">⚠ AI isn't configured on the server yet. Your recording will still be saved — an administrator needs to set the API key.</div>`}
      <div class="chips" id="taskChips">
        ${TASKS.map((t) => `<button class="chip" data-task="${t.key}" data-label="${esc(t.label)}">${t.icon} ${esc(t.label)}</button>`).join("")}
      </div>
      <div class="field mt"><textarea id="promptText" rows="3" placeholder="Or write any custom instruction… e.g. “Summarise for my team and list who owns what.”"></textarea></div>
      <div class="row between wrap">
        <label class="row" style="gap:.5rem;font-size:.9rem;color:var(--text-soft)">
          <input type="checkbox" id="autoActions" checked style="width:auto" /> Also extract action items
        </label>
        <button class="btn btn-primary" id="runBtn" disabled>${icon("send")} Transcribe &amp; generate</button>
      </div>
      <div id="processing" class="hidden center mt2"></div>`;

    let taskKey = null;
    const promptText = promptStep.querySelector("#promptText");
    const runBtn = promptStep.querySelector("#runBtn");
    const refresh = () => runBtn.disabled = !(taskKey || promptText.value.trim());

    promptStep.querySelectorAll("[data-task]").forEach((c) => c.onclick = () => {
      promptStep.querySelectorAll("[data-task]").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      taskKey = c.dataset.task;
      if (taskKey !== "custom" && !promptText.value.trim()) promptText.placeholder = c.dataset.label + "…";
      refresh();
    });
    promptText.addEventListener("input", refresh);

    runBtn.onclick = () => runAI(taskKey, promptText.value.trim(), promptStep.querySelector("#autoActions").checked);
  }

  async function runAI(taskKey, prompt, wantActions) {
    const proc = promptStep.querySelector("#processing");
    const runBtn = promptStep.querySelector("#runBtn");
    if (!captured.blob) { toast("Record or upload audio first"); return; }
    runBtn.disabled = true;
    proc.classList.remove("hidden");
    const label = TASKS.find((t) => t.key === taskKey)?.label || "Custom prompt";
    const setStep = (msg, sub = "") => proc.innerHTML = `<div class="spinner"></div><p class="muted">${esc(msg)}</p>${sub ? `<p class="muted" style="font-size:.8rem">${esc(sub)}</p>` : ""}`;

    try {
      // 1) Upload the audio FIRST — it's saved on the server before any processing.
      setStep("Uploading your recording…", "Your audio is saved before transcription, so nothing is lost.");
      const form = new FormData();
      form.append("workspace", store.get().activeWorkspace);
      form.append("title", captured.name.replace(/\.[a-z0-9]+$/i, "") || "New recording");
      form.append("duration", String(captured.duration || 0));
      form.append("prompt", prompt || label);
      form.append("audio", captured.blob, captured.name);
      const created = await store.createSession(form);

      // If the server has no AI key, keep the saved audio and open the session.
      if (!aiService.isReady()) {
        toast("Saved. AI isn't configured on the server yet.");
        return go("session/" + created.id);
      }

      // 2) Transcribe + generate on the server.
      setStep("Transcribing & writing…", "This happens securely on the server.");
      const key = taskKey || "custom";
      await store.processSession(created.id, { taskKey: key, prompt, wantActions, language: "auto" });
      toast("Session created");
      go("session/" + created.id);
    } catch (err) {
      proc.innerHTML = `<div class="banner" style="text-align:left">⚠ ${esc(err.message)}<br>
        <span class="muted">Your audio was saved — open the session from the dashboard and use Regenerate to retry.</span></div>`;
      runBtn.disabled = false;
    }
  }

  return root;
}

/* ---- helpers ---- */
function deriveTitle(content, fallback) {
  const h = content.match(/^#\s+(.+)/m);
  if (h) return h[1].replace(/[—–-].*$/, "").trim().slice(0, 60);
  return fallback.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " ").slice(0, 50) || "Untitled session";
}
