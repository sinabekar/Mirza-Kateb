/* ============================================================
   search.js — global search across transcripts, summaries,
   action items, titles and tags (all workspaces).
   ============================================================ */

import { store } from "../store.js";
import { el, icon, esc, relDate } from "../ui.js";
import { go } from "../app.js";

export function searchView(query = "") {
  const root = el(`<div>
    <div class="page-head"><div>
      <div class="eyebrow">Semantic-style search</div>
      <h1>Search everything</h1>
      <div class="sub">Across transcripts, summaries, action items, titles &amp; tags — in every workspace.</div>
    </div></div>
    <div class="search-box" style="max-width:640px;margin-bottom:1.6rem;padding:.7rem 1.2rem">
      ${icon("search")}<input id="sq" type="text" placeholder="Try “budget”, “logo”, “deadline”…" value="${esc(query)}" />
    </div>
    <div id="results"></div>
  </div>`);

  const input = root.querySelector("#sq");
  const results = root.querySelector("#results");

  function run() {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.innerHTML = `<div class="empty"><div class="em-mark">${icon("search","ico")}</div><p>Type to search across your knowledge base.</p></div>`; return; }
    const terms = q.split(/\s+/).filter(Boolean);
    const hits = [];

    store.get().sessions.forEach((se) => {
      const ws = store.workspace(se.workspace);
      const fields = [
        { label: "Title", text: se.title },
        { label: "Transcript", text: se.transcript },
        { label: "Tags", text: se.tags.join(" ") },
        ...se.outputs.map((o) => ({ label: o.type, text: o.versions[0]?.content || "" })),
        ...se.actionItems.map((a) => ({ label: "Action", text: `${a.task} ${a.owner} ${a.deadline}` })),
      ];
      let score = 0, snippet = "", snippetLabel = "";
      fields.forEach((f) => {
        const low = (f.text || "").toLowerCase();
        terms.forEach((t) => { if (low.includes(t)) { score += f.label === "Title" || f.label === "Tags" ? 3 : 1; if (!snippet) { snippet = makeSnippet(f.text, t); snippetLabel = f.label; } } });
      });
      if (score) hits.push({ se, ws, score, snippet, snippetLabel });
    });

    hits.sort((a, b) => b.score - a.score);
    if (!hits.length) { results.innerHTML = `<div class="empty"><div class="em-mark">م</div><p>No matches for “${esc(q)}”.</p></div>`; return; }

    results.innerHTML = `<p class="muted mb">${hits.length} result${hits.length > 1 ? "s" : ""}</p>`;
    hits.forEach((h) => {
      const card = el(`<div class="card clickable" style="margin-bottom:.9rem">
        <div class="row between"><h3>${esc(h.se.title)}</h3><span class="tag">${esc(h.ws?.emoji || "")} ${esc(h.ws?.name || "")}</span></div>
        <div class="session-meta" style="margin:.4rem 0 .5rem"><span>${icon("calendar")} ${relDate(h.se.date)}</span><span class="tag gold">${esc(h.snippetLabel)}</span></div>
        <div class="excerpt" style="-webkit-line-clamp:3">${h.snippet}</div>
      </div>`);
      card.onclick = () => go("session/" + h.se.id);
      results.appendChild(card);
    });
  }

  function makeSnippet(text = "", term) {
    const i = text.toLowerCase().indexOf(term);
    if (i < 0) return esc(text.slice(0, 140));
    const start = Math.max(0, i - 50);
    const raw = (start ? "…" : "") + text.slice(start, i + 90) + "…";
    return esc(raw).replace(new RegExp(`(${term})`, "ig"), '<mark style="background:var(--gold-soft);border-radius:3px;padding:0 2px">$1</mark>');
  }

  input.addEventListener("input", run);
  run();
  setTimeout(() => input.focus(), 50);
  return root;
}
