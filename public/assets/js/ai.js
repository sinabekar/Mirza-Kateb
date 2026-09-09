/* ============================================================
   ai.js — thin client facade. All real AI now runs on the
   server (key in .env). These just describe tasks and report
   whether the server has AI configured.
   ============================================================ */

import { store } from "./store.js";

export const TASKS = [
  { key: "transcribe", label: "Convert to text", icon: "✍" },
  { key: "summary", label: "Summarize", icon: "❦" },
  { key: "minutes", label: "Meeting minutes", icon: "❧" },
  { key: "custom", label: "Custom prompt", icon: "✳" },
];

export const aiService = {
  isReady() { return !!store.get().aiConfigured; },   // server has an API key
};
