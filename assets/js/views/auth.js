/* ============================================================
   auth.js — Email + Google (demo) login and profile.
   Login is local-only (no backend on Pages); it establishes a
   profile stored in localStorage so the workspace feels personal.
   ============================================================ */

import { store } from "../store.js";
import { el, esc, toast } from "../ui.js";
import { go } from "../app.js";

export function authView() {
  const root = el(`<div class="auth-wrap">
    <div class="auth-art">
      <div>
        <div class="eyebrow" style="color:rgba(250,248,244,.7)">The Scribe's Workspace</div>
        <h1>Turn your voice into knowledge.</h1>
        <p>MirzaKateb listens, remembers, and writes — a calm, timeless workspace for meetings, ideas, and everything worth keeping.</p>
      </div>
      <p style="font-size:.85rem">میرزا کاتب · a place for careful words</p>
      <div class="qmark">م</div>
    </div>
    <div class="auth-panel">
      <div class="auth-card">
        <div class="brand" style="padding-left:0"><div class="brand-mark">م</div>
          <div><div class="brand-name">MirzaKateb</div><div class="brand-sub">Voice Workspace</div></div></div>
        <h2 id="authTitle" style="margin:1rem 0 .3rem">Welcome back</h2>
        <p class="muted" style="margin-bottom:1.4rem">Sign in to your workspace.</p>

        <button class="btn oauth-btn" id="googleBtn">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-7.9z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.6-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.4 9.1 5.4 12 5.4z"/></svg>
          Continue with Google
        </button>

        <div class="auth-sep">or</div>

        <form id="emailForm">
          <div class="field"><label>Name</label><input type="text" id="name" placeholder="Your name" value="Mirza" /></div>
          <div class="field"><label>Email</label><input type="email" id="email" placeholder="you@example.com" required /></div>
          <div class="field" id="pwField"><label>Password</label><input type="password" id="password" placeholder="••••••••" /></div>
          <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:.4rem" id="submitBtn">Sign in</button>
        </form>
        <p class="center muted" style="margin-top:1.2rem;font-size:.88rem">
          <span id="toggleMode" style="cursor:pointer;color:var(--olive)">New here? Create an account</span>
        </p>
        <p class="center muted" style="font-size:.78rem;margin-top:.4rem">No server involved — your profile stays in this browser.</p>
      </div>
    </div>
  </div>`);

  let signup = false;
  const preset = store.get().user;
  if (preset) root.querySelector("#email").value = preset.email;

  root.querySelector("#toggleMode").onclick = () => {
    signup = !signup;
    root.querySelector("#authTitle").textContent = signup ? "Create your account" : "Welcome back";
    root.querySelector("#submitBtn").textContent = signup ? "Create account" : "Sign in";
    root.querySelector("#toggleMode").textContent = signup ? "Already have an account? Sign in" : "New here? Create an account";
  };

  root.querySelector("#googleBtn").onclick = () => {
    doLogin({ name: "Mirza Kateb", email: "mirza@mirzakateb.app", provider: "google" });
  };

  root.querySelector("#emailForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = root.querySelector("#name").value.trim() || "Mirza";
    const email = root.querySelector("#email").value.trim();
    if (!email) return;
    doLogin({ name, email, provider: "email" });
  });

  return root;
}

function doLogin(user) {
  store.login({ ...user, since: Date.now() });
  toast(`Signed in as ${user.name}`);
  go("");
}
