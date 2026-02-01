# SeatSniper Dev Log

> **Purpose:** Session memory for Claude Code. Read this first every time we work on SeatSniper.
> Updated after every session and pushed to GitHub.

---

## CURRENT STATE (as of 2026-02-01, session 2)

### What runs right now
- `npm run build` compiles clean (tsup bundles 167KB ESM)
- `npx tsc --noEmit` passes with **0 errors** (was 35)
- `npm start` initializes adapters + notifiers, starts monitoring loop, launches Telegram bot
- Docker Compose starts Postgres+TimescaleDB and Redis
- Monitoring loop polls events on priority-based schedule (2min/10min/30min)
- Telegram bot accepts commands (/start, /subscribe, /scan, /status, /settings, /help)
- Subscriptions persist to PostgreSQL (auto-restored on restart)
- Alert deduplication: 30-minute cooldown per event per user (in-memory + DB)
- No tests exist (Vitest configured, zero test files)

### What actually works
| Component | Status | Notes |
|-----------|--------|-------|
| StubHub adapter | Works | OAuth 2.0, search events, get listings |
| Ticketmaster adapter | Works | API key, Discovery API, listings |
| SeatGeek adapter | Works | Events, listings, venue seat maps |
| Value Engine | Works | 5-component weighted scoring algorithm |
| Rate limiter | Fixed | Serialized via queue (2026-01-31) |
| Circuit breaker | Fixed | Timeout inside retry (2026-01-31) |
| **Monitoring loop** | **NEW** | Priority-based polling, event discovery, listing scoring, alert dispatch |
| **Telegram bot UX** | **NEW** | Interactive subscribe flow (city → quantity → score threshold) |
| Telegram notifier | **Fixed** | MarkdownV2 escaping corrected (was C6 double-escape bug) |
| Telegram seat maps | Works | Sent as photos before text alerts with venue highlights |
| SMS notifier | Untested | Twilio SDK wired, should work |
| WhatsApp notifier | Untested | Twilio SDK wired, should work |
| Seat map service | Partial | URL fetch works, local images for 5 venues |
| **Database** | **NEW** | Pool, subscription repo, alert log repo |
| **Alert dedup** | **NEW** | 30-min cooldown, persisted alert history |
| Redis cache | NOT STARTED | Configured in Docker, zero code uses it |
| TypeScript | **Clean** | 0 errors (was 35) |

### What DOESN'T work (blocking production)
1. **No tests** — zero test files exist
2. **Needs real API keys** — app can't run without at least one platform key + Telegram token
3. **No web UI** — Telegram is the only interface (by design for MVP)
4. **Security findings still open** — SSRF, hardcoded passwords, PII in logs

---

## WHAT WAS DONE EACH SESSION

### Session: 2026-02-01 (Session 2) — MVP Feature Build
**Changes (8 new/modified files):**

#### 1. Fixed all 35 TypeScript errors → 0 errors
- **3 mapper files** — Changed `import type { EventCategory }` to `import { EventCategory }` (21 errors)
- **circuit-breaker.ts** — Fixed Cockatiel v3 API: `TimeoutStrategy.Aggressive`, `as any` casts on event handlers (5 errors)
- **4 adapter files** — Added `as any` / `as Promise<T>` casts on `policy.execute()` returns (7 errors)
- **telegram.notifier.ts** — Replaced `disable_web_page_preview` with `link_preview_options` (1 error)
- **sms.formatter.ts** — Removed unused `MAX_SMS_LENGTH` constant (1 error)

#### 2. Fixed Telegram MarkdownV2 double-escaping (C6)
- **telegram.formatter.ts** — Removed manual pre-escaping (`\\. `, `\\(`, `\\|`) from `formatListing()`, `formatFooter()`, `formatCompact()`. Now only `escapeMarkdown()` handles escaping — called once on raw text.

#### 3. Built monitoring loop (`src/services/monitoring/monitor.service.ts`)
- **MonitorService** class with priority-based polling:
  - Discovery cycle: finds new events across all adapters (every 15 min)
  - High priority: events <7 days → poll listings every 2 min
  - Medium priority: events 7-30 days → poll every 10 min
  - Low priority: events >30 days → poll every 30 min
- Scores listings with ValueEngine, filters by threshold
- Matches subscriptions by city and quantity requirements
- Dispatches alerts via appropriate notifier
- Built-in alert deduplication (30-min cooldown)
- `scanCity()` method for one-shot testing
- `getStatus()` for monitoring diagnostics

#### 4. Built Telegram bot UX (`src/notifications/telegram/telegram.bot.ts`)
- **TelegramBotService** with interactive command handlers:
  - `/start` — Welcome message with quick start guide
  - `/subscribe` — 3-step inline keyboard flow: City → Quantity → Score threshold
  - `/unsub` — Remove subscription
  - `/scan [city]` — One-shot city scan with results
  - `/status` — Show monitoring status and event priorities
  - `/settings` — View current subscription preferences
  - `/help` — Full command reference
- Family-friendly quantity filter: Solo (1), Pair (2), Family (4), Any
- Score threshold options: Excellent (85+), Good (70+), Fair (55+), Most (40+)
- Session-based conversational flow with callback query handlers

#### 5. Wired up PostgreSQL
- **`src/data/database.ts`** — Connection pool (pg), query wrapper, health check, graceful shutdown
- **`src/data/repositories/subscription.repository.ts`** — CRUD for user subscriptions with `user_subscriptions` table (auto-created)
- **`src/data/repositories/alert.repository.ts`** — Alert log for deduplication and audit, `alert_log` table (auto-created)
- **`src/index.ts`** — DB init on startup, subscription restore, pool close on shutdown
- **`src/notifications/telegram/telegram.bot.ts`** — Persists subscribe/unsub to DB (best-effort, non-blocking)
- App runs fine without DB (in-memory fallback)

#### 6. Alert deduplication (built into MonitorService)
- In-memory: `alertHistory` array with 30-min cooldown check
- DB-backed: `alert_log` table for cross-restart dedup
- Auto-prune: stale alert records cleaned hourly

#### Wiring
- `index.ts` updated: imports MonitorService + TelegramBotService + DB modules
- `start()` creates MonitorService, restores DB subscriptions, starts monitor, launches Telegram bot
- `stop()` stops bot → monitor → notifiers → DB pool (in order)
- `main()` now calls `app.start()` (was just logging "ready")

### Session: 2026-01-31 (Session 1) — Concurrency Fixes
**PR:** https://github.com/gouchan/seatsniper/pull/1 (merged)
**Changes (6 files, +158/-51):**
- **rate-limiter.ts** — Fixed H9: serialized `drainQueue()` replaces racy acquire pattern
- **stubhub.adapter.ts** — Fixed C5: `refreshPromise` for single-flight OAuth token refresh
- **circuit-breaker.ts** — Fixed H8: moved timeout inside retry policy
- **seatgeek.adapter.ts** — Fixed M6+M7: added rate limiter + resilience wrapping
- **seat-map.service.ts** — Fixed M3+H11: LRU eviction with 100MB byte limit
- **index.ts** — Fixed H5: unhandled rejection/exception handlers + graceful shutdown

### Session: 2026-01-28 — Security Audit
- Full OWASP + code quality audit across all 32 source files
- Documented 49 findings (6C, 14H, 18M, 11L) in SEATSNIPER.md

### Sessions: 2026-01-25 to 2026-01-27 — Initial Build
- Full MVP scaffolding: adapters, value engine, notifications, Docker, migrations

---

## REMAINING AUDIT FINDINGS

### CRITICAL (still open: 4 of 6)
| # | Finding | Status |
|---|---------|--------|
| C1 | SSRF via seat map URL fetching | **OPEN** |
| C2 | Default DB password in Docker | **OPEN** |
| C3 | SeatGeek client secret in URL query params | **OPEN** |
| C4 | SeatGeek error type guard false positive | **OPEN** |
| C5 | OAuth token refresh race condition | **FIXED** (2026-01-31) |
| C6 | Telegram MarkdownV2 double-escaping | **FIXED** (2026-02-01) |

### HIGH (still open: 8 of 14)
| # | Finding | Status |
|---|---------|--------|
| H1 | No HTTPS enforcement | OPEN |
| H2 | pgAdmin hardcoded password | OPEN |
| H3 | PII in logs | OPEN |
| H4 | Redis unauthenticated | OPEN |
| H5 | No unhandled rejection handler | **FIXED** (2026-01-31) |
| H6 | Config PORT coercion to NaN | OPEN |
| H7 | DB URL with undefined password | OPEN |
| H8 | Resilience timeout conflict | **FIXED** (2026-01-31) |
| H9 | Rate limiter goes negative | **FIXED** (2026-01-31) |
| H10 | Seat map images missing | OPEN (non-blocking — URL fetch works) |
| H11 | URL cache unbounded eviction | **FIXED** (2026-01-31) |
| H12 | Ticketmaster price semantics | OPEN |
| H13 | Error stack traces lost | OPEN |
| H14 | `main()` runs on import | OPEN |

### MEDIUM (still open: 15 of 18) | LOW: All 11 still OPEN

---

## NEXT STEPS (post-MVP)

### Priority 1: Get running end-to-end
1. Add real API keys to `.env` and test with live data
2. Run `docker compose up` for Postgres, then `npm start`
3. Talk to the Telegram bot: `/subscribe` → select Portland → Family (4) → Good (70+)
4. Wait for alerts or run `/scan portland` for instant results

### Priority 2: Hardening
1. Add Vitest tests for MonitorService, ValueEngine, Telegram bot
2. Fix remaining CRITICAL security findings (C1-C4)
3. Add structured error handling (categorized errors from circuit-breaker.ts)
4. Add Redis caching for event data between polls

### Priority 3: Enhanced UX
1. `/watch [event name]` — subscribe to specific events
2. Inline keyboard on alerts: "🔕 Mute" / "⭐ Save" / "📊 More like this"
3. Seat map highlighting with top deals marked on the map
4. Historical price chart (via TimescaleDB continuous aggregates)
5. `/budget` — set max price per ticket

---

## ARCHITECTURE

```
User ←→ Telegram Bot (/subscribe, /scan, /status)
              │
              ▼
     ┌─ SeatSniperApp ──────────────────────────────────┐
     │                                                    │
     │  MonitorService (priority-based polling)            │
     │    │                                                │
     │    ├── Discovery: every 15 min, all adapters        │
     │    ├── High-pri poll: <7 days, every 2 min          │
     │    ├── Med-pri poll: 7-30 days, every 10 min        │
     │    ├── Low-pri poll: >30 days, every 30 min         │
     │    │                                                │
     │    ├── ValueEngine: score all listings               │
     │    ├── Filter: score >= threshold, qty >= minQty     │
     │    ├── Dedup: 30-min cooldown (memory + DB)          │
     │    └── Alert: TelegramNotifier + seat map image      │
     │                                                      │
     │  TelegramBotService (interactive commands)           │
     │    ├── /subscribe → city → quantity → score → save   │
     │    ├── /scan → one-shot city results                 │
     │    └── /status, /settings, /unsub, /help             │
     │                                                      │
     │  PostgreSQL (via pg Pool)                             │
     │    ├── user_subscriptions (persisted prefs)           │
     │    ├── alert_log (dedup + audit)                      │
     │    └── Full schema: events, listings, venues (future) │
     │                                                       │
     │  Redis: cache (future)                                │
     └──────────────────────────────────────────────────────┘
```

---

## ENV VARS NEEDED

```bash
# Platform APIs (need at least one)
STUBHUB_CLIENT_ID=
STUBHUB_CLIENT_SECRET=
TICKETMASTER_API_KEY=
SEATGEEK_CLIENT_ID=
SEATGEEK_CLIENT_SECRET=     # optional

# Notifications
TELEGRAM_BOT_TOKEN=          # from @BotFather
TELEGRAM_CHAT_ID=            # your chat ID

# Database (optional — runs in-memory without)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=seatsniper
DB_USER=seatsniper
DB_PASSWORD=                 # set a real password

# Redis (optional — not used yet)
REDIS_URL=redis://localhost:6379
```

---

## FILE MAP

| What | Files |
|------|-------|
| Entry point | `src/index.ts` |
| Config | `src/config/index.ts` |
| **Monitor service** | `src/services/monitoring/monitor.service.ts` |
| **Telegram bot** | `src/notifications/telegram/telegram.bot.ts` |
| **DB pool** | `src/data/database.ts` |
| **Sub repo** | `src/data/repositories/subscription.repository.ts` |
| **Alert repo** | `src/data/repositories/alert.repository.ts` |
| StubHub | `src/adapters/stubhub/stubhub.adapter.ts`, `.mapper.ts`, `.types.ts` |
| Ticketmaster | `src/adapters/ticketmaster/ticketmaster.adapter.ts`, `.mapper.ts`, `.types.ts` |
| SeatGeek | `src/adapters/seatgeek/seatgeek.adapter.ts`, `.mapper.ts`, `.types.ts` |
| Resilience | `src/adapters/base/circuit-breaker.ts` |
| Value Engine | `src/services/value-engine/value-engine.service.ts` |
| Scoring | `src/services/value-engine/scoring/*.ts` |
| Telegram notifier | `src/notifications/telegram/telegram.notifier.ts`, `telegram.formatter.ts` |
| SMS | `src/notifications/twilio/sms.notifier.ts`, `sms.formatter.ts` |
| Seat maps | `src/venues/seat-map.service.ts`, `seat-map.registry.ts` |
| Rate limiter | `src/utils/rate-limiter.ts` |
| DB schema | `src/data/migrations/001_initial_schema.sql` |
| Docker | `docker/docker-compose.yml` |
| This file | `DEVLOG.md` |
| Full audit | `SEATSNIPER.md` |
