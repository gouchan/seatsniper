# SeatSniper Dev Log

> **Purpose:** Session memory for Claude Code. Read this first every time we work on SeatSniper.
> Updated after every session and pushed to GitHub.

---

## CURRENT STATE (as of 2026-02-05, session 9)

**Completion: ~90%** (up from 82%)

### What runs right now
- `npm run build` compiles clean (tsup bundles 200KB ESM)
- `npx tsc --noEmit` passes with **0 errors**
- `npm test` — **274 tests passing, 0 failures** (Vitest 2.1.9, ~1.3s)
- `npm start` initializes adapters + notifiers, starts monitoring loop, launches Telegram bot
- Docker Compose starts Postgres+TimescaleDB and Redis
- Monitoring loop polls events on priority-based schedule (2min/10min/30min)
- Telegram bot accepts 9 commands (/start, /subscribe, /scan, /status, /settings, /pause, /resume, /unsub, /help)
- Subscribe flow: City (multi-select) → Quantity → Budget → Score threshold (4-step)
- Subscriptions persist to PostgreSQL with pause/resume + budget + user tier
- Alert deduplication: 30-minute cooldown per event per user (in-memory + DB)
- Alert actions: inline buttons on alerts (🔕 Mute Event, 🔄 Refresh)
- **Bot polling fixed** — TelegramBotService always calls `bot.launch()`
- Auto-deactivation when users block the bot (stops wasting API cycles)

### Telegram Bot Commands
| Command | What it does |
|---------|--------------|
| `/start` | Welcome + quick start guide |
| `/subscribe` | 4-step setup: city → qty → budget → score threshold |
| `/scan [city]` | One-shot scan with typing indicator + timeout + buy links |
| `/status` | System status + your personal sub status |
| `/settings` | View your preferences (cities, score, qty, budget, paused) |
| `/pause` | Mute alerts (preserves all settings) |
| `/resume` | Resume alerts |
| `/unsub` | Unsubscribe with confirmation dialog |
| `/help` | Full command reference |

### Telegram Bot Inline Buttons
| Flow | Buttons |
|------|---------|
| `/subscribe` step 1 | City multi-select with ✅ toggles → "All Cities" / "Done (N selected)" |
| `/subscribe` step 2 | 👤 Solo (1) \| 👥 Pair (2) \| 👨‍👩‍👧‍👦 Family (4) \| 🎉 Any |
| `/subscribe` step 3 | 💰 $50 \| $100 \| $200 \| ♾️ No limit |
| `/subscribe` step 4 | 🌟 85+ \| ✨ 70+ (Rec) \| 👍 55+ \| 📊 40+ |
| `/scan` (no arg) | City selection buttons |
| `/unsub` | ❌ Yes, unsubscribe \| ↩️ Keep my alerts |
| **On Alerts** | 🔕 Mute Event \| 🔄 Refresh |

### Potential UX Improvements (Phase 2)
- Main menu persistent buttons: "🔍 Scan" "⚙️ Settings" "📊 Status"
- Quick actions on `/status`: "🔍 Scan Now" "⏸️ Pause" buttons
- Inline edit settings (vs. full re-subscribe)
- Event type filters: "🎵 Concerts" "🏀 Sports" "🎭 Theater"

### What actually works
| Component | Status | Notes |
|-----------|--------|-------|
| **Ticketmaster adapter** | ✅ LIVE | API key configured, 520+ Portland events, 1,100+ Seattle events |
| StubHub adapter | Code ready | OAuth 2.0, requires approval — overkill for MVP |
| SeatGeek adapter | Code ready | Events, listings, seat maps — nice-to-have Phase 2 |
| Value Engine | Works | 5-component weighted scoring algorithm |
| Rate limiter | Fixed | Serialized via queue (2026-01-31) |
| Circuit breaker | Fixed | Timeout inside retry (2026-01-31) |
| Monitoring loop | **Hardened** | Cycle guards, event pruning, parallel discovery, budget + pause filter |
| Telegram bot UX | **Upgraded** | 9 commands, multi-city, budget, pause/resume, mute, confirmations |
| Telegram notifier | **Hardened** | MarkdownV2 fixed, shared Telegraf instance, auto-deactivate on block |
| Telegram seat maps | Works | Sent as photos before text alerts with venue highlights |
| SMS notifier | Untested | Twilio SDK wired, should work |
| WhatsApp notifier | Untested | Twilio SDK wired, should work |
| Seat map service | Partial | URL fetch works, local images for 5 venues |
| Database pool | **Hardened** | connectionString vs host/port precedence fixed |
| Subscription repo | **Upgraded** | +budget, +paused, +userTier, auto-migrate columns |
| Alert repo | **Hardened** | SQL injection in cooldown check fixed |
| Alert dedup | Works | 30-min cooldown, persisted alert history |
| Shutdown | **Hardened** | Double-shutdown guard, signal dedup |
| Redis cache | NOT STARTED | Configured in Docker, zero code uses it |
| TypeScript | **Clean** | 0 errors |
| Test suite | **246 tests** | 11 test files, all passing |

### What DOESN'T work (blocking production)
1. ~~**Needs real API keys**~~ → **DONE: Ticketmaster API working** (2026-02-03)
2. **Telegram bot token** — still need to create bot via @BotFather
3. **No web UI** — Telegram is the only interface (by design for MVP)
4. **Security findings still open** — SSRF, hardcoded passwords, PII in logs

---

## WHAT WAS DONE EACH SESSION

### Session: 2026-02-05 (Session 9) — Cross-Platform Price Comparison

**Completion: 82% → 90%**

#### Features Implemented
1. **Event Matching Service** — Fuzzy matching across Ticketmaster, SeatGeek, and StubHub using Levenshtein distance (>85% similarity), venue aliases, and date/time proximity (±30 min)
2. **Venue Aliases** — 30+ Pacific Northwest venue mappings (Moda Center, Climate Pledge Arena, Lumen Field, Providence Park, Gorge Amphitheatre, etc.)
3. **Price Comparator** — Normalizes section names across platforms and calculates best deals per section with savings percentages
4. **Event Groups Tables** — `event_groups` and `event_group_members` database tables persist cross-platform matches
5. **Alert Enhancement** — Alerts now include `crossPlatformComparison` data when the same event exists on multiple platforms
6. **Telegram Formatter Update** — New `formatAlertWithComparison()` method displays best deals by section

#### Files Created
- `src/services/matching/event-matching.service.ts` — Levenshtein distance, event matching logic
- `src/services/matching/venue-aliases.ts` — PNW venue alias mappings
- `src/services/matching/index.ts` — Module re-exports
- `src/data/repositories/event-group.repository.ts` — Event group CRUD
- `src/services/value-engine/price-comparator.ts` — Cross-platform price comparison

#### Files Modified
- `src/services/monitoring/monitor.service.ts` — Event matching integration, cross-platform comparison in alerts
- `src/notifications/telegram/telegram.formatter.ts` — Comparison formatting methods
- `src/notifications/base/notifier.interface.ts` — AlertPayload.crossPlatformComparison field
- `src/index.ts` — EventGroupRepo table initialization

#### Metrics
- Bundle size: 219KB ESM (up from 200KB)
- Tests: 274 passing (unchanged)
- Build: Clean

---

### Session: 2026-02-05 (Session 8) — Critical Bug Fixes + Historical Pricing

**Completion: 72% → 82%**

#### Bugs Fixed
1. **Search flow crash** — `session` variable undefined in telegram.bot.ts:933 when selecting city in search results
2. **Past events still scored** — Events with negative `daysUntilEvent` now skipped early in `processEvent()`
3. **Alert history lost on restart** — Alert deduplication now persists to PostgreSQL, checks both memory and DB

#### Features Implemented
4. **Historical price tracking** — New `price_history` table + `price-history.repository.ts`. Records price snapshots per section during each poll. Value engine now uses real historical data (was always returning neutral 50 score).
5. **Category/keyword filtering** — Subscription fields `categories[]` and `keywords[]` now actually filter events. Users can subscribe to "Taylor Swift" or "sports only".

#### Files Changed
- `src/notifications/telegram/telegram.bot.ts` — Added missing `session` variable
- `src/services/monitoring/monitor.service.ts` — Past event filter, historical data wiring, alert persistence, category/keyword filtering
- `src/data/repositories/price-history.repository.ts` — NEW: price snapshot storage
- `src/index.ts` — Initialize price history table on startup

#### Remaining for Production
- Test coverage for new code paths (~65% covered)
- StubHub/SeatGeek integration tests
- Circuit breaker/rate limit visibility to users
- Observability/metrics

---

### Session: 2026-02-03 (Session 6) — Ticketmaster API Live!

**Changes:**

#### Ticketmaster API Integration
1. **API Key configured** — Consumer Key from developer.ticketmaster.com now in `.env`
2. **Bug fix: Date format** — Ticketmaster requires `YYYY-MM-DDTHH:mm:ssZ` (NO milliseconds). Fixed regex in adapter:
   - Before: `.replace('.000Z', 'Z')` — only removed `.000`
   - After: `.replace(/\.\d{3}Z$/, 'Z')` — removes any millisecond value
3. **Verified working**: Portland = 520 events, Seattle = 1,102 events discovered

#### Status
- ✅ Ticketmaster adapter fully functional with real API
- ✅ 246 tests still passing
- ⏳ Next: Create Telegram bot token to complete the loop

---

### Session: 2026-02-02 (Session 5) — Test Suite & Sandbox

**Changes (14 new test files + 1 bug fix):**

#### Goal
Build a full test sandbox so we can validate everything works before production — without needing real API keys, a database, or a Telegram token.

#### Infrastructure
1. **vitest.config.ts** — Created configuration with path aliases matching `tsconfig.json` (e.g., `@adapters`, `@services`, `@data`), `v8` coverage provider, 10s timeouts.
2. **Mock Platform Adapter** (`tests/mocks/mock-adapter.ts`) — In-memory adapter implementing `IPlatformAdapter`: configurable events/listings, call tracking, failure injection via `setThrow()`.
3. **Mock Notifier** (`tests/mocks/mock-notifier.ts`) — In-memory notifier implementing `INotifier`: captures all sent alerts, configurable success/failure/throw, recipient validation.
4. **Test Fixtures** (`tests/mocks/fixtures.ts`) — Factory functions: `makeEvent()`, `makeListing()`, `makePremiumListing()`, `makeCheapListing()`, `makeFamilyListing()`, `makeListingBatch()`, `makeSubscription()`, `makeFamilySubscription()`, `makeAlertPayload()`, `makeHistoricalPrices()`.

#### Unit Tests (8 suites, 236 assertions)
5. **ValueEngineService** (17 tests) — Constructor validation, `calculateValueScore()` range/breakdown/recommendation/flags, `scoreListings()` batch, `getTopValuePicks()` sort, `filterByMinScore()`, `calculateAveragePrice()`.
6. **PriceAnalyzer** (24 tests) — `analyze()` linear mapping, `analyzeHistorical()` with decay, `isHistoricalLow()` threshold, `isPriceOutlier()`.
7. **SectionRanker** (26 tests) — Tier-to-score mapping, `getTierFromSectionName()` with keyword inference (floor/vip/pit/lower/upper/balcony/obstructed), numeric heuristics (100s→UPPER_PREMIUM, 200s→MID_TIER, 300s→UPPER_LEVEL), explicit tier map override, `isPremiumSection()`.
8. **RowEvaluator** (26 tests) — `evaluate()` non-linear scoring, `parseRowToRank()` for numeric/letter/double-letter/GA/PIT/invalid, `isFrontRow()`, `estimateTotalRows()`.
9. **ResalePredictor** (12 tests) — `predict()` weighted combination, `estimateROI()` confidence levels, timing sweet spot (7-30 days), input clamping.
10. **MonitorService** (17 tests) — Subscription CRUD, pause/resume, status reporting, `scanCity()` with mock adapter, adapter failure resilience, city filtering.
11. **TelegramFormatter** (30 tests) — `escapeMarkdown()` for all 17 MarkdownV2 special characters, `formatAlert()` content verification, `formatCompact()`.
12. **Subscription Mapper** (7 tests) — Row mapping from snake_case DB fields to camelCase TS types, null handling for optional fields.

#### E2E Dry-Run Test (1 suite, 10 assertions)
13. **Full Pipeline Test** (`tests/e2e/dry-run.test.ts`) — Wires MonitorService with 2 mock adapters (stubhub + ticketmaster) and 1 mock notifier. Tests: discovery→scoring→alerting flow, multi-adapter merging, family seat filtering, adapter failure resilience (one fails, other works), multi-city scanning, notifier error handling, value engine integration (cheap floor beats expensive upper deck).

#### Bug Found & Fixed
14. **`parseRowToRank('GA')` returned 183 instead of 1** — The double-letter regex `^([A-Z])([A-Z])$` matched "GA" before the special case handler could run, computing `26 + 6*26 + 1 = 183`. Fix: moved special case checks (GA, PIT) before letter-based parsing in `row-evaluator.ts`.

#### Test Results
```
Tests: 246 passed, 0 failed (11 test files)
Duration: ~1.3s
```

#### Files Added
```
vitest.config.ts
tests/mocks/mock-adapter.ts
tests/mocks/mock-notifier.ts
tests/mocks/fixtures.ts
tests/unit/value-engine/value-engine.test.ts
tests/unit/value-engine/scoring-components.test.ts
tests/unit/value-engine/price-analyzer.test.ts    (pre-existing)
tests/unit/value-engine/section-ranker.test.ts     (pre-existing)
tests/unit/value-engine/row-evaluator.test.ts      (pre-existing)
tests/unit/value-engine/resale-predictor.test.ts   (pre-existing)
tests/unit/monitoring/monitor.service.test.ts
tests/unit/telegram/formatter.test.ts
tests/unit/data/subscription-mapper.test.ts
tests/e2e/dry-run.test.ts
```

---

### Session: 2026-02-01 (Session 4) — Telegram UX Overhaul
**Changes (3 files rewritten/upgraded):**

#### Goal
Make SeatSniper a top-tier Telegram bot: reliable, responsive, payment-ready, with a polished interactive UX that rivals the best bots on Telegram.

#### Critical Fix: Bot Polling Not Working (#4)
- **Problem:** TelegramNotifier created the Telegraf instance but never called `bot.launch()`. TelegramBotService received the shared instance and skipped `bot.launch()` because `ownsBot=false`. Result: handlers registered but **no long-polling**, so no commands worked.
- **Fix:** TelegramBotService now **always** calls `bot.launch()` and `bot.stop()`. The notifier only uses raw API calls (`bot.telegram.sendMessage`), so it doesn't need polling. Removed the flawed `ownsBot` concept entirely.

#### Reliability Improvements
1. **Auto-deactivate on block** — When an alert delivery fails with "forbidden", "blocked", or "chat not found", the subscription is automatically deactivated. Stops wasting API cycles polling for users who blocked the bot.
2. **Scan timeout protection** — `/scan` now races against a 45-second timeout. If platforms are slow, user gets a clear error message instead of infinite loading.
3. **Typing indicator** — `/scan` sends `typing...` chat action so the user sees the bot is working while results load.
4. **Unsub confirmation** — `/unsub` now asks "Are you sure?" with inline buttons (Yes / Keep alerts) instead of instant deletion. Points users to `/pause` as an alternative.

#### New Commands
5. **`/pause`** — Temporarily mutes alerts. Settings are preserved. Persisted to DB.
6. **`/resume`** — Resumes a paused subscription. Persisted to DB.

#### Subscribe Flow Upgrade (was 3 steps → now 4 steps)
7. **Multi-city selection** — Users can tap multiple cities to toggle them on/off (with ✅ indicators), then tap "Done (N selected)" or "All Cities". No more single-city-only limitation.
8. **Budget step (NEW)** — After quantity, users set a max price per ticket ($50, $100, $200, or no limit). Alerts only trigger for listings within budget.
9. **Budget filtering in MonitorService** — `sendAlerts()` now filters `qualifyingPicks` by `sub.maxPricePerTicket` alongside the existing quantity filter.

#### Scan Results Upgrade
10. **Buy links in scan** — Each listing in scan results now includes a `[Buy](deepLink)` link, matching what alerts already had.

#### Alert Interactions
11. **Inline action buttons** — `buildAlertActions()` generates buttons for each alert: 🔕 Mute Event (suppresses future alerts for that event), 🔄 Refresh (re-scans the city).
12. **Event muting** — `isEventMutedForUser()` API lets the monitor check if a user has muted a specific event before sending alerts.

#### Payment Readiness
13. **`userTier` field** — Subscription interface now includes `userTier: 'free' | 'pro' | 'premium'`. Stored in DB. Default: `'free'`. Ready for Telegram Payments integration.
14. **DB auto-migration** — `ensureTable()` now runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for `max_price_per_ticket`, `paused`, and `user_tier`. Existing tables upgrade automatically.

#### Status & Settings Upgrade
15. **Personal status** — `/status` now shows your own subscription status (Active/Paused/Not subscribed) alongside system stats. Shows paused count.
16. **Budget in settings** — `/settings` displays max price per ticket and paused status.

#### Schema Changes
- `Subscription` interface: added `maxPricePerTicket: number`, `paused: boolean`, `userTier: 'free' | 'pro' | 'premium'`
- `MonitorService.getStatus()`: added `pausedSubscriptions` count
- `MonitorService`: added `pauseSubscription()`, `resumeSubscription()`, `deactivateSubscription()`, `shouldDeactivateOnError()`
- `user_subscriptions` table: added `max_price_per_ticket`, `paused`, `user_tier` columns

#### Verification
- `npx tsc --noEmit` — 0 errors
- `npm run build` — clean (184KB ESM, tsup)

---

### Session: 2026-02-01 (Session 3) — Deep Quality Audit & Hardening
**Changes (5 modified files, 16 findings addressed):**

#### Goal
Sweep all code written in Session 2 for edge cases, race conditions, security holes, memory leaks, and UX bugs. Target: top-1% engineering quality for a production Telegram bot.

#### Findings & Fixes

**MonitorService (6 findings fixed):**
1. **Subscription duplicates** — `Array.push()` allowed same user twice. Changed `subscriptions` from `Subscription[]` to `Map<string, Subscription>` with upsert semantics.
2. **Concurrent cycle overlap** — Two timer firings could run the same priority cycle simultaneously. Added `activeCycles: Set<string>` guard; overlapping cycles skip silently.
3. **Memory leak: trackedEvents never pruned** — Past events accumulated forever. Added `pruneTrackedEvents()` that evicts events >1 day past, called at start of every discovery cycle.
4. **Discovery sequential by city** — Was `for...of` loop. Now `Promise.allSettled()` across cities, then adapters within each city.
5. **scanCity sequential by adapter** — Same fix: parallelized with `Promise.allSettled()`.
6. **Dead code** — Removed unused `_allListings` parameter from `sendAlerts()` and unused `NormalizedListing` import.

**TelegramBotService (5 findings fixed):**
7. **MarkdownV2 C6 repeat** — Scan results had hardcoded `\\(` `\\)` pre-escaping. Replaced with `this.escapeMarkdown()` calls.
8. **Session memory leak** — No TTL on subscribe-flow sessions. Added `SESSION_TTL_MS = 10min`, `createdAt` timestamp, `pruneSessions()` running every 5 minutes.
9. **No input validation on /scan** — City input could contain arbitrary chars. Added regex sanitization: `[^a-zA-Z\s-]` stripped, 50-char limit.
10. **Duplicate Telegraf instances** — TelegramBotService created its own `new Telegraf()`, conflicting with TelegramNotifier's instance (duplicate long-polling). Added `existingBot?: Telegraf` constructor param and `ownsBot` flag. Only `launch()`/`stop()` if bot is owned.

**Database Layer (2 findings fixed):**
11. **SQL injection in alert cooldown** — `isAlertOnCooldown()` used `($3 || ' milliseconds')::interval` which concatenated user-controlled value into SQL. Replaced with `($3::numeric * interval '1 second')` using parameterized seconds.
12. **connectionString + host/port conflict** — `pg.Pool` received both `connectionString` and individual `host`/`port`/`database` fields, causing ambiguous behaviour. Now uses either `connectionString` exclusively or individual fields, never both.

**index.ts Wiring (3 findings fixed):**
13. **Shared Telegraf instance** — `start()` now passes `telegramNotifier.bot` to `TelegramBotService` constructor, so both share one bot instance (no duplicate polling).
14. **Double shutdown race** — Multiple SIGINT/SIGTERM signals could trigger concurrent `app.stop()` calls. Added `shuttingDown` boolean guard in `main()`.
15. **TelegramNotifier bot access** — Changed `private bot: Telegraf` to `readonly bot: Telegraf` to enable sharing.

**Formatter (1 finding reviewed, no change needed):**
16. **escapeMarkdown regex** — Reviewed character class `[_*[\]()~`>#+=|{}.!\\-]`. Confirmed correct: backslash escaped, hyphen at end (literal), all MarkdownV2 special chars covered.

#### Verification
- `npx tsc --noEmit` — 0 errors
- `npm run build` — clean (171KB ESM, tsup)

---

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

### HIGH (still open: 7 of 14)
| # | Finding | Status |
|---|---------|--------|
| H1 | No HTTPS enforcement | OPEN |
| H2 | pgAdmin hardcoded password | OPEN |
| H3 | PII in logs | OPEN |
| H4 | Redis unauthenticated | OPEN |
| H5 | No unhandled rejection handler | **FIXED** (2026-01-31) |
| H6 | Config PORT coercion to NaN | OPEN |
| H7 | DB URL with undefined password | **FIXED** (2026-02-01, S3: connectionString vs host/port precedence) |
| H8 | Resilience timeout conflict | **FIXED** (2026-01-31) |
| H9 | Rate limiter goes negative | **FIXED** (2026-01-31) |
| H10 | Seat map images missing | OPEN (non-blocking — URL fetch works) |
| H11 | URL cache unbounded eviction | **FIXED** (2026-01-31) |
| H12 | Ticketmaster price semantics | OPEN |
| H13 | Error stack traces lost | OPEN |
| H14 | `main()` runs on import | OPEN |

### NEW FINDINGS from Session 3 (all FIXED)
| # | Finding | Category | Status |
|---|---------|----------|--------|
| S3-1 | Subscription duplicates (Array.push) | Memory/Logic | **FIXED** |
| S3-2 | Concurrent cycle overlap (no guard) | Race condition | **FIXED** |
| S3-3 | TrackedEvents memory leak (no pruning) | Memory | **FIXED** |
| S3-4 | Sequential discovery (slow) | Performance | **FIXED** |
| S3-5 | Sequential scanCity (slow) | Performance | **FIXED** |
| S3-6 | Dead code (unused params/imports) | Quality | **FIXED** |
| S3-7 | MarkdownV2 C6 repeat in scan results | UX bug | **FIXED** |
| S3-8 | Session memory leak (no TTL) | Memory | **FIXED** |
| S3-9 | No input validation on /scan | Security | **FIXED** |
| S3-10 | Duplicate Telegraf instances | Architecture | **FIXED** |
| S3-11 | SQL injection in cooldown check | Security | **FIXED** |
| S3-12 | connectionString + host/port conflict | Config bug | **FIXED** |
| S3-13 | Double shutdown race | Race condition | **FIXED** |

### MEDIUM (still open: 15 of 18) | LOW: All 11 still OPEN

---

## NEXT STEPS (post-MVP)

### Priority 1: Get running end-to-end
1. Add real API keys to `.env` and test with live data
2. Run `docker compose up` for Postgres, then `npm start`
3. Talk to the Telegram bot: `/subscribe` → select Portland + Seattle → Family (4) → $200/ticket → Good (70+)
4. Wait for alerts or run `/scan portland` for instant results with buy links
5. Try `/pause` → `/resume` cycle, verify DB persistence

### Priority 2: Hardening
1. ~~Add Vitest tests for MonitorService, ValueEngine, Telegram bot~~ **DONE (Session 5) — 246 tests**
2. Fix remaining CRITICAL security findings (C1-C4)
3. Add structured error handling (categorized errors from circuit-breaker.ts)
4. Add Redis caching for event data between polls
5. Wire `buildAlertActions()` into TelegramNotifier.sendAlert() for inline buttons on alerts

### Priority 3: Enhanced UX
1. `/watch [event name]` — subscribe to specific events
2. Wire muted events check into MonitorService alert dispatch
3. Seat map highlighting with top deals marked on the map
4. Historical price chart (via TimescaleDB continuous aggregates)
5. `/feedback` — user feedback loop

### Priority 4: Monetization
1. Telegram Payments API (Stars) integration for `/upgrade`
2. Tier-based rate limiting (free: 3 scans/day, pro: unlimited)
3. Pro features: real-time price drop alerts, historical charts, priority polling
4. Stripe webhook for subscription management

---

## ARCHITECTURE

```
User ←→ Telegram Bot (9 commands, inline actions)
              │
              ▼
     ┌─ SeatSniperApp ──────────────────────────────────────┐
     │                                                        │
     │  MonitorService (priority-based polling)                │
     │    │                                                    │
     │    ├── Discovery: every 15 min, all adapters (parallel) │
     │    ├── High-pri poll: <7 days, every 2 min              │
     │    ├── Med-pri poll: 7-30 days, every 10 min            │
     │    ├── Low-pri poll: >30 days, every 30 min             │
     │    │                                                    │
     │    ├── ValueEngine: score all listings                   │
     │    ├── Filter: score + qty + budget + paused + muted    │
     │    ├── Dedup: 30-min cooldown (memory + DB)             │
     │    ├── Auto-deactivate: blocked/deleted users            │
     │    └── Alert: TelegramNotifier + seat map + buy links   │
     │                                                         │
     │  TelegramBotService (manages long-polling lifecycle)    │
     │    ├── /subscribe → cities → qty → budget → score       │
     │    ├── /scan → typing + timeout + buy links             │
     │    ├── /pause, /resume — mute/unmute alerts             │
     │    ├── /unsub — with confirmation dialog                │
     │    ├── /status — system + personal sub status           │
     │    ├── /settings — shows budget, paused, tier           │
     │    └── Alert actions: 🔕 Mute Event, 🔄 Refresh        │
     │                                                         │
     │  PostgreSQL (via pg Pool)                                │
     │    ├── user_subscriptions (+budget, +paused, +userTier) │
     │    ├── alert_log (dedup + audit)                         │
     │    └── Auto-migrate new columns on startup               │
     │                                                          │
     │  Redis: cache (future)                                   │
     └─────────────────────────────────────────────────────────┘
```

---

## PLATFORM API COMPARISON

| Feature | Ticketmaster | SeatGeek | StubHub |
|---------|-------------|----------|---------|
| **Status** | ✅ LIVE | Code ready | 95% ready |
| **Event Search** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Listing Prices** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Seat Maps** | Static URL | Interactive + static | ❌ None |
| **Rate Limit** | 5,000/day | 60/min | 10/min (tight) |
| **Auth** | API key | Client ID | OAuth 2.0 |
| **Deal Quality Score** | ❌ | ✅ SeatGeek DQ | ❌ |
| **Setup Effort** | ✅ Done! | Medium | High |

**MVP Strategy:** Ticketmaster alone covers events + listings + pricing. SeatGeek/StubHub = Phase 2 for cross-platform comparison (code ready, needs credentials).

---

## ENV VARS NEEDED

```bash
# Platform APIs
TICKETMASTER_API_KEY=        # ✅ Configured — from developer.ticketmaster.com
SEATGEEK_CLIENT_ID=          # Optional Phase 2 — from seatgeek.com/build
SEATGEEK_CLIENT_SECRET=      # Optional
STUBHUB_CLIENT_ID=           # Optional — requires approval, overkill for MVP
STUBHUB_CLIENT_SECRET=       # Optional

# Notifications
TELEGRAM_BOT_TOKEN=          # ⏳ NEEDED — from @BotFather
TELEGRAM_CHAT_ID=            # Auto-discovered on /start

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
| **Test config** | `vitest.config.ts` |
| **Test mocks** | `tests/mocks/mock-adapter.ts`, `mock-notifier.ts`, `fixtures.ts` |
| **Unit tests** | `tests/unit/value-engine/*.test.ts`, `monitoring/*.test.ts`, `telegram/*.test.ts`, `data/*.test.ts` |
| **E2E tests** | `tests/e2e/dry-run.test.ts` |
| This file | `DEVLOG.md` |
| Full audit | `SEATSNIPER.md` |
