# The Astral Cartographer

Understand an unfamiliar codebase quickly. Import a GitHub repository (or upload a ZIP), and The Astral Cartographer analyses it and shows you:

- **Home** – repository overview, languages, dependency metrics and architectural health.
- **Dependency Atlas** – an interactive 2D map of folders and imports: select files, follow dependencies, trace import chains, isolate modules, see circular dependencies and findings, read the code, fullscreen mode with a repository explorer.
- **Onboarding Pathfinder** – a *Beginner Path* (a step-by-step learning queue built from the repository, with progress saved to your account) and a *Contributor Path* (evidence-based contribution opportunities such as missing tests or circular dependencies, with filters and saving).

Code Explorer, Architectural Health, Reports & Benchmarks and Settings are placeholders for now.

Imports are analysed for JavaScript/TypeScript and Java. Other languages are listed and counted, but their imports are not mapped yet.

## Project structure

```
astral-cartographer/
├── client/   React 18 + Vite + TypeScript (the website)        → http://localhost:5173
├── server/   Express + MongoDB + TypeScript (the analysis API) → http://localhost:5000
└── docs/     design notes
```

The client's dev server forwards every `/api` request to the server on port 5000, so both must run.

## What you need

- **Node.js 20 or newer** (`node -v`)
- **A Supabase project** (free) – used for sign-in
- **A MongoDB database** (free MongoDB Atlas cluster, or a local MongoDB). Optional for a quick try: without it the server uses a temporary in-memory database and everything is lost when it stops.

## Setup

### 1. Get the code

```bash
git clone <this repository's URL>
cd <repository folder>/astral-cartographer
```

### 2. Supabase (sign-in)

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**.
3. **Authentication → URL Configuration**: set **Site URL** to `http://localhost:5173` and add `http://localhost:5173/auth/callback` to **Redirect URLs**.
4. **Authentication → Providers**: email sign-in works by default. To use GitHub or Google sign-in, enable that provider and enter its OAuth app credentials (the provider's callback URL is shown on that page).

### 3. MongoDB

Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas), add a database user, allow your IP address under **Network Access**, and copy the connection string (`mongodb+srv://…`).

### 4. Environment files

Each folder has a `.env.example`. Copy it to `.env` and fill in your values:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

| File | Setting | Value |
|---|---|---|
| `server/.env` | `SUPABASE_URL` | Supabase Project URL |
| `server/.env` | `SUPABASE_ANON_KEY` | Supabase anon / publishable key |
| `server/.env` | `MONGODB_URI` | MongoDB connection string (empty = temporary in-memory database) |
| `client/.env` | `VITE_SUPABASE_URL` | the same Supabase Project URL |
| `client/.env` | `VITE_SUPABASE_PUBLISHABLE_KEY` | the same anon / publishable key |

Optional server settings (`PORT`, `GITHUB_TOKEN`, `CORS_ORIGINS`, …) are explained in `server/.env.example`. A `GITHUB_TOKEN` is recommended if you import many repositories, because GitHub limits anonymous downloads.

`.env` files are ignored by git. Never commit them.

### 5. Install and run

Open two terminals.

**Terminal 1 – server**

```bash
cd astral-cartographer/server
npm install
npm run dev
```

Wait for `Running on http://localhost:5000`. (Opening http://localhost:5000 in a browser shows "Cannot GET /" – that is normal; the server only answers `/api/...`.)

**Terminal 2 – client**

```bash
cd astral-cartographer/client
npm install
npm run dev
```

Open **http://localhost:5173**, sign in, and import a public GitHub repository on the Home page (for example `https://github.com/expressjs/express`). When the analysis finishes, open the Dependency Atlas or the Onboarding Pathfinder.

## Tests and checks

```bash
# server: type check + tests (uses a temporary in-memory MongoDB; the first run downloads it)
cd astral-cartographer/server
npx tsc --noEmit
npm test

# client: type check + production build
cd ../client
npm run build
# client unit tests (run with the server's test runner)
../server/node_modules/.bin/tsx --test tests/*.test.ts
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Server stops with "Authentication is not configured" | `SUPABASE_URL` / `SUPABASE_ANON_KEY` are missing in `server/.env`. |
| Server stops with "Could not connect to MongoDB" | Check `MONGODB_URI`, the database user's password, and that your IP is allowed in MongoDB Atlas → Network Access. |
| `EADDRINUSE: port 5000` | Another program uses port 5000. Stop it, or set `PORT` in `server/.env` and change the proxy port in `client/vite.config.ts` to match. |
| Sign-in redirects fail | Add `http://localhost:5173/auth/callback` to Supabase → Authentication → Redirect URLs. |
| "Could not reach the analysis server" in the app | The server is not running, or not on port 5000. |
| The map or Pathfinder says the analysis has no dependency data | The repository was analysed by an older version. Use **Re-analyze**. |
| Pathfinder says progress is not saved | Restart the server after updating the code. |
| GitHub import fails with a rate-limit message | Wait a while, or add a `GITHUB_TOKEN` to `server/.env`. |

## Notes

- The "AI" panels in the Onboarding Pathfinder answer from the repository analysis only; no AI model is connected, and the panels say so.
- Code previews load files from GitHub at the analysed commit, so they are available for public GitHub repositories (not for ZIP uploads).
