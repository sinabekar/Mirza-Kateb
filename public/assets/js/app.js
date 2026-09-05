/* ============================================================
   app.js — bootstrap + hash router (server-backed).
   ============================================================ */

import { store } from "./store.js";
import { shell } from "./layout.js";
import { authView } from "./views/auth.js";
import { dashboardView } from "./views/dashboard.js";
import { recordView } from "./views/record.js";
import { sessionView } from "./views/session.js";
import { chatView } from "./views/chat.js";
import { searchView } from "./views/search.js";
import { actionsView } from "./views/actions.js";
import { settingsView } from "./views/settings.js";
import { adminView } from "./views/admin.js";

const app = document.getElementById("app");

export function go(path) {
  const clean = String(path).replace(/^#?\/?/, "");
  if (location.hash === "#/" + clean) render();
  else location.hash = "/" + clean;
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  return { route: parts[0] || "dashboard", arg: parts[1] || "", params: new URLSearchParams(queryPart || "") };
}

function render() {
  applyTheme(store.get().settings.theme);
  const s = store.get();

  // auth guard
  if (!s.user) {
    if (parse().route !== "login") { location.hash = "/login"; return; }
    return swap(authView());
  }
  if (parse().route === "login") { location.hash = "/"; return; }

  const { route, arg, params } = parse();
  let content, active = route;

  switch (route) {
    case "dashboard": content = dashboardView(); break;
    case "new": content = recordView(); break;
    case "session": content = sessionView(arg); active = "dashboard"; break;
    case "chat": content = chatView(); break;
    case "search": content = searchView(params.get("q") || ""); break;
    case "actions": content = actionsView(); break;
    case "settings": content = settingsView(); break;
    case "admin":
      if (!store.isAdmin()) { location.hash = "/"; return; }
      content = adminView(); break;
    default: content = dashboardView(); active = "dashboard";
  }

  swap(shell(active, content));
  window.scrollTo(0, 0);
  if (route === "chat") { const c = app.querySelector(".content"); if (c) c.style.padding = "0"; }
}

function swap(node) { app.replaceChildren(node); }

window.addEventListener("hashchange", render);

// ---- boot ----
(async function boot() {
  applyTheme(store.get().settings.theme);
  app.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center"><div class="spinner"></div></div>`;
  try {
    const user = await store.me();
    if (user) await store.hydrate();
  } catch (e) { console.warn("boot", e); }

  if (!store.get().user) location.hash = "/login";
  else if (!location.hash || location.hash === "#/login") location.hash = "/";
  render();
})();
