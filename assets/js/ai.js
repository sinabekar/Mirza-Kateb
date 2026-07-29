/* ============================================================
   ai.js — AI service layer (real).
   The app talks ONLY to `aiService`. Providers implement the
   same contract, so swapping/adding a backend never touches
   the UI. Ships with a real Google Gemini provider that
   transcribes and processes the *actual* audio.
   ============================================================ */

import { store } from "./store.js";

/* ---- Task catalogue (shown as prompt suggestions) ---- */
export const TASKS = [
  { key: "transcribe", label: "Convert to text", icon: "✍" },
  { key: "summary", label: "Summarize", icon: "❦" },
  { key: "actions", label: "Extract action items", icon: "◎" },
  { key: "minutes", label: "Meeting minutes", icon: "❧" },
  { key: "blog", label: "Convert to blog", icon: "◈" },
  { key: "linkedin", label: "LinkedIn post", icon: "◆" },
  { key: "email", label: "Generate email", icon: "✉" },
  { key: "decisions", label: "Extract decisions", icon: "⚖" },
  { key: "todo", label: "Generate to-do list", icon: "☑" },
  { key: "custom", label: "Custom prompt", icon: "✳" },
];

/* ---- Provider contract ----
   transcribe(audioBlob)                       -> string (verbatim transcript)
   run({ transcript, prompt, taskKey })        -> { content }
   chat({ question, memory })                   -> { content, cites }
   extractActions(transcript)                   -> [{task,owner,deadline,priority,status}]
------------------------------------------------------------- */

/* =========================================================
   GeminiProvider — real AI via the user's own API key.
   Called directly from the browser (Pages has no server).
   ========================================================= */
const GEMINI_ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

function GeminiProvider(key, model) {
  async function call(parts) {
    const res = await fetch(GEMINI_ENDPOINT(model, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json())?.error?.message || detail; } catch {}
      throw new Error(`Gemini ${res.status}: ${String(detail).slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("");
    if (!text) throw new Error("Gemini returned an empty response (the audio may be unsupported or blocked).");
    return text.trim();
  }

  return {
    name: "Gemini",

    async transcribe(audioBlob) {
      const b64 = await blobToBase64(audioBlob);
      return call([
        { text: "Transcribe this audio recording verbatim. Include speaker turns if you can distinguish them. Return ONLY the transcript text, no preamble." },
        { inlineData: { mimeType: geminiMime(audioBlob.type), data: b64 } },
      ]);
    },

    async run({ transcript, prompt, taskKey }) {
      if (taskKey === "transcribe") return { content: `# Transcript\n\n${transcript}` };
      const instruction = taskInstruction(taskKey, prompt);
      const content = await call([{
        text: `You are MirzaKateb, a calm, precise writing assistant. ${instruction}\n\nRespond in clean Markdown only — no preamble.\n\n--- TRANSCRIPT ---\n${transcript}`,
      }]);
      return { content };
    },

    async chat({ question, memory }) {
      if (!memory.length) return { content: "This workspace has no recordings yet. Add one, then ask again.", cites: [] };
      const context = memory.map((m) => `### ${m.title}\n${m.transcript || "(no transcript)"}`).join("\n\n");
      const content = await call([{
        text: `You are the memory of a workspace. Answer the question using ONLY the meeting notes below. Cite the meeting titles you drew from, inline. If the answer isn't present, say so plainly.\n\nQUESTION: ${question}\n\n--- MEETINGS ---\n${context}`,
      }]);
      return { content, cites: memory.map((m) => ({ id: m.id, title: m.title })) };
    },

    async extractActions(transcript) {
      if (!transcript?.trim()) return [];
      try {
        const raw = await call([{
          text: `Extract action items from the transcript as a JSON array. Each item: {"task","owner","deadline","priority":"high|medium|low","status":"open"}. Use "" when a field is unknown. Return ONLY the JSON array.\n\n${transcript}`,
        }]);
        const json = JSON.parse(raw.replace(/```json|```/g, "").trim());
        return (Array.isArray(json) ? json : []).map((a) => ({
          id: store.uid(), task: a.task || "", owner: a.owner || "", deadline: a.deadline || "",
          priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : "medium",
          status: a.status || "open",
        })).filter((a) => a.task);
      } catch {
        return [];
      }
    },
  };
}

/* =========================================================
   OpenAIProvider — real AI via the user's OpenAI key.
   Transcription uses Whisper (handles webm/mp3/wav/m4a);
   text tasks use a chat model (default gpt-4o-mini).
   ========================================================= */
function OpenAIProvider(key, model, transcribeModel, baseUrl) {
  const base = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  async function chatCall(system, user) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(await openaiError(res));
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("OpenAI returned an empty response.");
    return text;
  }

  return {
    name: "GPT-4o mini",

    async transcribe(audioBlob) {
      const fd = new FormData();
      fd.append("file", audioBlob, "recording." + extFor(audioBlob.type));
      fd.append("model", transcribeModel || "whisper-1");
      const res = await fetch(`${base}/audio/transcriptions`, {
        method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd,
      });
      if (!res.ok) throw new Error(await openaiError(res));
      const data = await res.json();
      return (data.text || "").trim();
    },

    async run({ transcript, prompt, taskKey }) {
      if (taskKey === "transcribe") return { content: `# Transcript\n\n${transcript}` };
      const content = await chatCall(
        `You are MirzaKateb, a calm, precise writing assistant. ${taskInstruction(taskKey, prompt)} Respond in clean Markdown only — no preamble.`,
        `--- TRANSCRIPT ---\n${transcript}`,
      );
      return { content };
    },

    async chat({ question, memory }) {
      if (!memory.length) return { content: "This workspace has no recordings yet. Add one, then ask again.", cites: [] };
      const context = memory.map((m) => `### ${m.title}\n${m.transcript || "(no transcript)"}`).join("\n\n");
      const content = await chatCall(
        "You are the memory of a workspace. Answer using ONLY the meeting notes provided. Cite meeting titles inline. If the answer isn't present, say so plainly.",
        `QUESTION: ${question}\n\n--- MEETINGS ---\n${context}`,
      );
      return { content, cites: memory.map((m) => ({ id: m.id, title: m.title })) };
    },

    async extractActions(transcript) {
      if (!transcript?.trim()) return [];
      try {
        const raw = await chatCall(
          "Extract action items as a JSON array only. Each: {\"task\",\"owner\",\"deadline\",\"priority\":\"high|medium|low\",\"status\":\"open\"}. Use \"\" for unknown fields.",
          transcript,
        );
        const json = JSON.parse(raw.replace(/```json|```/g, "").trim());
        return (Array.isArray(json) ? json : []).map((a) => ({
          id: store.uid(), task: a.task || "", owner: a.owner || "", deadline: a.deadline || "",
          priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : "medium",
          status: a.status || "open",
        })).filter((a) => a.task);
      } catch { return []; }
    },
  };
}
async function openaiError(res) {
  let detail = res.statusText;
  try { detail = (await res.json())?.error?.message || detail; } catch {}
  return `OpenAI ${res.status}: ${String(detail).slice(0, 200)}`;
}
function extFor(type = "") {
  const t = type.toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  if (t.includes("wav")) return "wav";
  if (t.includes("ogg")) return "ogg";
  return "mp3";
}

/* ---- helpers ---- */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
// Map browser MIME types to ones Gemini accepts.
function geminiMime(type = "") {
  const t = type.toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "audio/mp3";
  if (t.includes("wav")) return "audio/wav";
  if (t.includes("ogg") || t.includes("opus")) return "audio/ogg";
  if (t.includes("aac")) return "audio/aac";
  if (t.includes("flac")) return "audio/flac";
  if (t.includes("mp4") || t.includes("m4a")) return "audio/mp4";
  if (t.includes("webm")) return "audio/webm";
  return "audio/mp3";
}

function inferTask(prompt = "") {
  const p = prompt.toLowerCase();
  if (/summar/.test(p)) return "summary";
  if (/action|task/.test(p)) return "actions";
  if (/minute/.test(p)) return "minutes";
  if (/blog/.test(p)) return "blog";
  if (/linkedin/.test(p)) return "linkedin";
  if (/email|mail/.test(p)) return "email";
  if (/decision/.test(p)) return "decisions";
  if (/to-?do|todo/.test(p)) return "todo";
  if (/transcri|to text/.test(p)) return "transcribe";
  return "custom";
}
function taskInstruction(key, prompt) {
  const map = {
    transcribe: "Clean up and format the transcript.",
    summary: "Write a concise, well-structured summary with a short heading.",
    actions: "Extract all action items with owners and deadlines as a checklist.",
    minutes: "Write formal meeting minutes: overview, key points, decisions, action items.",
    blog: "Rewrite this as an engaging blog post with a title and headings.",
    linkedin: "Write a thoughtful, human LinkedIn post based on this. No hashtag spam.",
    email: "Draft a clear follow-up email with a subject line.",
    decisions: "List every decision that was made, as bullet points.",
    todo: "Produce a checkbox to-do list.",
    custom: `Follow this instruction exactly: "${prompt}".`,
  };
  return map[key] || map.custom;
}

/* =========================================================
   Facade — the ONLY thing the app imports.
   ========================================================= */
export const aiService = {
  provider() {
    const s = store.get().settings;
    const gemini = () => s.geminiKey ? GeminiProvider(s.geminiKey, s.geminiModel || "gemini-flash-latest") : null;
    const openai = () => s.openaiKey ? OpenAIProvider(s.openaiKey, s.openaiModel || "gpt-4o-mini", s.openaiTranscribeModel || "whisper-1", s.openaiBaseUrl) : null;
    // Honour the chosen provider, then fall back to whichever key exists.
    if (s.provider === "openai") return openai() || gemini();
    return gemini() || openai();
  },
  isReady() { return !!this.provider(); },
  providerName() { return this.provider()?.name || "Not configured"; },
  _need() { const p = this.provider(); if (!p) throw new Error("No AI provider configured — add your Gemini API key in Settings."); return p; },
  transcribe(blob) { return this._need().transcribe(blob); },
  run(args) { return this._need().run(args); },
  chat(args) { return this._need().chat(args); },
  extractActions(t) { return this._need().extractActions(t); },
  inferTask,
};
