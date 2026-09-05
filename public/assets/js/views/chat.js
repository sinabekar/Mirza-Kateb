/* ============================================================
   chat.js — "Ask Memory": a per-workspace knowledge base chat.
   Answers from the transcripts stored in the active workspace.
   ============================================================ */

import { store } from "../store.js";
import { aiService } from "../ai.js";
import { el, icon, esc, md, initials } from "../ui.js";
import { go } from "../app.js";

const SUGGESTIONS = [
  "What decisions were made?",
  "Who is responsible for what?",
  "What tasks are still incomplete?",
  "Summarise what was discussed most recently.",
];

export function chatView() {
  const s = store.get();
  const ws = store.workspace(s.activeWorkspace);
  const history = s.chats[s.activeWorkspace] || [];
  const memory = store.sessionsFor(s.activeWorkspace).map((se) => ({ id: se.id, title: se.title, transcript: se.transcript || "" }));

  const root = el(`<div class="chat-wrap">
    <div class="chat-stream" id="stream"></div>
    <div class="chat-input-bar">
      <div class="chat-input-inner">
        <textarea id="q" rows="1" placeholder="Ask anything about ${esc(ws?.name || "this workspace")}…"></textarea>
        <button class="btn btn-primary" id="ask">${icon("send")}</button>
      </div>
    </div>
  </div>`);

  const stream = root.querySelector("#stream");

  function renderIntro() {
    stream.innerHTML = `<div class="empty" style="padding-top:2rem">
      <div class="em-mark">${icon("chat", "ico")}</div>
      <h2 style="font-family:var(--display)">Ask your workspace</h2>
      <p style="max-width:44ch;margin:.4rem auto 0">MirzaKateb reads across <strong>${memory.length}</strong> recording${memory.length !== 1 ? "s" : ""} in <em>${esc(ws?.name)}</em> and answers from what was actually said.</p>
      <div class="chips" style="justify-content:center;max-width:600px;margin:1.6rem auto 0" id="sugg">
        ${SUGGESTIONS.map((x) => `<button class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join("")}
      </div>
    </div>`;
    stream.querySelectorAll("[data-q]").forEach((b) => b.onclick = () => { root.querySelector("#q").value = b.dataset.q; send(); });
  }

  function bubble(msg) {
    const isUser = msg.role === "user";
    const b = el(`<div class="msg ${isUser ? "user" : "ai"}">
      ${isUser ? "" : `<div class="avatar" style="background:var(--olive);color:#faf8f4">م</div>`}
      <div class="bubble">
        ${isUser ? esc(msg.content) : md(msg.content)}
        ${(!isUser && msg.cites?.length) ? `<div class="cite">Sources: ${msg.cites.map((c) => `<a href="#/session/${c.id}">${esc(c.title)}</a>`).join(" · ")}</div>` : ""}
      </div>
      ${isUser ? `<div class="avatar">${initials(store.get().user?.name)}</div>` : ""}
    </div>`);
    return b;
  }

  function renderHistory() {
    if (!history.length) { renderIntro(); return; }
    stream.innerHTML = "";
    history.forEach((m) => stream.appendChild(bubble(m)));
    stream.scrollTop = stream.scrollHeight;
  }

  const q = root.querySelector("#q");
  q.addEventListener("input", () => { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 140) + "px"; });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  root.querySelector("#ask").onclick = send;

  let sending = false;
  async function send() {
    const text = q.value.trim();
    if (!text || sending) return;
    q.value = ""; q.style.height = "auto";
    if (!stream.querySelector(".msg")) stream.innerHTML = "";
    stream.appendChild(bubble({ role: "user", content: text }));

    if (!aiService.isReady()) {
      stream.appendChild(bubble({ role: "ai", content: "The server has no AI configured yet, so I can't answer from memory. An administrator needs to set the API key." }));
      stream.scrollTop = stream.scrollHeight;
      return;
    }

    sending = true;
    const thinking = el(`<div class="msg ai"><div class="avatar" style="background:var(--olive);color:#faf8f4">م</div><div class="bubble"><div class="spinner" style="margin:.2rem 0;width:22px;height:22px"></div></div></div>`);
    stream.appendChild(thinking);
    stream.scrollTop = stream.scrollHeight;

    try {
      const res = await store.askMemory(s.activeWorkspace, text);
      thinking.remove();
      stream.appendChild(bubble({ role: "ai", content: res.content, cites: res.cites }));
    } catch (e) {
      thinking.remove();
      stream.appendChild(bubble({ role: "ai", content: "⚠ " + e.message }));
    }
    sending = false;
    stream.scrollTop = stream.scrollHeight;
  }

  renderHistory();
  return root;
}
