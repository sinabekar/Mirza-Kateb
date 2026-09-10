/* ============================================================
   admin.js — admin panel: stats, user CRUD with inline editing.
   Only reachable when the signed-in account has role "admin".
   ============================================================ */

import { store } from "../store.js";
import { el, icon, esc, relDate, toast, modal } from "../ui.js";

export function adminView() {
  const root = el(`<div>
    <div class="page-head">
      <div>
        <div class="eyebrow" style="color:var(--gold)">Administrator</div>
        <h1>Admin Panel</h1>
        <div class="sub">Manage accounts, roles and usage limits.</div>
      </div>
    </div>
    <div class="stat-row mb" id="stats"><div class="spinner"></div></div>

    <div class="card">
      <div class="row between wrap mb" style="gap:.8rem">
        <h3 style="margin:0">
          Users
          <span class="muted" id="ucount" style="font-weight:400;font-size:1rem"></span>
        </h3>
        <div class="row" style="gap:.6rem">
          <input id="search" type="search" placeholder="Search…" style="width:180px;padding:.4rem .7rem;font-size:.9rem" />
          <button class="btn btn-primary btn-sm" id="newUserBtn">${icon("plus")} New user</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="ai-table" id="utbl">
          <thead><tr>
            <th style="width:24px"></th>
            <th>Name</th><th>Email</th><th>Role</th><th>Status</th>
            <th>Sessions</th><th>Minutes used</th><th>Joined</th><th>Last login</th>
          </tr></thead>
          <tbody id="ubody">
            <tr><td colspan="9" class="center muted" style="padding:2rem"><div class="spinner"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`);

  let allUsers = [];
  let openId = null; // currently expanded user id

  const statsEl = root.querySelector("#stats");
  const ubody   = root.querySelector("#ubody");
  const search  = root.querySelector("#search");

  store.api("/api/admin/stats").then((s) => {
    statsEl.innerHTML = `
      <div class="stat"><div class="n">${s.users}</div><div class="l">Users</div></div>
      <div class="stat"><div class="n">${s.sessions}</div><div class="l">Recordings</div></div>
      <div class="stat"><div class="n">${s.withAudio}</div><div class="l">With audio</div></div>
      <div class="stat"><div class="n">${s.workspaces}</div><div class="l">Workspaces</div></div>`;
  }).catch((e) => { statsEl.innerHTML = `<div class="banner">⚠ ${esc(e.message)}</div>`; });

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
    ubody.innerHTML = "";
    if (!users.length) {
      ubody.innerHTML = `<tr><td colspan="9" class="center muted" style="padding:2rem">No users found.</td></tr>`;
      return;
    }
    users.forEach((u) => addUserRows(u));
  }

  function addUserRows(u) {
    const isOpen = openId === u.id;
    const roleChip   = u.role === "admin" ? `<span class="pill high">admin</span>` : `<span class="pill low">user</span>`;
    const statusChip = u.isActive
      ? `<span class="pill low">active</span>`
      : `<span class="pill" style="background:var(--line);color:var(--text-soft)">suspended</span>`;
    const minLabel = u.maxMinutes != null
      ? `${u.totalMinutes} / ${u.maxMinutes} min`
      : `${u.totalMinutes} min`;

    const tr = el(`<tr class="user-row" style="cursor:pointer" title="Click to expand">
      <td style="color:var(--text-faint);font-size:.8rem;text-align:center">${isOpen ? "▼" : "▶"}</td>
      <td style="font-weight:500">${esc(u.name)}</td>
      <td class="muted" style="font-size:.88rem">${esc(u.email)}</td>
      <td>${roleChip}</td>
      <td>${statusChip}</td>
      <td>${u.sessions}</td>
      <td style="font-size:.86rem">${minLabel}</td>
      <td class="muted" style="font-size:.84rem">${relDate(u.createdAt)}</td>
      <td class="muted" style="font-size:.84rem">${u.lastLogin ? relDate(u.lastLogin) : "never"}</td>
    </tr>`);

    const detailTr = el(`<tr class="user-detail-row" style="${isOpen ? "" : "display:none"}">
      <td colspan="9" style="padding:0">
        <div id="detail-${u.id}" class="user-detail-panel"></div>
      </td>
    </tr>`);

    if (isOpen) fillDetail(detailTr.querySelector(`#detail-${u.id}`), u, loadUsers);

    tr.onclick = () => {
      if (openId === u.id) {
        openId = null;
      } else {
        openId = u.id;
      }
      const q = search.value.trim().toLowerCase();
      renderTable(q ? allUsers.filter((x) => x.name.toLowerCase().includes(q) || x.email.toLowerCase().includes(q)) : allUsers);
    };

    ubody.appendChild(tr);
    ubody.appendChild(detailTr);
  }

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    renderTable(q ? allUsers.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : allUsers);
  });

  root.querySelector("#newUserBtn").onclick = () => openCreateModal(loadUsers);

  loadUsers();
  return root;
}

/* ---------- Inline detail/edit panel ---------- */
function fillDetail(panel, u, onDone) {
  panel.innerHTML = `
    <div style="padding:1.2rem 1.4rem;background:var(--surface);border-top:1px solid var(--border)">
      <div class="row between wrap" style="gap:1rem;align-items:flex-start">

        <div style="flex:2;min-width:260px">
          <div class="eyebrow mb" style="color:var(--olive)">Account info</div>
          <div class="row" style="gap:1rem;flex-wrap:wrap">
            <div class="field" style="flex:1;min-width:140px">
              <label>Full name</label>
              <input id="dName" type="text" dir="auto" value="${esc(u.name)}" />
            </div>
            <div class="field" style="flex:1;min-width:140px">
              <label>Email / username</label>
              <input id="dEmail" type="text" value="${esc(u.email)}" />
            </div>
          </div>
          <div class="row" style="gap:1rem;flex-wrap:wrap">
            <div class="field" style="flex:1">
              <label>Role</label>
              <select id="dRole">
                <option value="user"  ${u.role === "user"  ? "selected" : ""}>user</option>
                <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
              </select>
            </div>
            <div class="field" style="flex:1">
              <label>Status</label>
              <select id="dActive">
                <option value="1" ${u.isActive  ? "selected" : ""}>active</option>
                <option value="0" ${!u.isActive ? "selected" : ""}>suspended</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>New password <span class="muted">(leave blank to keep current)</span></label>
            <input id="dPass" type="password" placeholder="Leave blank to keep" autocomplete="new-password" />
          </div>
        </div>

        <div style="flex:1;min-width:220px">
          <div class="eyebrow mb" style="color:var(--olive)">Usage limits <span class="muted" style="font-weight:400">(blank = unlimited)</span></div>
          <div class="field">
            <label>Max sessions</label>
            <input id="dMaxSess" type="number" min="1" placeholder="unlimited" value="${u.maxSessions ?? ""}" />
            <div class="muted" style="font-size:.78rem;margin-top:.25rem">Current: ${u.sessions} sessions</div>
          </div>
          <div class="field">
            <label>Max recording minutes</label>
            <input id="dMaxMin" type="number" min="1" placeholder="unlimited" value="${u.maxMinutes ?? ""}" />
            <div class="muted" style="font-size:.78rem;margin-top:.25rem">Current: ${u.totalMinutes} minutes recorded</div>
          </div>
        </div>

      </div>

      <div class="row" style="gap:.6rem;margin-top:.4rem">
        <button class="btn btn-primary btn-sm" id="dSave">Save changes</button>
        <button class="btn btn-ghost btn-sm btn-danger" id="dDel">${icon("trash")} Delete user</button>
      </div>
    </div>`;

  panel.querySelector("#dSave").onclick = async () => {
    const name   = panel.querySelector("#dName").value.trim();
    const email  = panel.querySelector("#dEmail").value.trim().toLowerCase();
    const role   = panel.querySelector("#dRole").value;
    const active = panel.querySelector("#dActive").value;
    const maxS   = panel.querySelector("#dMaxSess").value;
    const maxM   = panel.querySelector("#dMaxMin").value;
    const pass   = panel.querySelector("#dPass").value;

    if (!name || !email) { toast("Name and email are required"); return; }
    if (pass && pass.length < 6) { toast("New password must be at least 6 characters"); return; }

    const btn = panel.querySelector("#dSave");
    btn.textContent = "Saving…"; btn.disabled = true;
    const body = {
      name, email, role,
      isActive: active === "1",
      maxSessions: maxS !== "" ? maxS : null,
      maxMinutes:  maxM !== "" ? maxM : null,
    };
    if (pass) body.password = pass;
    try {
      await store.api(`/api/admin/users/${u.id}`, { method: "PATCH", body });
      toast("Saved");
      onDone();
    } catch (e) { toast(e.message); btn.textContent = "Save changes"; btn.disabled = false; }
  };

  panel.querySelector("#dDel").onclick = () => {
    modal({
      title: "Delete user?",
      body: `<p class="muted">Delete <strong>${esc(u.name)}</strong> and all their recordings and data? <strong>This cannot be undone.</strong></p>`,
      confirmText: "Delete", danger: true,
      onConfirm: async (m) => {
        const btn = m.querySelector("[data-ok]");
        btn.textContent = "Deleting…"; btn.disabled = true;
        try {
          await store.api(`/api/admin/users/${u.id}`, { method: "DELETE" });
          toast("User deleted"); m.remove(); onDone();
        } catch (e) { toast(e.message); btn.textContent = "Delete"; btn.disabled = false; }
        return true;
      },
    });
  };
}

/* ---------- Create user modal ---------- */
function openCreateModal(onDone) {
  modal({
    title: "Create new user",
    body: `
      <div class="row" style="gap:1rem">
        <div class="field" style="flex:1"><label>Full name</label><input id="cName" type="text" dir="auto" placeholder="e.g. Ali Ahmadi" /></div>
        <div class="field" style="flex:1"><label>Email / username</label><input id="cEmail" type="text" placeholder="ali@company.ir" autocomplete="off" /></div>
      </div>
      <div class="row" style="gap:1rem">
        <div class="field" style="flex:1"><label>Password</label><input id="cPass" type="password" placeholder="At least 6 characters" autocomplete="new-password" /></div>
        <div class="field" style="flex:1"><label>Role</label><select id="cRole"><option value="user">user</option><option value="admin">admin</option></select></div>
      </div>
      <div class="eyebrow mb" style="color:var(--olive);margin-top:.2rem">Usage limits <span class="muted" style="font-weight:400">(blank = unlimited)</span></div>
      <div class="row" style="gap:1rem">
        <div class="field" style="flex:1"><label>Max sessions</label><input id="cMaxSess" type="number" min="1" placeholder="unlimited" /></div>
        <div class="field" style="flex:1"><label>Max recording minutes</label><input id="cMaxMin" type="number" min="1" placeholder="unlimited" /></div>
      </div>`,
    confirmText: "Create",
    onConfirm: async (root) => {
      const name  = root.querySelector("#cName").value.trim();
      const email = root.querySelector("#cEmail").value.trim().toLowerCase();
      const pass  = root.querySelector("#cPass").value;
      const role  = root.querySelector("#cRole").value;
      const maxS  = root.querySelector("#cMaxSess").value;
      const maxM  = root.querySelector("#cMaxMin").value;

      if (!name || !email || !pass) { toast("Name, email and password are required"); return true; }
      if (pass.length < 6) { toast("Password must be at least 6 characters"); return true; }

      const btn = root.querySelector("[data-ok]");
      btn.textContent = "Creating…"; btn.disabled = true;
      try {
        await store.api("/api/admin/users", {
          method: "POST",
          body: { name, email, password: pass, role,
                  maxSessions: maxS || null, maxMinutes: maxM || null },
        });
        toast("User created"); root.remove(); onDone();
      } catch (e) { toast(e.message); btn.textContent = "Create"; btn.disabled = false; }
      return true;
    },
  });
}
