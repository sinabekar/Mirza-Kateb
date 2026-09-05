/* ============================================================
   layout.js — the app shell: sidebar, workspace switcher, topbar.
   Wraps every authenticated view.
   ============================================================ */

import { store } from "./store.js";
import { el, icon, esc, initials, modal, toast } from "./ui.js";
import { go } from "./app.js";

export function shell(route, contentEl, { title, sub, topRight } = {}) {
  const s = store.get();
  const ws = store.workspace(s.activeWorkspace);

  const nav = [
    { r: "dashboard", label: "Dashboard", ic: "home" },
    { r: "new", label: "New Recording", ic: "mic" },
    { r: "chat", label: "Ask Memory", ic: "chat" },
    { r: "search", label: "Search", ic: "search" },
    { r: "actions", label: "Action Items", ic: "check" },
  ];
  if (store.isAdmin()) nav.push({ r: "admin", label: "Admin Panel", ic: "gear" });

  const navItem = (n) => `<a class="nav-item ${route === n.r ? "active" : ""}" href="#/${n.r === "dashboard" ? "" : n.r}">${icon(n.ic)}<span>${n.label}</span></a>`;

  const wsList = s.workspaces.map((w) => `
    <div class="nav-item ${w.id === s.activeWorkspace ? "active" : ""}" data-ws="${w.id}">
      <span class="ico" style="font-size:1rem;line-height:1">${esc(w.emoji)}</span>
      <span>${esc(w.name)}</span>
      <span class="count">${store.sessionsFor(w.id).length}</span>
    </div>`).join("");

  const root = el(`<div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">م</div>
        <div><div class="brand-name">MirzaKateb</div><div class="brand-sub">Voice Workspace</div></div>
      </div>
      <nav>${nav.map(navItem).join("")}</nav>
      <div class="nav-section-label">Workspaces</div>
      <div id="wsList">${wsList}</div>
      <div class="nav-item" id="addWs" style="color:var(--gold)">${icon("plus")}<span>New workspace</span></div>
      <div class="sidebar-foot">
        <div class="profile-chip" id="profileChip">
          <div class="avatar">${initials(s.user?.name)}</div>
          <div style="min-width:0">
            <div style="font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.user?.name || "Guest")}</div>
            <div class="muted" style="font-size:.72rem">${esc(s.user?.email || "")}</div>
          </div>
          ${icon("gear", "ico")}
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="mobile-nav">
        <div class="brand-mark" style="width:32px;height:32px;font-size:1.1rem;border-radius:9px">م</div>
        ${nav.map(navItem).join("")}
      </div>
      <div class="topbar">
        <div class="search-box" role="search">
          ${icon("search")}
          <input id="globalSearch" type="text" placeholder="Search across ${esc(ws?.name || "workspace")}…" aria-label="Search" />
        </div>
        <div style="margin-left:auto" class="row">${topRight || ""}</div>
      </div>
      <div class="content" id="viewContent"></div>
    </main>
  </div>`);

  root.querySelector("#viewContent").appendChild(contentEl);

  // workspace switching
  root.querySelectorAll("[data-ws]").forEach((n) => n.onclick = () => {
    store.setActiveWorkspace(n.dataset.ws);
    go(route === "session" ? "" : "");
  });
  root.querySelector("#addWs").onclick = addWorkspaceModal;
  root.querySelector("#profileChip").onclick = () => go("settings");

  const search = root.querySelector("#globalSearch");
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && search.value.trim()) go("search?q=" + encodeURIComponent(search.value.trim()));
  });

  return root;
}

export function addWorkspaceModal() {
  modal({
    title: "New workspace",
    body: `<p class="muted" style="margin-top:-.4rem">Each workspace keeps its own AI memory.</p>
      <div class="field"><label>Emoji</label><input id="wsEmoji" type="text" maxlength="2" value="◇" style="width:80px" /></div>
      <div class="field"><label>Name</label><input id="wsName" type="text" placeholder="e.g. Clients, University…" /></div>`,
    confirmText: "Create",
    onConfirm: (root) => {
      const name = root.querySelector("#wsName").value.trim();
      if (!name) { root.querySelector("#wsName").focus(); return true; }
      const emoji = root.querySelector("#wsEmoji").value.trim() || "◇";
      store.addWorkspace(name, emoji).then(() => { toast(`Workspace “${name}” created`); go(""); })
        .catch((e) => toast(e.message));
    },
  });
}
