/* ============================================================
   admin.js — full admin panel: stats, user CRUD, role & limits.
   Only reachable when signed-in account has role "admin".
   ============================================================ */

import { store } from "../store.js";
import { el, icon, esc, relDate, toast, modal } from "../ui.js";

export function adminView() {
  const root = el(`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow" style="color:var(--gold)">Administrator</div>
        <h1>Admin Panel</h1>
        <div class="sub">Manage users, roles and usage limits.</div>
      </div>
    </div>
    <div class="stat-row mb" id="stats"><div class="spinner"></div></div>

    <div class="card">
      <div class="row between wrap mb" style="gap:.8rem">
        <h3 style="margin:0">Users <span class="muted" id="ucount" style="font-weight:400;font-size:1rem"></span></h3>
        <div class="row" style="gap:.6rem">
          <input id="search" type="search" placeholder="Search name or email…" style="width:200px;padding:.4rem .7rem;font-size:.9rem" />
          <button class="btn btn-primary btn-sm" id="newUserBtn">${icon("plus")} New user</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="ai-table" id="utbl">
          <thead><tr>
            <th>Name</th><th>Email</th><th>Role</th><th>Status</th>
            <th>Sessions</th><th>Limits</th><th>Joined</th><th>Last login</th><th></th>
          </tr></thead>
          <tbody id="ubody"><tr><td colspan="9" class="center muted" style="padding:2rem"><div class="spinner"></div></td></tr></tbody>
        </table>
      </div>
    </div>
  </div>`);

  let allUsers = [];

  const statsEl = root.querySelector("#stats");
  const ubody   = root.querySelector("#ubody");
  const search  = root.querySelector("#search");

  // ---- Load stats ----
  store.api("/api/admin/stats").then((s) => {
    statsEl.innerHTML = `
      <div class="stat"><div class="n">${s.users}</div><div class="l">Users</div></div>
      <div class="stat"><div class="n">${s.sessions}</div><div class="l">Recordings</div></div>
      <div class="stat"><div class="n">${s.withAudio}</div><div class="l">With audio</div></div>
      <div class="stat"><div class="n">${s.workspaces}</div><div class="l">Workspaces</div></div>`;
  }).catch((e) => { statsEl.innerHTML = `<div class="banner">⚠ ${esc(e.message)}</div>`; });

  // ---- Load users ----
  async function loadUsers() {
    try {
      const { users } = await store.api("/api/admin/users");
      allUsers = users;
      renderTable(users);
    } catch (e) {
      ubody.innerHTML = `<tr><td colspan="9" class="center"><div class="banner" style="display:inline-block">⚠ ${esc(e.message)}</div></td></tr>`;
    }
  }

  function renderTable(users) {
    root.querySelector("#ucount").textContent = `· ${users.length} accounts`;
    if (!users.length) {
      ubody.innerHTML = `<tr><td colspan="9" class="center muted" style="padding:2rem">No users found.</td></tr>`;
      return;
    }
    ubody.innerHTML = "";
    users.forEach((u) => {
      const roleChip = u.role === "admin"
        ? `<span class="pill high">admin</span>`
        : `<span class="pill low">user</span>`;
      const statusChip = u.isActive
        ? `<span class="pill low">active</span>`
        : `<span class="pill" style="background:var(--line);color:var(--text-soft)">suspended</span>`;
      const limits = [];
      if (u.maxSessions != null) limits.push(`${u.sessions}/${u.maxSessions} sessions`);
      if (u.maxStorageMb != null) limits.push(`max ${u.maxStorageMb} MB`);
      const limitsText = limits.length ? esc(limits.join(", ")) : `<span class="muted">unlimited</span>`;

      const tr = el(`<tr>
        <td style="font-weight:500">${esc(u.name)}</td>
        <td class="muted" style="font-size:.88rem">${esc(u.email)}</td>
        <td>${roleChip}</td>
        <td>${statusChip}</td>
        <td>${u.sessions}</td>
        <td style="font-size:.84rem">${limitsText}</td>
        <td class="muted" style="font-size:.84rem">${relDate(u.createdAt)}</td>
        <td class="muted" style="font-size:.84rem">${u.lastLogin ? relDate(u.lastLogin) : "never"}</td>
        <td>
          <div class="row" style="gap:.3rem;justify-content:flex-end">
            <button class="btn btn-ghost btn-sm" data-edit title="Edit">${icon("edit")} Edit</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-del title="Delete">${icon("trash")}</button>
          </div>
        </td>
      </tr>`);
      tr.querySelector("[data-edit]").onclick = () => openEditModal(u, loadUsers);
      tr.querySelector("[data-del]").onclick = () => confirmDelete(u, loadUsers);
      ubody.appendChild(tr);
    });
  }

  // ---- Search filter ----
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    renderTable(q ? allUsers.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : allUsers);
  });

  // ---- New user ----
  root.querySelector("#newUserBtn").onclick = () => openCreateModal(loadUsers);

  loadUsers();
  return root;
}

/* ---------- Create user modal ---------- */
function openCreateModal(onDone) {
  modal({
    title: "Create new user",
    body: `
      <div class="field"><label>Full name</label><input id="cName" type="text" dir="auto" placeholder="e.g. Ali Ahmadi" /></div>
      <div class="field"><label>Email / username</label><input id="cEmail" type="text" placeholder="e.g. ali@company.ir or ali" autocomplete="off" /></div>
      <div class="field"><label>Password</label><input id="cPass" type="password" placeholder="At least 6 characters" autocomplete="new-password" /></div>
      <div class="row" style="gap:1rem;align-items:flex-start">
        <div class="field" style="flex:1"><label>Role</label>
          <select id="cRole"><option value="user">user</option><option value="admin">admin</option></select>
        </div>
        <div class="field" style="flex:1"><label>Max sessions <span class="muted">(blank = unlimited)</span></label>
          <input id="cMaxSess" type="number" min="1" placeholder="unlimited" />
        </div>
        <div class="field" style="flex:1"><label>Max storage MB <span class="muted">(blank = unlimited)</span></label>
          <input id="cMaxMb" type="number" min="1" placeholder="unlimited" />
        </div>
      </div>`,
    confirmText: "Create",
    onConfirm: async (root) => {
      const name    = root.querySelector("#cName").value.trim();
      const email   = root.querySelector("#cEmail").value.trim().toLowerCase();
      const pass    = root.querySelector("#cPass").value;
      const role    = root.querySelector("#cRole").value;
      const maxSess = root.querySelector("#cMaxSess").value;
      const maxMb   = root.querySelector("#cMaxMb").value;

      if (!name || !email || !pass) { toast("Name, email and password are required"); return true; }
      if (pass.length < 6) { toast("Password must be at least 6 characters"); return true; }

      const btn = root.querySelector("[data-ok]");
      btn.textContent = "Creating…"; btn.disabled = true;
      try {
        await store.api("/api/admin/users", {
          method: "POST",
          body: { name, email, password: pass, role,
            maxSessions: maxSess || null, maxStorageMb: maxMb || null },
        });
        toast("User created");
        root.remove();
        onDone();
      } catch (e) { toast(e.message); btn.textContent = "Create"; btn.disabled = false; }
      return true;
    },
  });
}

/* ---------- Edit user modal ---------- */
function openEditModal(u, onDone) {
  modal({
    title: `Edit: ${u.name}`,
    body: `
      <div class="field"><label>Full name</label><input id="eName" type="text" dir="auto" value="${esc(u.name)}" /></div>
      <div class="field"><label>Email / username</label><input id="eEmail" type="text" value="${esc(u.email)}" autocomplete="off" /></div>
      <div class="row" style="gap:1rem;align-items:flex-start">
        <div class="field" style="flex:1"><label>Role</label>
          <select id="eRole">
            <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
        </div>
        <div class="field" style="flex:1"><label>Status</label>
          <select id="eActive">
            <option value="1" ${u.isActive ? "selected" : ""}>active</option>
            <option value="0" ${!u.isActive ? "selected" : ""}>suspended</option>
          </select>
        </div>
      </div>
      <div class="row" style="gap:1rem;align-items:flex-start">
        <div class="field" style="flex:1"><label>Max sessions <span class="muted">(blank = unlimited)</span></label>
          <input id="eMaxSess" type="number" min="1" placeholder="unlimited" value="${u.maxSessions ?? ""}" />
        </div>
        <div class="field" style="flex:1"><label>Max storage MB <span class="muted">(blank = unlimited)</span></label>
          <input id="eMaxMb" type="number" min="1" placeholder="unlimited" value="${u.maxStorageMb ?? ""}" />
        </div>
      </div>
      <div class="field"><label>New password <span class="muted">(leave blank to keep current)</span></label>
        <input id="ePass" type="password" placeholder="Leave blank to keep current" autocomplete="new-password" />
      </div>`,
    confirmText: "Save",
    onConfirm: async (root) => {
      const name    = root.querySelector("#eName").value.trim();
      const email   = root.querySelector("#eEmail").value.trim().toLowerCase();
      const role    = root.querySelector("#eRole").value;
      const active  = root.querySelector("#eActive").value;
      const maxSess = root.querySelector("#eMaxSess").value;
      const maxMb   = root.querySelector("#eMaxMb").value;
      const pass    = root.querySelector("#ePass").value;

      if (!name || !email) { toast("Name and email are required"); return true; }
      if (pass && pass.length < 6) { toast("New password must be at least 6 characters"); return true; }

      const btn = root.querySelector("[data-ok]");
      btn.textContent = "Saving…"; btn.disabled = true;
      const body = {
        name, email, role,
        isActive: active === "1",
        maxSessions: maxSess !== "" ? maxSess : null,
        maxStorageMb: maxMb !== "" ? maxMb : null,
      };
      if (pass) body.password = pass;

      try {
        await store.api(`/api/admin/users/${u.id}`, { method: "PATCH", body });
        toast("User updated");
        root.remove();
        onDone();
      } catch (e) { toast(e.message); btn.textContent = "Save"; btn.disabled = false; }
      return true;
    },
  });
}

/* ---------- Delete confirmation ---------- */
function confirmDelete(u, onDone) {
  modal({
    title: "Delete user?",
    body: `<p class="muted">Delete <strong>${esc(u.name)}</strong> (${esc(u.email)}) and all their recordings, workspaces and data? <strong>This cannot be undone.</strong></p>`,
    confirmText: "Delete",
    danger: true,
    onConfirm: async (root) => {
      const btn = root.querySelector("[data-ok]");
      btn.textContent = "Deleting…"; btn.disabled = true;
      try {
        await store.api(`/api/admin/users/${u.id}`, { method: "DELETE" });
        toast("User deleted");
        root.remove();
        onDone();
      } catch (e) { toast(e.message); btn.textContent = "Delete"; btn.disabled = false; }
      return true;
    },
  });
}
