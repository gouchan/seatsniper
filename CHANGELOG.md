# Changelog

All notable changes to SeatSniper are documented here.

## [Unreleased]

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

[Unreleased]: https://github.com/gouchan/seatsniper/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/gouchan/seatsniper/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gouchan/seatsniper/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gouchan/seatsniper/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/gouchan/seatsniper/releases/tag/v0.0.1
