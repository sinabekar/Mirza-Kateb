/* ============================================================
   actions.js — every action item across the active workspace,
   editable inline, grouped by status.
   ============================================================ */

import { store } from "../store.js";
import { el, icon, esc } from "../ui.js";
import { go } from "../app.js";

export function actionsView() {
  const s = store.get();
  const ws = store.workspace(s.activeWorkspace);
  let items = store.allActionItems(s.activeWorkspace);

  const root = el(`<div>
    <div class="page-head"><div>
      <div class="eyebrow">${esc(ws?.emoji || "")} ${esc(ws?.name || "")}</div>
      <h1>Action items</h1>
      <div class="sub">Everything the scribe found that someone needs to do.</div>
    </div></div>
    <div class="tabs" id="ff">
      <div class="tab active" data-f="all">All (${items.length})</div>
      <div class="tab" data-f="open">Open</div>
      <div class="tab" data-f="in-progress">In progress</div>
      <div class="tab" data-f="done">Done</div>
    </div>
    <div id="list"></div>
  </div>`);

  const list = root.querySelector("#list");
  let filter = "all";

  function render() {
    let rows = items.filter((i) => filter === "all" || i.status === filter);
    if (!rows.length) { list.innerHTML = `<div class="empty"><div class="em-mark">◎</div><p>Nothing here.</p></div>`; return; }
    list.innerHTML = `<div class="card" style="padding:.4rem 1rem"><div style="overflow-x:auto"><table class="ai-table"><thead><tr>
      <th style="width:40%">Task</th><th>Owner</th><th>Deadline</th><th>Priority</th><th>Status</th><th>Session</th>
    </tr></thead><tbody id="tb"></tbody></table></div></div>`;
    const tb = list.querySelector("#tb");
    rows.forEach((it) => {
      const tr = el(`<tr>
        <td>${esc(it.task)}</td>
        <td>${it.owner ? esc(it.owner) : '<span class="muted">—</span>'}</td>
        <td>${it.deadline ? esc(it.deadline) : '<span class="muted">—</span>'}</td>
        <td><span class="pill ${it.priority}">${esc(it.priority)}</span></td>
        <td><select data-status style="width:auto">${["open", "in-progress", "done"].map((p) => `<option ${it.status === p ? "selected" : ""}>${p}</option>`).join("")}</select></td>
        <td><a href="#/session/${it.sessionId}" style="font-size:.85rem">${esc(it.sessionTitle.slice(0, 24))}</a></td>
      </tr>`);
      tr.querySelector("[data-status]").onchange = (e) => {
        const se = store.session(it.sessionId);
        const target = se.actionItems.find((a) => a.id === it.id);
        if (target) { target.status = e.target.value; store.setActionItems(it.sessionId, se.actionItems); items = store.allActionItems(s.activeWorkspace); }
      };
      tb.appendChild(tr);
    });
  }

  root.querySelectorAll("#ff .tab").forEach((t) => t.onclick = () => {
    root.querySelectorAll("#ff .tab").forEach((x) => x.classList.remove("active")); t.classList.add("active");
    filter = t.dataset.f; render();
  });
  render();
  return root;
}
