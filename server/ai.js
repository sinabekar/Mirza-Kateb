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

export const aiConfigured = () => !!(KEY || GEMINI_KEY);

export const TASKS = [
  { key: "transcribe", label: "Convert to text" },
  { key: "summary", label: "Summarize" },
  { key: "minutes", label: "Meeting minutes" },
  { key: "custom", label: "Custom prompt" },
];

class AIError extends Error {}

async function chat(system, user, { json = false } = {}) {
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
  return (data?.choices?.[0]?.message?.content || "").trim();
}

// ---- Transcription via chat/completions multimodal (AvalAI Gemini models) ----
// Used when OPENAI_TRANSCRIBE_MODEL starts with "gemini" — AvalAI routes these
// through their OpenAI-compatible chat endpoint with base64 audio content.
async function transcribeViaChat(filePath, mime, language = "auto") {
  if (!KEY) throw new AIError("Server has no OPENAI_API_KEY configured.");
  const buf = await fs.promises.readFile(filePath);
  const b64 = buf.toString("base64");

  const langHint = (language && language !== "auto")
    ? `The speaker is using ${language}. `
    : "The audio may be in Persian/Farsi, English, or a mix. ";

  const prompt = `${langHint}Transcribe the audio exactly as spoken. Output only the transcription text with no headings, labels, or commentary. Preserve the original language faithfully.`;

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
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new AIError(`Transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || "").trim();
}

// ---- Gemini native audio transcription ----
// Gemini understands audio as a multimodal LLM — far better than ASR-only Whisper
// for Persian, mixed-language, low-quality audio, and noisy environments.
async function transcribeGemini(filePath, mime, language = "auto") {
  const buf = await fs.promises.readFile(filePath);
  const b64 = buf.toString("base64");
  const audioMime = mime?.includes("mp3") || mime?.includes("mpeg") ? "audio/mp3" : (mime || "audio/wav");

  const langHint = (language && language !== "auto")
    ? `The speaker is using ${language}. `
    : "The audio may be in Persian/Farsi, English, or a mix. ";

  const prompt = `${langHint}Transcribe the audio exactly as spoken. Output only the transcription text with no headings, labels, or commentary. Preserve the original language faithfully.`;

  const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_TRANSCRIBE_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType: audioMime, data: b64 } }, { text: prompt }] }],
    }),
  });
  if (!res.ok) throw new AIError(`Gemini transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
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
   Routes audio through ffmpeg (when present) to clean 16 kHz mono WAV, which
   Whisper always accepts, and splits long recordings into chunks so meetings
   of any length work. Falls back to a single direct request if ffmpeg is
   missing or the clip is short. */
// Compressed mono MP3 keeps each request small (~6 KB/s → a 5-min chunk ≈ 1.8 MB),
// well under gateway upload limits, while staying great for speech recognition.
const CHUNK_SECONDS = Number(process.env.TRANSCRIBE_CHUNK_SECONDS) || 300;      // 5 min chunks
const DIRECT_MAX_SECONDS = Number(process.env.TRANSCRIBE_DIRECT_MAX) || 300;    // ≤5 min → single request
const MP3_ARGS = ["-ar", "16000", "-ac", "1", "-b:a", "48k"];

export async function transcribeLong(filePath, mime, language = "auto") {
  if (!KEY && !GEMINI_KEY) throw new AIError("No API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY in .env.");

  // Priority: AvalAI Gemini (chat multimodal) → Google Gemini (direct) → Whisper
  const transcribeFn = TRANSCRIBE_VIA_CHAT
    ? transcribeViaChat
    : GEMINI_KEY ? transcribeGemini : transcribe;

  if (!(await ffmpegAvailable())) return transcribeFn(filePath, mime, language); // no ffmpeg → best effort

  const duration = await audioDuration(filePath);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mk-tx-"));
  try {
    if (!duration || duration <= DIRECT_MAX_SECONDS) {
      // Short: transcode to a small, clean MP3 (also fixes odd webm/opus).
      const mp3 = path.join(dir, "audio.mp3");
      await execFileP("ffmpeg", ["-y", "-i", filePath, ...MP3_ARGS, mp3], { maxBuffer: 1 << 26 });
      return transcribeFn(mp3, "audio/mpeg", language);
    }
    // Long: split into small MP3 chunks and transcribe sequentially.
    await execFileP("ffmpeg", [
      "-y", "-i", filePath, ...MP3_ARGS,
      "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1",
      path.join(dir, "chunk-%03d.mp3"),
    ], { maxBuffer: 1 << 26 });
    const chunks = (await fs.promises.readdir(dir)).filter((f) => f.startsWith("chunk-")).sort();
    const parts = [];
    for (const f of chunks) {
      const text = await transcribeFn(path.join(dir, f), "audio/mpeg", language);
      if (text) parts.push(text.trim());
    }
    return parts.join("\n\n");
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ffmpegAvailable() {
  try { await execFileP("ffmpeg", ["-version"]); return true; } catch { return false; }
}
async function audioDuration(filePath) {
  try {
    const { stdout } = await execFileP("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

// ---- Post-transcription cleanup ----
// Fixes ASR errors and makes text more readable without changing meaning or language.
export async function cleanTranscript(raw) {
  if (!KEY || !raw?.trim()) return raw;
  try {
    return await chat(
      `You are a transcript corrector. Fix transcription errors, garbled words, run-on sentences, and punctuation in the text below. Rules:
- Do NOT change meaning, facts, names, or language (Persian stays Persian, English stays English).
- Do NOT add, remove, or summarize content.
- Fix only obvious ASR mistakes (wrong words, missing spaces, bad punctuation).
- Return only the corrected transcript text, nothing else.`,
      raw
    );
  } catch { return raw; } // if AI fails, return original
}

// ---- Task on a transcript ----
export async function runTask({ transcript, prompt, taskKey }) {
  const key = taskKey || inferTask(prompt);
  if (key === "transcribe") return `# Transcript\n\n${transcript}`;
  const sys = `You are MirzaKateb, a calm, precise writing assistant. ${instruction(key, prompt)} Detect the language of the transcript and reply in the SAME language (Persian stays Persian). Respond in clean Markdown only — no preamble.`;
  return chat(sys, `--- TRANSCRIPT ---\n${transcript}`);
}

export async function extractActions(transcript) {
  if (!transcript?.trim() || !KEY) return [];
  try {
    // Provider-agnostic: don't rely on OpenAI json-mode (Claude etc. may lack it);
    // ask for JSON only and parse it out of the reply.
    const raw = await chat(
      `Extract action items from the transcript. Reply with ONLY a JSON object, no prose, no code fences: {"items":[{"task","owner","deadline","priority":"high|medium|low","status":"open"}]}. Use "" for unknown fields. Keep text in the transcript's language.`,
      transcript);
    let txt = raw.replace(/```json|```/gi, "").trim();
    const m = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/);        // first JSON object/array
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
