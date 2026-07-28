/* ============================================================
   ui.js — small view helpers: markdown, icons, toast, modal,
   exports, and formatting. No framework, just tidy DOM.
   ============================================================ */

export const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---- Minimal, safe Markdown -> HTML ---- */
export function md(src = "") {
  const lines = src.replace(/\r/g, "").split("\n");
  let html = "", inList = null;
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { html += `</${inList}>`; inList = null; } };
  for (let raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { closeList(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/))) {
      if (inList !== "ul") { closeList(); html += '<ul class="list-clean">'; inList = "ul"; }
      html += `<li><span style="margin-right:.5rem">${m[1] === "x" ? "☑" : "☐"}</span>${inline(m[2])}</li>`;
    }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (inList !== "ul") { closeList(); html += "<ul>"; inList = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (inList !== "ol") { closeList(); html += "<ol>"; inList = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^>\s?(.*)/))) { closeList(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (line === "") { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

/* ---- Icons (inline SVG, stroke-based, calm) ---- */
export const icon = (name, cls = "ico") => {
  const p = ICONS[name] || "";
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">${p}</svg>`;
};
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5.9z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  download: '<path d="M12 3v12"/><path d="M7 12l5 5 5-5"/><path d="M5 21h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  star: '<path d="M12 3l2.6 5.6L20 9.3l-4 4 1 6-5-3-5 3 1-6-4-4 5.4-.7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  upload: '<path d="M12 21V9"/><path d="M7 12l5-5 5 5"/><path d="M5 3h14"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
};

/* ---- Toast ---- */
let toastTimer;
export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---- Modal ---- */
export function modal({ title, body, confirmText = "Confirm", cancelText = "Cancel", danger = false, onConfirm }) {
  const back = el(`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
    <h2>${esc(title)}</h2><div class="modal-body">${body}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-x>${esc(cancelText)}</button>
      <button class="btn ${danger ? "btn-danger btn-primary" : "btn-primary"}" data-ok>${esc(confirmText)}</button>
    </div></div></div>`);
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelector("[data-x]").onclick = close;
  back.querySelector("[data-ok]").onclick = () => { const keep = onConfirm?.(back); if (!keep) close(); };
  document.body.appendChild(back);
  back.querySelector("input,textarea")?.focus();
  return { close, root: back };
}

/* ---- Copy / download ---- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
  catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied"); }
}
export function download(filename, content, mime = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---- Export a markdown doc in several formats ---- */
export function exportDoc(title, markdown, format) {
  const safe = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "mirzakateb";
  if (format === "md") return download(`${safe}.md`, markdown, "text/markdown");
  if (format === "txt") return download(`${safe}.txt`, markdown.replace(/[#>*_`]/g, ""), "text/plain");
  if (format === "pdf") return exportPDF(title, markdown);
  if (format === "docx") return exportDocx(safe, markdown);
}
function exportPDF(title, markdown) {
  // Uses the browser's own print-to-PDF — no external library, fully offline.
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups to export PDF"); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:'Spectral',Georgia,serif;max-width:720px;margin:48px auto;padding:0 24px;color:#2c2c2c;line-height:1.6}
    h1,h2,h3{font-family:'Cormorant Garamond',Georgia,serif}blockquote{border-left:3px solid #B89C5A;padding-left:1rem;color:#555;font-style:italic}
    code{background:#f0ece3;padding:2px 5px;border-radius:4px}</style></head>
    <body>${md(markdown)}<script>window.onload=()=>{window.print()}<\/script></body></html>`);
  w.document.close();
  toast("Opening print dialog…");
}
function exportDocx(safe, markdown) {
  // Minimal Word-openable HTML wrapped as .doc (opens cleanly in Word/Docs).
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset='utf-8'><style>body{font-family:Georgia,serif;line-height:1.5}</style></head><body>${md(markdown)}</body></html>`;
  download(`${safe}.doc`, html, "application/msword");
  toast("Exported (opens in Word)");
}

/* ---- Formatting ---- */
export function relDate(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export const initials = (name = "?") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
