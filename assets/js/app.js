/* ============================================================
   app.js — bootstrap + hash router.
   Hash routing keeps everything static-host friendly (no
   server rewrites needed) — perfect for GitHub Pages.
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
  const params = new URLSearchParams(queryPart || "");
  return { route: parts[0] || "dashboard", arg: parts[1] || "", params };
}

function render() {
  const s = store.get();
  applyTheme(s.settings.theme);

  // auth guard
  if (!s.user) {
    if (parse().route !== "login") { location.hash = "/login"; return; }
    swap(authView());
    return;
  }
  if (parse().route === "login") { location.hash = "/"; return; }

  const { route, arg, params } = parse();
  let content, activeRoute = route;

  switch (route) {
    case "dashboard": content = dashboardView(); break;
    case "new": content = recordView(); break;
    case "session": content = sessionView(arg); activeRoute = "dashboard"; break;
    case "chat": content = chatView(); break;
    case "search": content = searchView(params.get("q") || ""); break;
    case "actions": content = actionsView(); break;
    case "settings": content = settingsView(); activeRoute = "settings"; break;
    default: content = dashboardView(); activeRoute = "dashboard";
  }

  swap(shell(activeRoute, content));
  window.scrollTo(0, 0);
  const main = app.querySelector(".content") || app;
  if (route === "chat") main.style.padding = "0";
}

function swap(node) {
  app.replaceChildren(node);
}

window.addEventListener("hashchange", render);

// Module scripts are deferred, so the DOM is already parsed here.
applyTheme(store.get().settings.theme);
if (!location.hash) location.hash = store.get().user ? "/" : "/login";
else render();
