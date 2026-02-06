# Changelog

All notable changes to SeatSniper are documented here.

## [Unreleased]

## [0.5.0] - 2026-02-05

### Added
- **🔄 Cross-Platform Price Comparison** — New event matching service identifies identical events across Ticketmaster, SeatGeek, and StubHub using fuzzy name matching (Levenshtein distance >85%), venue aliases, and date/time proximity (±30 min)
- **🏆 Best Deal Alerts** — When multiple platforms have the same event, alerts now show price comparison by section with savings highlighted (e.g., "TM $45 < SG $52 — Save $7 on TM")
- **🏟️ Venue Aliases** — 30+ Pacific Northwest venue mappings (Moda Center, Climate Pledge Arena, Lumen Field, Providence Park, etc.) to ensure cross-platform matching works despite different naming conventions
- **📊 Event Groups Table** — New `event_groups` and `event_group_members` database tables persist cross-platform matches for faster lookups
- **🎯 Price Comparator Service** — Normalizes section names across platforms and calculates best deals per section

### Changed
- Bundle size: 219KB ESM (up from 200KB due to matching service)
- MonitorService now runs event matching during discovery cycle
- Alerts include `crossPlatformComparison` when available

## [0.4.0] - 2026-02-05

### Added
- **📊 Historical Price Tracking** — New `price_history` table records price snapshots per section during each poll cycle. Value engine now uses real historical data for the 15% "historical pricing" score component.
- **🔑 Category/Keyword Filtering** — Subscriptions can now filter by event category (concerts, sports, etc.) and keywords (artist/team names). Previously these fields existed but were never checked.

### Fixed
- **🔴 Search Flow Crash** — Fixed undefined `session` variable in telegram.bot.ts that caused crashes when selecting city in search results
- **⏰ Past Events Still Scored** — Events with `daysUntilEvent < 0` are now skipped early in `processEvent()` instead of being scored with clamped values
- **💾 Alert History Persistence** — Alert deduplication now persists to PostgreSQL and survives app restarts. Previously in-memory only, causing duplicate alerts after restart.
- **🔄 Async Cooldown Check** — `isAlertOnCooldown()` now checks both in-memory cache AND database for accurate deduplication

### Changed
- Test count: 274 tests passing (unchanged)
- Bundle size: 200KB ESM (up from 194KB due to new price history module)

## [0.3.0] - 2026-02-05

### Added
- **🔎 Keyword Search** — New Search button lets users find specific events by name (e.g., "Taylor Swift", "Trail Blazers")
- **Platform Indicators** — Events now show which platform they're from: 🎫 (Ticketmaster), 🪑 (SeatGeek)
- **SeatGeek Price Mapping** — When SeatGeek API is enabled, events display real `$min–$max` price ranges from the stats object
- **Redesigned Keyboard Layout** — 8 buttons in 4x2 grid: Scan, Search, Subscribe, Status, Settings, Pause, Resume, Help
- **`searchEvents()` Method** — MonitorService can now search events by keyword across all adapters
- **10 New Tests** — SeatGeek mapper priceRange extraction tests (256 total tests)

### Fixed
- **Scan Button** — Reply keyboard "🔍 Scan" button now correctly shows city picker instead of searching for "Scan" as a city name

## [0.2.0] - 2026-02-04

### Added
- **Persistent Reply Keyboard** — Bottom-of-screen buttons replace slash commands for all main actions
- **Rich Scan Output** — Events now show name, venue, date, time, price range, and ticket links
- **Price Ranges** — Ticketmaster events display `$min–$max` from Discovery API priceRanges
- **Category Icons** — Events show category: 🎵 Concerts, 🏟️ Sports, 🎭 Theater, 😂 Comedy, 🎪 Festivals

### Changed
- Scan results now return up to 10 upcoming events with full details
- All bot responses include the main menu keyboard

## [0.1.0] - 2026-02-03

### Added
- **Ticketmaster API Integration** — Discovery API live with 500+ Portland events, 1,100+ Seattle events
- **Telegram Bot** — 9 commands: /start, /subscribe, /scan, /status, /settings, /pause, /resume, /unsub, /help
- **Subscribe Flow** — 4-step wizard: City → Quantity → Budget → Score threshold
- **Value Scoring Engine** — 5-component weighted algorithm (Price 35%, Section 25%, Row 15%, History 15%, Resale 10%)
- **Priority Polling** — Events polled at 2min (≤7 days), 10min (≤30 days), 30min (>30 days)
- **Alert Deduplication** — 30-minute cooldown per event per user
- **Circuit Breaker** — Cockatiel-based resilience with retry, timeout, and bulkhead
- **PostgreSQL Persistence** — Subscriptions and alert history (optional, falls back to in-memory)
- **246 Tests** — Comprehensive Vitest test suite

### Fixed
- Ticketmaster date format (removed milliseconds causing 400 errors)
- Circuit breaker 404 cascade (offers endpoint now handles 404 gracefully)
- Bot polling conflict (shared Telegraf instance)
- tsup externals (axios, cockatiel bundled correctly)

## [0.0.1] - 2026-01-31

### Added
- Initial project structure
- Platform adapter interfaces
- StubHub OAuth 2.0 adapter (code ready, needs credentials)
- SeatGeek adapter (code ready, needs credentials)
- Rate limiter with serialized token bucket
- Logger with Winston
- Docker Compose for PostgreSQL + Redis

---

[Unreleased]: https://github.com/gouchan/seatsniper/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/gouchan/seatsniper/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/gouchan/seatsniper/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/gouchan/seatsniper/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gouchan/seatsniper/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gouchan/seatsniper/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/gouchan/seatsniper/releases/tag/v0.0.1
