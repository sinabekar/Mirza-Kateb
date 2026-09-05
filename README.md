# MirzaKateb — میرزا کاتب

> A calm, minimal AI voice workspace that turns recordings into structured knowledge — with real accounts, server-side storage, and an admin panel.

MirzaKateb ("Mirza" + "Kateb" — the scribe) is a full-stack web app inspired by old Persian scribes and Japanese minimalism. Users sign up, record or upload audio, and the server transcribes it (OpenAI Whisper) and turns it into summaries, minutes, action items, and more (GPT). Everything — accounts, audio, transcripts, outputs — is stored on the server, so users get it all back the next time they log in.

## Architecture

```
├── public/               # Frontend SPA (vanilla ES modules, no build step)
│   ├── index.html
│   └── assets/{css,js}/…
├── server/               # Node.js + Express API
│   ├── server.js         # routes: auth, sessions, chat, admin, static
│   ├── db.js             # SQLite schema + queries (better-sqlite3)
│   ├── auth.js           # JWT-in-httpOnly-cookie, bcrypt
│   ├── ai.js             # OpenAI: Whisper transcription + GPT tasks
│   ├── .env.example
│   └── data/             # (gitignored) SQLite db + uploaded audio
└── Dockerfile            # single-container production image
```

- **Backend:** Node.js + Express, **SQLite** (`better-sqlite3`) — zero external services.
- **Auth:** email + password, **bcrypt** hashes, signed **JWT in an httpOnly cookie**.
- **Storage:** audio files on disk under `server/data/uploads/`, referenced from the DB; streamed back only to the authenticated owner. Transcripts, outputs, action items and chat history live in SQLite.
- **AI:** **OpenAI only**, key kept **server-side in `.env`** (never in the browser). Base URL is configurable, so any OpenAI-compatible gateway (AvalAI, OpenRouter, Groq, a local server) works too.
- **Frontend:** the same calm SPA (Vazirmatn type, warm-paper palette), now talking to the API.

## Features

| Area | What it does |
|------|--------------|
| **Accounts** | Register / login, bcrypt passwords, 30-day session cookie |
| **Dashboard** | Your sessions — title, date, duration, tags, AI status, favourites, search |
| **Voice input** | Record (pause/resume/stop) or upload MP3/WAV/M4A, with waveform. **Audio is uploaded & saved before any processing**, so a transcription hiccup never loses your recording |
| **AI** | Server-side transcription (Whisper) → summary / minutes / action items / blog / email / … (GPT); copy, edit, regenerate, version history, export TXT/MD/PDF/Word |
| **History** | Every session persisted server-side and restored on next login |
| **Ask Memory** | Per-workspace chat answered from your stored transcripts, with citations |
| **Workspaces** | Unlimited, each with independent memory |
| **Search** | Across transcripts, summaries, action items, titles, tags |
| **Action items** | Auto-extracted (task / owner / deadline / priority / status), editable |
| **Admin panel** | Sign in as the admin to see all users, their recordings, and activity |
| **Mobile** | Responsive layout, RTL Persian rendering |

## Run it

### 1. Configure
```bash
cd server
cp .env.example .env
# edit .env — set OPENAI_API_KEY, a long JWT_SECRET, and (optionally) admin creds
npm install
```

`.env` keys:

| Key | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | **required** — transcription + text tasks |
| `OPENAI_BASE_URL` | optional gateway (e.g. `https://api.avalai.ir/v1`) |
| `OPENAI_MODEL` | text model (default `gpt-4o-mini`) |
| `OPENAI_TRANSCRIBE_MODEL` | speech model (default `whisper-1`) |
| `JWT_SECRET` | sign session cookies — use a long random string |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin login (default `admin` / `admin1245@`) |
| `NODE_ENV=production` | enables Secure cookies (use behind HTTPS) |
| `DATA_DIR` | where the db + audio live (default `server/data`) |

### 2. Start
```bash
npm start          # http://localhost:3000  (serves the API and the frontend)
```

### 3. Admin
Open the app, sign in with your `ADMIN_EMAIL` / `ADMIN_PASSWORD` (default **admin / admin1245@**) → the **Admin Panel** appears in the sidebar. **Change the admin password in `.env` before going live.**

## Deploy (production)

**Docker (simplest):**
```bash
docker build -t mirzakateb .
docker run -d -p 3000:3000 --env-file server/.env -v mk_data:/data mirzakateb
```
The `-v mk_data:/data` volume keeps the database and uploaded audio across restarts (the image sets `DATA_DIR=/data`).

**Bare server:** `npm ci --omit=dev` in `server/`, run `node server.js` behind a reverse proxy (nginx/Caddy) that terminates TLS, and set `NODE_ENV=production`. Put the repo in a **private** GitHub repository — the code contains no secrets (they live in the un-committed `.env`), but private is the right default for your product.

## Security notes
- Secrets live only in `server/.env` (gitignored). No API keys are ever sent to the browser.
- Passwords are bcrypt-hashed; auth is a signed httpOnly cookie (`Secure` in production).
- Audio and data are scoped per user; the admin role is required for `/api/admin/*`.
- Change `JWT_SECRET` and the admin password before deploying.
