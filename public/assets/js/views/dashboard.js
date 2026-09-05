/* ============================================================
   dashboard.js — sessions in the active workspace, with
   stats, filters, favourites, tags and status.
   ============================================================ */

import { store } from "../store.js";
import { el, icon, esc, relDate, toast, modal } from "../ui.js";
import { fmtDuration } from "../audio.js";
import { go } from "../app.js";

export function dashboardView() {
  const s = store.get();
  const ws = store.workspace(s.activeWorkspace);
  let sessions = store.sessionsFor(s.activeWorkspace);

  const totalMin = Math.round(sessions.reduce((a, x) => a + (x.duration || 0), 0) / 60);
  const openActions = store.allActionItems(s.activeWorkspace).filter((a) => a.status !== "done").length;

  const root = el(`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow">${esc(ws?.emoji || "")} ${esc(ws?.name || "Workspace")}</div>
        <h1>Your recordings</h1>
        <div class="sub">Every conversation, kept and understood.</div>
      </div>
      <button class="btn btn-primary" id="newBtn">${icon("mic")} New Recording</button>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="n">${sessions.length}</div><div class="l">Sessions</div></div>
      <div class="stat"><div class="n">${totalMin}<span style="font-size:1rem"> min</span></div><div class="l">Recorded</div></div>
      <div class="stat"><div class="n">${openActions}</div><div class="l">Open action items</div></div>
      <div class="stat"><div class="n">${sessions.filter((x) => x.favorite).length}</div><div class="l">Favourites</div></div>
    </div>

    <div class="tabs" id="filters">
      <div class="tab active" data-f="all">All</div>
      <div class="tab" data-f="favorite">★ Favourites</div>
      <div class="tab" data-f="processing">Processing</div>
      <div class="tab" data-f="ready">Ready</div>
    </div>

    <div class="grid grid-sessions" id="cards"></div>
  </div>`);

  root.querySelector("#newBtn").onclick = () => go("new");

  const cards = root.querySelector("#cards");
  let filter = "all";

  function renderCards() {
    let list = sessions;
    if (filter === "favorite") list = list.filter((x) => x.favorite);
    else if (filter !== "all") list = list.filter((x) => x.status === filter);

    if (!list.length) {
      cards.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="em-mark">م</div>
        <h3 style="color:var(--text-soft)">Nothing here yet</h3>
        <p>Record or upload audio to begin filling this workspace.</p>
        <button class="btn btn-primary" id="emptyNew" style="margin-top:1rem">${icon("mic")} New Recording</button>
      </div>`;
      cards.querySelector("#emptyNew").onclick = () => go("new");
      return;
    }

    cards.innerHTML = "";
    list.forEach((se) => {
      const excerpt = se.outputs[0]?.versions[0]?.content?.replace(/[#>*_`]/g, "").trim() || se.transcript || "No content yet.";
      const card = el(`<div class="card session-card clickable">
        <div class="sc-top">
          <div style="min-width:0">
            <div class="row" style="gap:.5rem">
              <span class="status-dot status-${se.status}"></span>
              <span class="muted" style="font-size:.76rem;text-transform:uppercase;letter-spacing:1px">${statusLabel(se.status)}</span>
            </div>
            <h3>${esc(se.title)}</h3>
          </div>
          <button class="fav ${se.favorite ? "on" : ""}" title="Favourite" aria-label="Favourite">${icon("star")}</button>
        </div>
        <div class="session-meta">
          <span>${icon("calendar")} ${relDate(se.date)}</span>
          <span>${icon("clock")} ${fmtDuration(se.duration)}</span>
          ${se.outputs.length ? `<span>${icon("doc")} ${se.outputs.length} output${se.outputs.length > 1 ? "s" : ""}</span>` : ""}
        </div>
        <div class="excerpt">${esc(excerpt.slice(0, 160))}</div>
        <div class="tags">${se.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>`);

      card.addEventListener("click", (e) => { if (e.target.closest(".fav")) return; go("session/" + se.id); });
      card.querySelector(".fav").onclick = (e) => {
        e.stopPropagation();
        store.toggleFavorite(se.id);
        e.currentTarget.classList.toggle("on");
        toast(store.session(se.id).favorite ? "Added to favourites" : "Removed from favourites");
      };
      cards.appendChild(card);
    });
  }

  root.querySelectorAll("#filters .tab").forEach((t) => t.onclick = () => {
    root.querySelectorAll("#filters .tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    filter = t.dataset.f;
    renderCards();
  });

  renderCards();
  return root;
}

function statusLabel(s) { return { ready: "Ready", processing: "AI working", draft: "Draft" }[s] || s; }
