/* ============================================================
   admin.js — admin dashboard: users, activity, storage.
   Only reachable when the signed-in account has role "admin".
   ============================================================ */

import { store } from "../store.js";
import { el, icon, esc, relDate, toast, modal, md } from "../ui.js";

export function adminView() {
  const root = el(`<div>
    <div class="page-head"><div>
      <div class="eyebrow" style="color:var(--gold)">Administrator</div>
      <h1>Admin Panel</h1>
      <div class="sub">Overview of users, recordings and activity.</div>
    </div></div>
    <div class="stat-row" id="stats"><div class="spinner"></div></div>
    <div class="card"><div class="row between mb"><h3>Users</h3><span class="muted" id="ucount"></span></div>
      <div style="overflow-x:auto"><table class="ai-table"><thead><tr>
        <th>Name</th><th>Email</th><th>Role</th><th>Sessions</th><th>Workspaces</th><th>Joined</th><th>Last login</th>
      </tr></thead><tbody id="ubody"><tr><td colspan="7" class="center muted" style="padding:2rem"><div class="spinner"></div></td></tr></tbody></table></div>
    </div>
  </div>`);

  const statsEl = root.querySelector("#stats");
  const ubody = root.querySelector("#ubody");

  (async () => {
    try {
      const stats = await store.api("/api/admin/stats");
      statsEl.innerHTML = `
        <div class="stat"><div class="n">${stats.users}</div><div class="l">Users</div></div>
        <div class="stat"><div class="n">${stats.sessions}</div><div class="l">Recordings</div></div>
        <div class="stat"><div class="n">${stats.withAudio}</div><div class="l">With stored audio</div></div>
        <div class="stat"><div class="n">${stats.workspaces}</div><div class="l">Workspaces</div></div>`;
    } catch (e) { statsEl.innerHTML = `<div class="banner">⚠ ${esc(e.message)}</div>`; }

    try {
      const { users } = await store.api("/api/admin/users");
      root.querySelector("#ucount").textContent = `${users.length} total`;
      if (!users.length) { ubody.innerHTML = `<tr><td colspan="7" class="center muted" style="padding:2rem">No users yet.</td></tr>`; return; }
      ubody.innerHTML = "";
      users.forEach((u) => {
        const tr = el(`<tr class="clickable" style="cursor:pointer">
          <td>${esc(u.name)}</td>
          <td>${esc(u.email)}</td>
          <td>${u.role === "admin" ? '<span class="pill high">admin</span>' : '<span class="pill low">user</span>'}</td>
          <td>${u.sessions}</td>
          <td>${u.workspaces}</td>
          <td>${relDate(u.createdAt)}</td>
          <td>${u.lastLogin ? relDate(u.lastLogin) : '<span class="muted">never</span>'}</td>
        </tr>`);
        tr.onclick = () => showUser(u.id);
        ubody.appendChild(tr);
      });
    } catch (e) { ubody.innerHTML = `<tr><td colspan="7" class="banner">⚠ ${esc(e.message)}</td></tr>`; }
  })();

  async function showUser(id) {
    try {
      const { user, sessions } = await store.api(`/api/admin/users/${id}`);
      const rows = sessions.length
        ? sessions.map((s) => `<tr><td>${esc(s.title)}</td><td><span class="pill ${s.status === "ready" ? "low" : "medium"}">${esc(s.status)}</span></td><td>${relDate(s.date)}</td></tr>`).join("")
        : `<tr><td colspan="3" class="muted center" style="padding:1rem">No recordings.</td></tr>`;
      modal({
        title: user.name,
        body: `<p class="muted" style="margin-top:-.4rem">${esc(user.email)} · joined ${relDate(user.createdAt)} · ${user.lastLogin ? "last seen " + relDate(user.lastLogin) : "never signed in"}</p>
          <div style="max-height:340px;overflow:auto;margin-top:.6rem"><table class="ai-table"><thead><tr><th>Recording</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>`,
        confirmText: "Close", cancelText: "",
        onConfirm: () => {},
      });
      // hide the empty cancel button
      const back = document.querySelector(".modal-backdrop:last-of-type");
      back?.querySelector("[data-x]")?.setAttribute("hidden", "");
    } catch (e) { toast(e.message); }
  }

  return root;
}
