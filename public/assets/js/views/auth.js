/* ============================================================
   auth.js — real email/password auth against the backend.
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

        <form id="authForm">
          <div class="field" id="nameField" style="display:none"><label>Name</label><input type="text" id="name" placeholder="Your name" autocomplete="name" /></div>
          <div class="field"><label id="emailLabel">Email</label><input type="text" id="email" placeholder="you@example.com" autocomplete="username" inputmode="email" required /></div>
          <div class="field"><label>Password</label><input type="password" id="password" placeholder="••••••••" autocomplete="current-password" required /></div>
          <div id="authError" class="banner" style="display:none;background:rgba(166,84,63,.1);border-color:rgba(166,84,63,.35);margin-bottom:1rem"></div>
          <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:.2rem" id="submitBtn">Sign in</button>
        </form>
        <p class="center muted" style="margin-top:1.2rem;font-size:.88rem">
          <span id="toggleMode" style="cursor:pointer;color:var(--olive)">New here? Create an account</span>
        </p>
      </div>
    </div>
  </div>`);

  let signup = false;
  const nameField = root.querySelector("#nameField");
  const errBox = root.querySelector("#authError");
  const submit = root.querySelector("#submitBtn");

  root.querySelector("#toggleMode").onclick = () => {
    signup = !signup;
    root.querySelector("#authTitle").textContent = signup ? "Create your account" : "Welcome back";
    submit.textContent = signup ? "Create account" : "Sign in";
    root.querySelector("#toggleMode").textContent = signup ? "Already have an account? Sign in" : "New here? Create an account";
    nameField.style.display = signup ? "block" : "none";
    root.querySelector("#password").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    errBox.style.display = "none";
  };

  root.querySelector("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.style.display = "none";
    const name = root.querySelector("#name").value.trim();
    const email = root.querySelector("#email").value.trim();
    const password = root.querySelector("#password").value;
    submit.disabled = true; submit.textContent = signup ? "Creating…" : "Signing in…";
    try {
      const user = signup ? await store.register({ name, email, password }) : await store.login({ email, password });
      toast(`Welcome, ${user.name}`);
      go(store.isAdmin() ? "admin" : "");
    } catch (err) {
      errBox.textContent = "⚠ " + err.message; errBox.style.display = "flex";
      submit.disabled = false; submit.textContent = signup ? "Create account" : "Sign in";
    }
  });

  return root;
}
