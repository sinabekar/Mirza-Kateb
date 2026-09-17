// ============================================================
// ai.js — server-side AI (OpenAI-compatible). Key stays here,
// never in the browser. Base URL is configurable so OpenAI,
// AvalAI, OpenRouter, Groq, or a local server all work.
// ============================================================
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileP = promisify(execFile);

const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const KEY = process.env.OPENAI_API_KEY || "";
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

// When the transcription model is a multimodal chat model (e.g. gemini-3.5-flash),
// audio is sent via chat/completions instead of the Whisper audio/transcriptions endpoint.
const TRANSCRIBE_VIA_CHAT = /^gemini/i.test(TRANSCRIBE_MODEL);

// Optional Google-native Gemini key (direct API — only works outside Iran).
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-2.0-flash-lite";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Speaker diarization: label each speaker turn [Speaker 1]: ... (default on for Gemini models)
const DIARIZE = process.env.DIARIZE !== "false";

export const aiConfigured = () => !!(KEY || GEMINI_KEY);

export const TASKS = [
  { key: "transcribe", label: "Convert to text" },
  { key: "summary",    label: "Summarize" },
  { key: "minutes",   label: "Meeting minutes" },
  { key: "custom",    label: "Custom prompt" },
];

class AIError extends Error {}

// ---- Retry with exponential backoff (for transient network/rate errors) ----
const RETRY_MAX = Number(process.env.MAX_RETRIES) || 3;
const isPermanentError = (e) => /40[013]|invalid|authentication|bad request/i.test(e.message || "");

async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i <= RETRY_MAX; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i === RETRY_MAX || isPermanentError(e)) throw e;
      const delay = Math.min(1000 * Math.pow(2, i) + Math.random() * 400, 16000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ---- accum: optional array to collect {in, out} token counts across a session ----
// Pass the same array through transcribeLong → runTask → extractActions to
// accumulate total tokens for a session, then store in the sessions table.

// ---- Chat completion ----
async function chat(system, user, { json = false, accum } = {}) {
  if (!KEY) throw new AIError("Server has no OPENAI_API_KEY configured.");
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: CHAT_MODEL, temperature: 0.3,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new AIError(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (accum && data?.usage) accum.push({ in: data.usage.prompt_tokens || 0, out: data.usage.completion_tokens || 0 });
  return (data?.choices?.[0]?.message?.content || "").trim();
}

// ---- Transcription prompt ----
function transcribePrompt(language) {
  const langHint = (language && language !== "auto")
    ? `زبان گوینده ${language} است. `
    : "این صدا ممکن است فارسی، انگلیسی، یا ترکیبی از هر دو باشه. ";

  const diarHint = (DIARIZE && TRANSCRIBE_VIA_CHAT)
    ? " اگر چند نفر صحبت می‌کنند، هر نوبت را با [Speaker 1]:، [Speaker 2]:، و ... برچسب بزن. اگر فقط یک نفر صحبت می‌کند، برچسب نزن."
    : "";

  return `${langHint}متن صدا را دقیقاً همان‌طور که گفته شده پیاده کن.${diarHint} فقط متن پیاده‌شده را بنویس — بدون عنوان، برچسب، یا توضیح اضافه. زبان اصلی را حفظ کن. اصطلاحات تخصصی، نام شرکت‌ها، و کلمات انگلیسی را عیناً بنویس. اگر بخشی واقعاً نامفهوم بود بنویس [نامفهوم].`;
}

// ---- Transcription via chat/completions multimodal (AvalAI Gemini models) ----
async function transcribeViaChat(filePath, mime, language = "auto", accum = null) {
  if (!KEY) throw new AIError("Server has no OPENAI_API_KEY configured.");
  const buf = await fs.promises.readFile(filePath);
  const b64 = buf.toString("base64");

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: TRANSCRIBE_MODEL,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: b64, format: "mp3" } },
          { type: "text", text: transcribePrompt(language) },
        ],
      }],
    }),
  });
  if (!res.ok) throw new AIError(`Transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (accum && data?.usage) accum.push({ in: data.usage.prompt_tokens || 0, out: data.usage.completion_tokens || 0 });
  return (data?.choices?.[0]?.message?.content || "").trim();
}

// ---- Gemini native audio transcription ----
async function transcribeGemini(filePath, mime, language = "auto", accum = null) {
  const buf = await fs.promises.readFile(filePath);
  const b64 = buf.toString("base64");
  const audioMime = mime?.includes("mp3") || mime?.includes("mpeg") ? "audio/mp3" : (mime || "audio/wav");

  const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_TRANSCRIBE_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType: audioMime, data: b64 } }, { text: transcribePrompt(language) }] }],
    }),
  });
  if (!res.ok) throw new AIError(`Gemini transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (accum && data?.usageMetadata) {
    accum.push({
      in: data.usageMetadata.promptTokenCount || 0,
      out: data.usageMetadata.candidatesTokenCount || 0,
    });
  }
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// ---- Transcription (multipart to /audio/transcriptions) ----
export async function transcribe(filePath, mime, language = "auto") {
  if (!KEY) throw new AIError("Server has no OPENAI_API_KEY configured. Set OPENAI_API_KEY or use GEMINI_API_KEY for transcription.");
  const buf = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime || "audio/wav" }), "audio" + extFor(mime));
  form.append("model", TRANSCRIBE_MODEL);
  if (language && language !== "auto") form.append("language", language);
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form,
  });
  if (!res.ok) throw new AIError(`Transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.text || "").trim();
}

/* ---- Long-audio transcription ----
   Routes audio through ffmpeg to clean 16 kHz mono MP3, splits long recordings
   into chunks, retries failed chunks with backoff, and accumulates token usage.
   Pass an accum array (same one used by runTask/extractActions) to track tokens. */
const CHUNK_SECONDS = Number(process.env.TRANSCRIBE_CHUNK_SECONDS) || 300;   // 5 min chunks
const DIRECT_MAX_SECONDS = Number(process.env.TRANSCRIBE_DIRECT_MAX) || 300;  // ≤5 min → single request
const MP3_ARGS = ["-ar", "16000", "-ac", "1", "-b:a", "48k"];

export async function transcribeLong(filePath, mime, language = "auto", accum = null) {
  if (!KEY && !GEMINI_KEY) throw new AIError("No API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY in .env.");

  const transcribeFn = TRANSCRIBE_VIA_CHAT
    ? (f, m, l) => transcribeViaChat(f, m, l, accum)
    : GEMINI_KEY
      ? (f, m, l) => transcribeGemini(f, m, l, accum)
      : (f, m, l) => transcribe(f, m, l);

  if (!(await ffmpegAvailable())) return transcribeFn(filePath, mime, language);

  const duration = await audioDuration(filePath);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mk-tx-"));
  try {
    if (!duration || duration <= DIRECT_MAX_SECONDS) {
      const mp3 = path.join(dir, "audio.mp3");
      await execFileP("ffmpeg", ["-y", "-i", filePath, ...MP3_ARGS, mp3], { maxBuffer: 1 << 26 });
      return withRetry(() => transcribeFn(mp3, "audio/mpeg", language));
    }
    await execFileP("ffmpeg", [
      "-y", "-i", filePath, ...MP3_ARGS,
      "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1",
      path.join(dir, "chunk-%03d.mp3"),
    ], { maxBuffer: 1 << 26 });
    const chunks = (await fs.promises.readdir(dir)).filter((f) => f.startsWith("chunk-")).sort();
    const parts = [];
    for (const f of chunks) {
      // Retry each chunk independently — a failure in chunk 27 doesn't restart chunks 1-26.
      const text = await withRetry(() => transcribeFn(path.join(dir, f), "audio/mpeg", language));
      if (text) parts.push(text.trim());
    }
    return parts.join("\n\n");
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Local Persian normalization (replaces the LLM-based cleanTranscript) ----
// Deterministic, zero-cost, and safe for speaker-labeled transcripts.
export function normalizeTranscript(text = "") {
  if (!text) return text;
  return text
    .replace(/ي/g, "ی") // Arabic ya (ي) → Persian ya (ی)
    .replace(/ك/g, "ک") // Arabic kaf (ك) → Persian kaf (ک)
    .replace(/[ \t]+/g, " ")      // collapse multiple spaces/tabs
    .replace(/\n{3,}/g, "\n\n")   // max one blank line between paragraphs
    .trim();
}

// ---- Task on a transcript ----
export async function runTask({ transcript, prompt, taskKey, accum }) {
  const key = taskKey || inferTask(prompt);
  if (key === "transcribe") return `# Transcript\n\n${transcript}`;
  const sys = `You are MirzaKateb, a calm, precise writing assistant. ${instruction(key, prompt)} Detect the language of the transcript and reply in the SAME language (Persian stays Persian). Respond in clean Markdown only — no preamble.`;
  return chat(sys, `--- TRANSCRIPT ---\n${transcript}`, { accum });
}

export async function extractActions(transcript, accum) {
  if (!transcript?.trim() || !KEY) return [];
  try {
    const raw = await chat(
      `Extract action items from the transcript. Reply with ONLY a JSON object, no prose, no code fences: {"items":[{"task","owner","deadline","priority":"high|medium|low","status":"open"}]}. Use "" for unknown fields. Keep text in the transcript's language.`,
      transcript,
      { accum });
    let txt = raw.replace(/```json|```/gi, "").trim();
    const m = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) txt = m[0];
    const parsed = JSON.parse(txt);
    const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    return items.map((a) => ({
      id: rid(), task: a.task || "", owner: a.owner || "", deadline: a.deadline || "",
      priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : "medium",
      status: a.status || "open",
    })).filter((a) => a.task);
  } catch { return []; }
}

export async function askMemory({ question, memory }) {
  if (!memory.length) return { content: "This workspace has no recordings yet. Add one, then ask again.", cites: [] };
  const context = memory.map((m) => `### ${m.title}\n${m.transcript || "(no transcript)"}`).join("\n\n");
  const content = await chat(
    "You are the memory of a workspace. Answer using ONLY the meeting notes below. Cite meeting titles inline. If the answer isn't present, say so plainly. Reply in the question's language.",
    `QUESTION: ${question}\n\n--- MEETINGS ---\n${context}`);
  return { content, cites: memory.map((m) => ({ id: m.id, title: m.title })) };
}

// ---- helpers ----
async function ffmpegAvailable() {
  try { await execFileP("ffmpeg", ["-version"]); return true; } catch { return false; }
}
async function audioDuration(filePath) {
  try {
    const { stdout } = await execFileP("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
function extFor(mime = "") {
  const t = mime.toLowerCase();
  if (t.includes("webm")) return ".webm";
  if (t.includes("mp4") || t.includes("m4a")) return ".m4a";
  if (t.includes("wav")) return ".wav";
  if (t.includes("ogg")) return ".ogg";
  if (t.includes("mpeg") || t.includes("mp3")) return ".mp3";
  return ".wav";
}
export function inferTask(prompt = "") {
  const p = prompt.toLowerCase();
  if (/summar|خلاصه/.test(p)) return "summary";
  if (/action|task|اقدام|کار/.test(p)) return "actions";
  if (/minute|صورت‌?جلسه/.test(p)) return "minutes";
  if (/blog|بلاگ|وبلاگ/.test(p)) return "blog";
  if (/linkedin|لینکدین/.test(p)) return "linkedin";
  if (/email|mail|ایمیل/.test(p)) return "email";
  if (/decision|تصمیم/.test(p)) return "decisions";
  if (/to-?do|todo|فهرست/.test(p)) return "todo";
  if (/transcri|to text|متن/.test(p)) return "transcribe";
  return "custom";
}
function instruction(key, prompt) {
  const map = {
    summary: "Write a concise, well-structured summary with a short heading.",
    actions: "Extract all action items with owners and deadlines as a checklist.",
    minutes: "Write formal meeting minutes: overview, key points, decisions, action items.",
    blog: "Rewrite this as an engaging blog post with a title and headings.",
    linkedin: "Write a thoughtful, human LinkedIn post based on this.",
    email: "Draft a clear follow-up email with a subject line.",
    decisions: "List every decision that was made, as bullet points.",
    todo: "Produce a checkbox to-do list.",
    custom: `Follow this instruction exactly: "${prompt}".`,
  };
  return map[key] || map.custom;
}
