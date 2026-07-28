/* ============================================================
   ai.js — AI service layer.
   The rest of the app talks ONLY to `aiService`. Providers
   (Demo, Gemini, or a future one) implement the same contract,
   so swapping backends never touches the UI.
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
   run({ transcript, prompt, taskKey, audio }) -> { content }
   chat({ question, memory }) -> { content, cites }
   extractActions(transcript) -> [{task,owner,deadline,priority,status}]
------------------------------------------------------------- */

/* =========================================================
   DemoProvider — deterministic, offline, no API key.
   Produces plausible structured writing from the transcript.
   ========================================================= */
const sentences = (t) => (t || "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) || [t].filter(Boolean);
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function guessActions(transcript) {
  const out = [];
  const sents = sentences(transcript);
  const owners = /\b([A-Z][a-z]+)\b(?=[^.!?]*\b(will|to|should|is responsible|owns|to own|draft|report|deliver|handle|fix|ship|prepare|send)\b)/;
  const deadlineRe = /\b(by |on |before )?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|next week|end of \w+|the \d+(st|nd|rd|th)|Friday|Monday)\b/i;
  sents.forEach((s) => {
    if (/\b(will|should|need to|to own|responsible|draft|deliver|report|ship|fix|prepare|send|launch|handle)\b/i.test(s)) {
      const owner = (s.match(owners) || [])[1] || "";
      const deadline = (s.match(deadlineRe) || [])[0]?.replace(/^(by |on |before )/i, "").trim() || "";
      const priority = /\b(urgent|asap|critical|must|important)\b/i.test(s) ? "high" : /\b(maybe|consider|eventually)\b/i.test(s) ? "low" : "medium";
      out.push({ id: store.uid(), task: titleCase(s.trim().replace(/\.$/, "").slice(0, 90)), owner, deadline, priority, status: "open" });
    }
  });
  if (!out.length) out.push({ id: store.uid(), task: "Review the recording and define next steps", owner: "", deadline: "", priority: "medium", status: "open" });
  return out.slice(0, 6);
}

const DemoProvider = {
  name: "Demo (offline)",
  async run({ transcript, prompt, taskKey }) {
    await wait(700 + Math.random() * 500);
    const sents = sentences(transcript);
    const first = sents[0]?.trim() || "the recording";
    const bullets = sents.slice(0, 5).map((s) => `- ${s.trim()}`).join("\n");
    const key = taskKey || inferTask(prompt);

    switch (key) {
      case "transcribe":
        return { content: `# Transcript\n\n${transcript || "_No speech detected._"}` };
      case "summary":
        return { content: `# Summary\n\n${first} The conversation covered the following threads:\n\n${bullets}\n\n**In short:** the discussion moved toward clear next steps and shared ownership.` };
      case "minutes":
        return { content: `# Meeting Minutes\n\n## Overview\n${first}\n\n## Key Points\n${bullets}\n\n## Decisions\n${decisionLines(transcript) || "- (none explicitly recorded)"}\n\n## Action Items\n${actionLines(transcript)}` };
      case "actions":
        return { content: `# Action Items\n\n${actionLines(transcript)}` };
      case "decisions":
        return { content: `# Decisions\n\n${decisionLines(transcript) || "- No firm decisions were captured in this recording."}` };
      case "blog":
        return { content: `# ${titleCase(first.split(" ").slice(0, 6).join(" "))}\n\n${first} In this piece we unpack what came up and why it matters.\n\n## What happened\n${sents.slice(0, 3).map((s) => s.trim()).join(" ")}\n\n## Why it matters\n${sents.slice(3, 6).map((s) => s.trim()).join(" ") || "The throughline is a bias toward clarity and ownership."}\n\n## Takeaway\nSmall, deliberate decisions compound. That was the theme here.` };
      case "linkedin":
        return { content: `${first}\n\nA few reflections from a recent conversation:\n\n${sents.slice(0, 3).map((s, i) => `${["→","→","→"][i]} ${s.trim()}`).join("\n")}\n\nThe lesson? Clarity beats volume — every time.\n\n#work #reflection #leadership` };
      case "email":
        return { content: `**Subject:** Follow-up & next steps\n\nHi team,\n\nThanks for the discussion. A quick recap:\n\n${bullets}\n\n**Next steps**\n${actionLines(transcript)}\n\nBest,\nMirza` };
      case "todo":
        return { content: `# To-Do\n\n${guessActions(transcript).map((a) => `- [ ] ${a.task}${a.owner ? ` _(@${a.owner})_` : ""}${a.deadline ? ` — ${a.deadline}` : ""}`).join("\n")}` };
      default: // custom
        return { content: `# ${prompt ? titleCase(prompt.slice(0, 48)) : "Response"}\n\nBased on your instruction — _"${prompt}"_ — here is a draft grounded in the recording:\n\n${first}\n\n${bullets}\n\n_(Demo mode: connect a Gemini key in Settings for a fully AI-generated result.)_` };
    }
  },

  async chat({ question, memory }) {
    await wait(600 + Math.random() * 500);
    const q = question.toLowerCase();
    const scored = memory
      .map((m) => ({ ...m, score: overlap(q, (m.transcript + " " + m.title).toLowerCase()) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (!scored.length)
      return { content: "I couldn't find anything in this workspace's memory that answers that yet. Try recording or uploading a relevant session first.", cites: [] };
    const best = scored[0];
    const line = sentences(best.transcript).sort((a, b) => overlap(q, b.toLowerCase()) - overlap(q, a.toLowerCase()))[0]?.trim();
    return {
      content: `Based on your workspace memory, here's what I found:\n\n> ${line}\n\nThis came up in **${best.title}**. ${scored.length > 1 ? `It was also touched on in ${scored.slice(1).map((s) => `_${s.title}_`).join(" and ")}.` : ""}`,
      cites: scored.map((s) => ({ id: s.id, title: s.title })),
    };
  },

  extractActions: (t) => guessActions(t),
};

/* =========================================================
   GeminiProvider — real AI via the user's own API key.
   Called directly from the browser (Pages has no server).
   ========================================================= */
const GEMINI_ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

function GeminiProvider(key, model) {
  async function call(promptText) {
    const res = await fetch(GEMINI_ENDPOINT(model, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini ${res.status}: ${msg.slice(0, 160)}`);
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "(empty response)";
  }
  return {
    name: "Gemini",
    async run({ transcript, prompt, taskKey }) {
      const instruction = taskInstruction(taskKey, prompt);
      const content = await call(
        `You are MirzaKateb, a calm, precise writing assistant. ${instruction}\n\nRespond in clean Markdown only.\n\n--- TRANSCRIPT ---\n${transcript}`
      );
      return { content };
    },
    async chat({ question, memory }) {
      const context = memory.map((m) => `### ${m.title}\n${m.transcript}`).join("\n\n");
      const content = await call(
        `You are the memory of a workspace. Answer the question using ONLY the meeting notes below. Cite meeting titles inline. If the answer isn't present, say so.\n\nQUESTION: ${question}\n\n--- MEETINGS ---\n${context}`
      );
      return { content, cites: memory.map((m) => ({ id: m.id, title: m.title })) };
    },
    async extractActions(transcript) {
      try {
        const raw = await call(
          `Extract action items from the transcript as a JSON array. Each item: {"task","owner","deadline","priority":"high|medium|low","status":"open"}. Return ONLY JSON.\n\n${transcript}`
        );
        const json = JSON.parse(raw.replace(/```json|```/g, "").trim());
        return json.map((a) => ({ id: store.uid(), status: "open", ...a }));
      } catch {
        return guessActions(transcript);
      }
    },
  };
}

/* ---- Shared helpers ---- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function overlap(a, b) {
  const wa = new Set(a.split(/\W+/).filter((w) => w.length > 3));
  let n = 0; wa.forEach((w) => { if (b.includes(w)) n++; }); return n;
}
function decisionLines(t) {
  return sentences(t).filter((s) => /\b(decided|agreed|will launch|pause|approved|chose|go with|final|conclusion)\b/i.test(s))
    .map((s) => `- ${s.trim()}`).join("\n");
}
function actionLines(t) {
  return guessActions(t).map((a) => `- **${a.task}**${a.owner ? ` — @${a.owner}` : ""}${a.deadline ? ` _(${a.deadline})_` : ""} · ${a.priority}`).join("\n");
}
function inferTask(prompt = "") {
  const p = prompt.toLowerCase();
  for (const t of TASKS) if (p.includes(t.label.toLowerCase().replace("convert to ", ""))) return t.key;
  if (/summar/.test(p)) return "summary";
  if (/action|task/.test(p)) return "actions";
  if (/minute/.test(p)) return "minutes";
  if (/blog/.test(p)) return "blog";
  if (/linkedin/.test(p)) return "linkedin";
  if (/email|mail/.test(p)) return "email";
  if (/decision/.test(p)) return "decisions";
  if (/to-?do|todo/.test(p)) return "todo";
  if (/transcri|text/.test(p)) return "transcribe";
  return "custom";
}
function taskInstruction(key, prompt) {
  const map = {
    transcribe: "Clean up and format the transcript.",
    summary: "Write a concise, well-structured summary.",
    actions: "Extract all action items with owners and deadlines.",
    minutes: "Write formal meeting minutes: overview, key points, decisions, action items.",
    blog: "Rewrite this as an engaging blog post with headings.",
    linkedin: "Write a thoughtful LinkedIn post (no hashtags spam).",
    email: "Draft a clear follow-up email with a subject line.",
    decisions: "List every decision that was made.",
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
    if (s.provider === "gemini" && s.geminiKey) return GeminiProvider(s.geminiKey, s.geminiModel || "gemini-2.5-flash");
    return DemoProvider;
  },
  providerName() { return this.provider().name; },
  run(args) { return this.provider().run(args); },
  chat(args) { return this.provider().chat(args); },
  extractActions(transcript) { return this.provider().extractActions(transcript); },
  inferTask,
};
