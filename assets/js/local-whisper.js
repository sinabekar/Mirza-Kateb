/* ============================================================
   local-whisper.js — speech-to-text INSIDE the browser.
   Runs OpenAI Whisper via Transformers.js (WebAssembly/WebGPU).
   No API key, no server — the audio never leaves the device.
   The model is downloaded once from the CDN, then cached.
   Persian (fa) and English are both supported.
   ============================================================ */

const CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
const LANG = { fa: "persian", en: "english" };

let _pipe = null;
let _pipeModel = null;
let _loading = null;

// Lazily import the library and build (or reuse) the ASR pipeline.
async function ensurePipeline(model, onProgress) {
  if (_pipe && _pipeModel === model) return _pipe;
  if (_loading) return _loading;

  _loading = (async () => {
    const { pipeline, env } = await import(/* @vite-ignore */ CDN);
    env.allowLocalModels = false;   // fetch weights from the HF hub
    env.useBrowserCache = true;     // cache them in the browser
    const pipe = await pipeline("automatic-speech-recognition", model, {
      quantized: true,
      progress_callback: (p) => { if (p.status === "progress" && onProgress) onProgress(p); },
    });
    _pipe = pipe; _pipeModel = model; _loading = null;
    return pipe;
  })();
  return _loading;
}

/**
 * Transcribe a Blob/File entirely on-device.
 * @param {Blob} blob
 * @param {{model?:string, language?:string, onStage?:(s:string)=>void, onProgress?:(p:object)=>void}} opts
 * @returns {Promise<string>}
 */
export async function transcribeLocally(blob, { model = "Xenova/whisper-base", language = "auto", onStage, onProgress } = {}) {
  onStage?.("loading");
  const pipe = await ensurePipeline(model, onProgress);

  onStage?.("decoding");
  const audio = await decodeToMono16k(blob);

  onStage?.("transcribing");
  const opts = { chunk_length_s: 30, stride_length_s: 5, task: "transcribe", return_timestamps: false };
  if (language && language !== "auto") opts.language = LANG[language] || language;

  const out = await pipe(audio, opts);
  return (out?.text || "").trim();
}

export function isModelLoaded(model) { return _pipe && _pipeModel === model; }

// Decode any browser-playable audio to a 16 kHz mono Float32Array (what Whisper wants).
async function decodeToMono16k(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let decoded;
  try { decoded = await ac.decodeAudioData(buf.slice(0)); }
  finally { ac.close(); }

  const length = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, length, 16000); // mono, 16 kHz
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
