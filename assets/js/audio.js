/* ============================================================
   audio.js — recording (record/pause/resume/stop) + waveform.
   Uses MediaRecorder + Web Audio. Works entirely client-side.
   ============================================================ */

export class Recorder {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.state = "idle"; // idle | recording | paused | stopped
    this.startedAt = 0;
    this.elapsedBeforePause = 0;
    this.analyser = null;
    this.audioCtx = null;
    this.onTick = null;
    this._raf = null;
  }

  get seconds() {
    if (this.state === "recording") return this.elapsedBeforePause + (Date.now() - this.startedAt) / 1000;
    return this.elapsedBeforePause;
  }

  async start(canvas) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // pick a supported mime type
    const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    this.mediaRecorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.mediaRecorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.mediaRecorder.start(250);
    this.state = "recording";
    this.startedAt = Date.now();
    this.elapsedBeforePause = 0;

    // live waveform
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    if (canvas) this._drawLive(canvas);
  }

  pause() {
    if (this.state !== "recording") return;
    this.mediaRecorder.pause();
    this.elapsedBeforePause = this.seconds;
    this.state = "paused";
  }
  resume() {
    if (this.state !== "paused") return;
    this.mediaRecorder.resume();
    this.startedAt = Date.now();
    this.state = "recording";
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) return resolve(null);
      this.elapsedBeforePause = this.seconds;
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || "audio/webm" });
        this._cleanup();
        this.state = "stopped";
        resolve({ blob, url: URL.createObjectURL(blob), duration: Math.round(this.elapsedBeforePause) });
      };
      this.mediaRecorder.stop();
    });
  }

  cancel() { this._cleanup(); this.state = "idle"; }

  _cleanup() {
    cancelAnimationFrame(this._raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.analyser = null;
  }

  _drawLive(canvas) {
    const ctx = canvas.getContext("2d");
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    const draw = () => {
      this._raf = requestAnimationFrame(draw);
      const { width, height } = fitCanvas(canvas);
      this.analyser.getByteTimeDomainData(buf);
      ctx.clearRect(0, 0, width, height);
      const bars = 64, step = Math.floor(buf.length / bars), mid = height / 2;
      ctx.fillStyle = css("--olive");
      for (let i = 0; i < bars; i++) {
        const v = (Math.abs(buf[i * step] - 128) / 128);
        const h = Math.max(2, v * height * 0.9);
        const x = (i / bars) * width;
        ctx.beginPath();
        roundRect(ctx, x + 2, mid - h / 2, Math.max(2, width / bars - 4), h, 2);
        ctx.fill();
      }
    };
    draw();
  }
}

/* ---- Static waveform from a decoded audio file/blob ---- */
export async function renderWaveform(canvas, arrayBufferOrUrl) {
  const ctx = canvas.getContext("2d");
  const { width, height } = fitCanvas(canvas);
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    let ab;
    if (typeof arrayBufferOrUrl === "string") {
      ab = await (await fetch(arrayBufferOrUrl)).arrayBuffer();
    } else { ab = arrayBufferOrUrl; }
    const audio = await ac.decodeAudioData(ab.slice(0));
    const data = audio.getChannelData(0);
    const bars = Math.floor(width / 5);
    const block = Math.floor(data.length / bars);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = css("--olive");
    const mid = height / 2;
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < block; j++) sum += Math.abs(data[i * block + j] || 0);
      const amp = (sum / block) * 3.2;
      const h = Math.max(2, Math.min(1, amp) * height * 0.92);
      roundRect(ctx, i * 5 + 1, mid - h / 2, 3, h, 1.5);
      ctx.fill();
    }
    ac.close();
  } catch {
    drawPlaceholderWave(canvas);
  }
}

/* ---- Decorative static waveform when no real audio exists ---- */
export function drawPlaceholderWave(canvas, seedTitle = "") {
  const ctx = canvas.getContext("2d");
  const { width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = css("--olive");
  const mid = height / 2;
  let seed = 0; for (const c of seedTitle) seed += c.charCodeAt(0);
  const bars = Math.floor(width / 5);
  for (let i = 0; i < bars; i++) {
    const n = Math.abs(Math.sin(i * 0.5 + seed) * 0.6 + Math.sin(i * 0.13 + seed) * 0.4);
    const h = Math.max(2, n * height * 0.85);
    roundRect(ctx, i * 5 + 1, mid - h / 2, 3, h, 1.5);
    ctx.fill();
  }
}

/* ---- helpers ---- */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 600, height = rect.height || 120;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.getContext("2d").scale(dpr, dpr);
  }
  return { width, height };
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#556052"; }

export const fmtDuration = (secs) => {
  secs = Math.round(secs || 0);
  const m = Math.floor(secs / 60), s = secs % 60;
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return `${m}m ${s.toString().padStart(2, "0")}s`;
};
export const fmtClock = (secs) => {
  secs = Math.floor(secs || 0);
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};
