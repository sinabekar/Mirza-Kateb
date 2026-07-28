# MirzaKateb — میرزا کاتب

> A calm, minimal AI voice workspace that turns recordings into structured knowledge — not just transcription.

MirzaKateb ("Mirza" + "Kateb" — the scribe) is a **fully client-side** voice workspace inspired by old Persian scribes and Japanese minimalism. Record or upload audio, ask the AI to do something with it (summarise, extract action items, write minutes, draft an email…), and build a searchable, per-workspace knowledge base you can ask questions of.

Because it runs entirely in the browser, it deploys to **GitHub Pages** with no server and no secrets.

---

## ✨ Features

| Area | What it does |
|------|--------------|
| **Auth** | Email + Google (demo) sign-in with a local profile |
| **Dashboard** | Sessions with title, date, duration, workspace, tags, AI status, favourites |
| **Voice input** | Record (pause / resume / stop) **or** upload MP3 / WAV / M4A, with a live & static **waveform** |
| **AI prompt** | Ten ready tasks (summary, action items, minutes, blog, LinkedIn, email, decisions, to-do…) + custom instructions |
| **AI processing** | Abstracted **service layer** — Demo provider (offline) or **Gemini** (your key) with zero UI changes |
| **Output** | Rich formatted text · copy · edit · regenerate · **version history** · export **TXT / Markdown / PDF / Word** |
| **History** | Every session stored locally: audio meta, transcript, outputs, prompt, tags, metadata |
| **Ask Memory** | Per-workspace chat that answers from previous meetings, with citations |
| **Workspaces** | Unlimited workspaces (Personal, Company, Startup…), each with independent memory |
| **Search** | Global search across transcripts, summaries, action items, titles & tags |
| **Action items** | Auto-extracted task / owner / deadline / priority / status — fully editable |
| **Settings** | Language · dark mode · AI provider · export defaults · recording quality |

## 🎨 Design

Japanese minimalism meets Persian elegance — warm paper, calm ink, soft shadows, generous whitespace. No glow, no glassmorphism, no neon.

- Warm white `#FAF8F4` · Charcoal `#2C2C2C` · Dark olive `#556052` · Muted gold `#B89C5A`
- Display type: *Cormorant Garamond* · Body: *Spectral*

## 🤖 AI providers

The app talks only to a small **service layer** (`assets/js/ai.js`), so the backend is swappable:

- **Demo (offline)** — default. Deterministic, structured output from the transcript. No key, works instantly.
- **Gemini** — go to **Settings → AI Provider**, pick *Google Gemini*, and paste your own key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The key is stored in your browser and used to call Google directly (there is no server on GitHub Pages that could hold it).

Adding another provider (OpenAI, a self-hosted model, etc.) means implementing one object with `run` / `chat` / `extractActions` — no UI changes.

## 🚀 Run it on GitHub Pages

This repo ships a workflow at `.github/workflows/deploy.yml` that publishes the site.

1. Push this branch (or merge to `main`).
2. In the repo, go to **Settings → Pages** and set **Source: GitHub Actions**.
3. The **Deploy to GitHub Pages** workflow runs automatically and prints the live URL (e.g. `https://<user>.github.io/<repo>/`).

The workflow triggers on pushes to `main` and to the working branch, and can also be run manually via **Actions → Deploy to GitHub Pages → Run workflow**.

### Run locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Opening `index.html` directly via `file://` won't work because the app uses ES modules — use a local server.

## 🗂 Project structure

```
index.html
assets/
  css/app.css          # the whole design system
  js/
    app.js             # bootstrap + hash router
    store.js           # state, persisted to localStorage
    ai.js              # AI service layer (Demo + Gemini providers)
    audio.js           # recording + waveform rendering
    ui.js              # markdown, icons, toast, modal, exports
    layout.js          # sidebar / workspace switcher / topbar
    views/             # auth, dashboard, record, session, chat, search, actions, settings
```

## Privacy

Everything — profile, workspaces, sessions, transcripts — lives in your browser's `localStorage`. Nothing is uploaded anywhere. Your Gemini key (if you add one) is used only for direct browser-to-Google API calls.
