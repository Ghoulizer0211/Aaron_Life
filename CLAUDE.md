# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server only (port 5173) — no API
npm run server     # Express server only (port 3001)
npm run start      # Both concurrently (use this for full local dev)
npm run build      # Production build → dist/
npm run lint       # ESLint
npm run preview    # Preview production build
```

There are no automated tests.

## Architecture

**Personal life dashboard PWA** — React + Vite frontend, dual backend (Express for local/self-hosted, Vercel serverless for production), Supabase (PostgreSQL) as the database.

### Dual-backend pattern
Every API route exists **twice**:
- `api/<name>.js` — Vercel serverless function (production)
- `server/index.js` — Express route handler (development / self-hosted)

Both must be kept in sync when adding or changing API behavior. Shared logic lives in `api/_lib/` (imported by the Vercel functions); the Express server duplicates this logic inline.

During dev, Vite proxies `/api/*` → `http://localhost:3001` (configured in `vite.config.js`).

### Frontend structure
`src/App.jsx` is the shell: PIN/biometric lock screen, tab routing (Schedule / Health / Finance / Settings), and a 15-minute inactivity auto-lock. Each tab is a single large page component in `src/pages/` with a co-located CSS file.

**Health.jsx** is the most complex page — contains multiple sub-components defined in the same file:
- `WeekStrip` — navigable week view with workout status dots and mini-calendar dropdown
- `GymTab` — LOG / PLANS subtabs
- `GymLogView` — date-centric workout logging
- `PlanForm` — create/edit workout plans with drag-to-reorder exercises (transform-based, no DOM reorder during drag)
- `ExerciseCard` — collapsible inline set/rep logging
- `PlanDayLogger` / `CustomLogger` — workout session entry forms

### Styling
Plain CSS files co-located with components. No CSS framework. Dark cyberpunk theme with CSS variables: `--accent` (cyan `#00e5ff`), `--green` (`#00ff9d`), `--red` (`#ff3864`), `--text-primary`, `--text-muted`, `--border`, `--bg-card`. Google Fonts: Exo 2 (body) + Orbitron (headings).

### Integrations
| Service | Purpose | Auth |
|---------|---------|------|
| Teller | Bank account sync (balances + transactions) | mTLS cert in `teller/` + access tokens in Supabase `bank_connections` |
| SnapTrade | Investment account balances | SDK, credentials in `.env` |
| Oura | Sleep, readiness, activity scores | Bearer token via `VITE_OURA_ACCESS_TOKEN` env var |
| Supabase | Database + PIN hash sync | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |

### Supabase tables
`bank_connections`, `bank_accounts`, `bank_transactions`, `balance_snapshots`, `gym_workouts`, `workout_logs`, `workout_plans`, `workout_days`, `workout_exercises`, `exercise_logs`. Full schema in `supabase_schema.sql`.

### Teller sync strategy
- **Incremental** (`GET /api/teller/sync`) — used by Vercel cron and UI refresh; reads existing accounts from Supabase, fetches only new transactions since `last_synced_at`, batched 4 accounts at a time to avoid rate limits.
- **Full** (`POST /api/teller/enroll`) — runs only on new enrollment; fetches all accounts and all transactions from 2026-01-01.

### Dates
All date strings use Pacific Time (`America/Los_Angeles`). The canonical way to get today's date string throughout the codebase is:
```js
new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
// returns 'YYYY-MM-DD'
```

### Security
- PIN stored as a hash, synced across devices via Supabase
- Teller access tokens stored encrypted (AES-256-GCM) in `server/tokens.json` for local dev; in Supabase `bank_connections.access_token` for production
- CSP headers defined in `vercel.json`; must be updated when adding new external domains
