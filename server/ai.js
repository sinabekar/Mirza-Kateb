// ============================================================
// ai.js — server-side AI (OpenAI-compatible). Key stays here,
// never in the browser. Base URL is configurable so OpenAI,
// AvalAI, OpenRouter, Groq, or a local server all work.
// ============================================================
import fs from "fs";

const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const KEY = process.env.OPENAI_API_KEY || "";
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

export const aiConfigured = () => !!KEY;

export const TASKS = [
  { key: "transcribe", label: "Convert to text" },
  { key: "summary", label: "Summarize" },
  { key: "actions", label: "Extract action items" },
  { key: "minutes", label: "Meeting minutes" },
  { key: "blog", label: "Convert to blog" },
  { key: "linkedin", label: "LinkedIn post" },
  { key: "email", label: "Generate email" },
  { key: "decisions", label: "Extract decisions" },
  { key: "todo", label: "Generate to-do list" },
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

// ---- Transcription (multipart to /audio/transcriptions) ----
export async function transcribe(filePath, mime, language = "auto") {
  if (!KEY) throw new AIError("Server has no OPENAI_API_KEY configured.");
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
    const raw = await chat(
      `Extract action items from the transcript. Return a JSON object: {"items":[{"task","owner","deadline","priority":"high|medium|low","status":"open"}]}. Use "" for unknown fields. Reply in the transcript's language.`,
      transcript, { json: true });
    const items = JSON.parse(raw).items || [];
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
