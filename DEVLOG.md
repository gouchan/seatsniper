# SeatSniper Dev Log

> **Purpose:** Session memory for Claude Code. Read this first every time we work on SeatSniper.
> Updated after every session and pushed to GitHub.

---

## CURRENT STATE (as of 2026-02-01)

### What runs right now
- `npm run build` compiles (tsup bundles 130KB ESM) but `npx tsc --noEmit` shows **35 pre-existing type errors**
- `npm start` initializes adapters + notifiers, logs "MVP ready!", then **does nothing** (monitoring loop is a TODO)
- Docker Compose starts Postgres+TimescaleDB and Redis successfully
- No tests exist (Vitest configured, zero test files)

### What actually works (individually, not end-to-end)
| Component | Status | Notes |
|-----------|--------|-------|
| StubHub adapter | Works | OAuth 2.0, search events, get listings |
| Ticketmaster adapter | Works | API key, Discovery API, listings |
| SeatGeek adapter | Works | Events, listings, venue seat maps |
| Value Engine | Works | 5-component weighted scoring algorithm |
| Rate limiter | Fixed | Was racy, now serialized via queue (2026-01-31) |
| Circuit breaker | Fixed | Timeout moved inside retry (2026-01-31) |
| Telegram notifier | **BROKEN** | MarkdownV2 double-escaping — every message parse-errors (C6) |
| SMS notifier | Untested | Twilio SDK wired, should work |
| WhatsApp notifier | Untested | Twilio SDK wired, should work |
| Seat map service | Partial | URL fetch works, local images missing |
| Database integration | **NOT STARTED** | Schema exists, zero code reads/writes DB |
| Redis cache | **NOT STARTED** | Configured in Docker, zero code uses it |
| Monitoring loop | **NOT STARTED** | TODO comment in index.ts |
| Alert dedup | **NOT STARTED** | DB columns exist, no logic |

### What DOESN'T work (blocking MVP)
1. **No monitoring loop** — app initializes then idles forever
2. **Telegram alerts broken** — double-escaped MarkdownV2 (C6)
3. **35 TypeScript errors** — blocks clean `tsc` (build works via tsup which skips type checking)
4. **No DB integration** — can't persist events, listings, or price history
5. **No alert deduplication** — would spam users on every poll cycle

---

## WHAT WAS DONE EACH SESSION

### Session: 2026-01-31 — Concurrency Fixes
**PR:** https://github.com/gouchan/seatsniper/pull/1 (merged)
**Changes (6 files, +158/-51):**
- **rate-limiter.ts** — Fixed H9: serialized `drainQueue()` replaces racy acquire pattern. Token count can no longer go negative.
- **stubhub.adapter.ts** — Fixed C5: added `refreshPromise` for single-flight OAuth token refresh.
- **circuit-breaker.ts** — Fixed H8: moved timeout inside retry policy so each attempt gets full budget.
- **seatgeek.adapter.ts** — Fixed M6+M7: added `RateLimiter`, wrapped `getVenueSeatMapUrl()` and `findVenue()` through resilience policy.
- **seat-map.service.ts** — Fixed M3+H11: LRU eviction with 100MB byte limit replaces unbounded FIFO cache.
- **index.ts** — Fixed H5: added `unhandledRejection`/`uncaughtException` handlers + `SIGINT`/`SIGTERM` graceful shutdown.

**Finding status after session:**
- C5: **FIXED** (OAuth race)
- H5: **FIXED** (unhandled rejection)
- H8: **FIXED** (timeout conflict)
- H9: **FIXED** (rate limiter race)
- H11: **FIXED** (cache eviction)
- M3: **FIXED** (unbounded cache)
- M6: **FIXED** (SeatGeek rate limiter)
- M7: **FIXED** (SeatGeek resilience bypass)

### Session: 2026-01-28 — Security Audit
- Full OWASP + code quality audit across all 32 source files
- Documented 49 findings (6C, 14H, 18M, 11L) in SEATSNIPER.md
- Created GitHub repo, pushed initial code

### Sessions: 2026-01-25 to 2026-01-27 — Initial Build
- Full MVP scaffolding: adapters, value engine, notifications, Docker, migrations
- See SEATSNIPER.md for complete build log

---

## REMAINING AUDIT FINDINGS

### CRITICAL (still open: 5 of 6)
| # | Finding | Status |
|---|---------|--------|
| C1 | SSRF via seat map URL fetching | **OPEN** |
| C2 | Default DB password in Docker | **OPEN** |
| C3 | SeatGeek client secret in URL query params | **OPEN** |
| C4 | SeatGeek error type guard false positive | **OPEN** |
| C5 | OAuth token refresh race condition | **FIXED** (2026-01-31) |
| C6 | Telegram MarkdownV2 double-escaping | **OPEN** — blocks all Telegram alerts |

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

### MEDIUM (still open: 15 of 18)
| # | Status |
|---|--------|
| M1-M2 | OPEN |
| M3 | **FIXED** (2026-01-31) |
| M4-M5 | OPEN |
| M6 | **FIXED** (2026-01-31) |
| M7 | **FIXED** (2026-01-31) |
| M8-M18 | OPEN |

### LOW: All 11 still OPEN

---

## 35 TYPESCRIPT ERRORS (pre-existing, need to fix)

**By root cause:**
1. **`import type` vs `import` for EventCategory** — 21 errors across 3 mapper files. `EventCategory` is imported as a type but used as a runtime value in switch statements.
   - `seatgeek.mapper.ts` (7 errors)
   - `stubhub.mapper.ts` (7 errors)
   - `ticketmaster.mapper.ts` (7 errors)
   - **Fix:** change `import type { EventCategory }` to `import { EventCategory }`

2. **Cockatiel API mismatch** — 5 errors in `circuit-breaker.ts`. Event property names and timeout strategy parameter don't match installed version.
   - `retry.onGiveUp` event shape: `.reason` doesn't exist
   - `timeout('aggressive')` not a valid parameter
   - **Fix:** check cockatiel v3 API docs, update property names

3. **Untyped `response` from resilience policy** — 7 errors. `policy.execute()` returns `unknown`; adapters access `.data` without type assertion.
   - stubhub.adapter.ts (2), ticketmaster.adapter.ts (3), seatgeek.adapter.ts (2)
   - **Fix:** add `as AxiosResponse` type assertion after `policy.execute()`

4. **Telegraf API change** — 1 error. `disable_web_page_preview` renamed in newer Telegraf.
   - **Fix:** use `link_preview_options: { is_disabled: true }` instead

5. **Unused variable** — 1 error. `MAX_SMS_LENGTH` declared but never read.
   - **Fix:** remove or use it

---

## RECOMMENDED PATH TO MVP

### Easiest path: Telegram bot (no web UI needed)

**Why Telegram over a web UI:**
- Telegram bot is already 80% built (just needs the escaping fix)
- No auth system needed (Telegram handles identity)
- No hosting/domain/SSL needed for a frontend
- Push notifications are native (Telegram sends them)
- Users interact via bot commands (/watch, /alerts, /stop)
- Can always add a web dashboard later

### MVP definition: "it just works"
1. User talks to Telegram bot, says "watch Trail Blazers games"
2. SeatSniper polls StubHub + Ticketmaster + SeatGeek every 2-10 minutes
3. Value Engine scores each listing
4. If score > 70, send Telegram alert with price, section, score, buy link
5. Don't spam — 30-minute cooldown per event per user

### What needs to happen (in order)
1. **Fix 35 TypeScript errors** (~30 min) — unblocks clean builds
2. **Fix Telegram double-escaping** (C6) (~15 min) — unblocks alerts
3. **Build the monitoring loop** (~2-3 hrs) — the core missing piece
4. **Add basic Telegram bot commands** (~1-2 hrs) — /start, /watch, /alerts, /stop
5. **Wire up PostgreSQL** (~1-2 hrs) — persist events, listings, subscriptions
6. **Add alert deduplication** (~30 min) — check last_alert_at before sending

### What can wait
- Redis caching (nice to have, not MVP)
- SMS/WhatsApp (Telegram is enough for v1)
- Seat map images (text alerts work fine)
- Web UI (Telegram IS the UI)
- SSRF protection (no public-facing server yet)
- Docker production hardening

---

## ARCHITECTURE REFERENCE

```
User ←→ Telegram Bot
              │
              ▼
     ┌─ SeatSniperApp ──────────────────────────┐
     │                                            │
     │  MonitoringLoop (TODO - core missing piece) │
     │    │                                        │
     │    ├── Poll: StubHub adapter                │
     │    ├── Poll: Ticketmaster adapter            │
     │    ├── Poll: SeatGeek adapter                │
     │    │                                        │
     │    ├── Score: ValueEngine                    │
     │    │                                        │
     │    ├── Dedup: check last_alert_at (TODO)     │
     │    │                                        │
     │    └── Alert: TelegramNotifier               │
     │                                             │
     │  PostgreSQL: events, listings, subscriptions │
     │  Redis: cache (future)                       │
     └─────────────────────────────────────────────┘
```

---

## ENV VARS NEEDED

```bash
# Platform APIs
STUBHUB_CLIENT_ID=
STUBHUB_CLIENT_SECRET=
TICKETMASTER_API_KEY=
SEATGEEK_CLIENT_ID=
SEATGEEK_CLIENT_SECRET=     # optional

# Notifications
TELEGRAM_BOT_TOKEN=          # from @BotFather
TELEGRAM_CHAT_ID=            # your chat ID

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=seatsniper
DB_USER=seatsniper
DB_PASSWORD=                 # set a real password

# Redis
REDIS_URL=redis://localhost:6379
```

---

## FILE MAP (key files for each session)

| What | Files |
|------|-------|
| Entry point | `src/index.ts` |
| Config | `src/config/index.ts` |
| StubHub | `src/adapters/stubhub/stubhub.adapter.ts`, `.mapper.ts`, `.types.ts` |
| Ticketmaster | `src/adapters/ticketmaster/ticketmaster.adapter.ts`, `.mapper.ts`, `.types.ts` |
| SeatGeek | `src/adapters/seatgeek/seatgeek.adapter.ts`, `.mapper.ts`, `.types.ts` |
| Resilience | `src/adapters/base/circuit-breaker.ts` |
| Value Engine | `src/services/value-engine/value-engine.service.ts` |
| Scoring | `src/services/value-engine/scoring/*.ts` |
| Telegram | `src/notifications/telegram/telegram.notifier.ts`, `telegram.formatter.ts` |
| SMS | `src/notifications/twilio/sms.notifier.ts`, `sms.formatter.ts` |
| Rate limiter | `src/utils/rate-limiter.ts` |
| DB schema | `src/data/migrations/001_initial_schema.sql` |
| Docker | `docker/docker-compose.yml` |
| This file | `DEVLOG.md` |
| Full audit | `SEATSNIPER.md` |
