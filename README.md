# SeatSniper 🎫

Ticket intelligence platform that monitors Ticketmaster and SeatGeek for event tickets in the Pacific Northwest. Calculates value scores and delivers instant alerts via Telegram with seat map images, buy links, and interactive controls.

## Features

- **🔍 City Scan** — Browse all upcoming events in Portland or Seattle with prices
- **🔎 Keyword Search** — Find specific events (artists, teams, shows) across all platforms
- **📋 Smart Alerts** — Get notified when deals match your preferences (city, seats, budget, quality)
- **🎫 Multi-Platform** — Ticketmaster live, SeatGeek ready (shows platform indicator per event)
- **💰 Real Pricing** — See actual ticket price ranges, not just "tickets available"
- **🤖 Telegram Bot** — Persistent button keyboard, no commands to memorize

## How It Works

```
Ticket Platforms          Value Engine              Telegram Bot
┌────────────┐          ┌──────────────┐          ┌─────────────────────┐
│Ticketmaster│──┐       │ Price    35% │       ┌──│ 🔍 Scan  🔎 Search  │
│  SeatGeek  │──┼──────▶│ Section  25% │──────▶│  │ 📋 Subscribe        │
│  (StubHub) │──┘       │ Row      15% │       │  │ ⚙️ Settings ⏸️ Pause │
└────────────┘          │ History  15% │       │  │ 🔕 Mute  🔄 Refresh │
                        │ Resale   10% │       └──└─────────────────────┘
```

**Target metrics:** <30s alert latency, >95% accuracy, >99.5% uptime

## Telegram Bot

The primary interface is a Telegram bot with a persistent reply keyboard — no slash commands needed.

### Main Menu (Persistent Keyboard)

```
┌─────────────┬─────────────┐
│  🔍 Scan    │  🔎 Search  │
├─────────────┼─────────────┤
│ 📋 Subscribe│  📊 Status  │
├─────────────┼─────────────┤
│ ⚙️ Settings │  ⏸️ Pause   │
├─────────────┼─────────────┤
│ ▶️ Resume   │  ❓ Help    │
└─────────────┴─────────────┘
```

### What Each Button Does

| Button | Description |
|--------|-------------|
| 🔍 Scan | Browse all events in a city (select Portland/Seattle) |
| 🔎 Search | Find specific events by name (e.g., "Taylor Swift", "Trail Blazers") |
| 📋 Subscribe | Set up alerts: cities → seats → budget → score threshold |
| 📊 Status | System status + your subscription status |
| ⚙️ Settings | View your alert preferences |
| ⏸️ Pause | Temporarily mute alerts (settings preserved) |
| ▶️ Resume | Resume paused alerts |
| ❓ Help | Quick reference guide |

### Scan Output

Each event shows:
- 🎵🎫 Category + platform indicator (🎫 Ticketmaster, 🪑 SeatGeek)
- Event name, venue, date/time
- 💰 Price range ($min–$max)
- Direct ticket link

### Subscribe Flow

4-step inline keyboard setup:
1. **Cities** — Multi-select Portland, Seattle, or All
2. **Seats together** — 1, 2, 4, or Any
3. **Budget** — $50, $100, $200 per ticket, or no limit
4. **Score threshold** — Excellent (85+), Good (70+), Fair (55+), or Most (40+)

### Alert Features

Each alert includes:
- 🗺️ Venue seat map with highlighted sections
- 💰 Value score and price analysis
- 🛒 Direct buy links to the platform
- 🔕 **Mute Event** — stop alerts for that specific event
- 🔄 **Refresh** — re-scan the city for updated prices

## Value Score

Each listing gets a 1-100 score based on five weighted components:

| Score | Rating | Action |
|-------|--------|--------|
| 85-100 | Excellent | Buy immediately |
| 70-84 | Good | Strong buy |
| 55-69 | Fair | Compare options |
| 40-54 | Below Average | Wait for better |
| <40 | Poor | Overpriced |

## Monitoring

Priority-based polling keeps you on top of the most time-sensitive events:

| Priority | Events | Poll Interval |
|----------|--------|---------------|
| 🔴 High | Within 7 days | Every 2 minutes |
| 🟡 Medium | 7-30 days out | Every 10 minutes |
| 🟢 Low | 30+ days out | Every 30 minutes |
| Discovery | Find new events | Every 15 minutes |

Additional features:
- **Alert deduplication** — 30-minute cooldown per event per user
- **Budget filtering** — Only alerts for listings within your max price
- **Quantity filtering** — Only alerts with enough consecutive seats
- **Pause/resume** — Mute alerts without losing settings
- **Auto-deactivation** — Users who block the bot are automatically deactivated

## Tech Stack

- **Runtime:** Node.js 22, TypeScript 5.7 (ESM)
- **Build:** tsup (~200KB ESM bundle)
- **Database:** PostgreSQL 16 + TimescaleDB (optional, auto-creates tables)
- **Resilience:** Cockatiel (circuit breaker, retry, bulkhead, timeout)
- **Telegram:** Telegraf v4.16.3
- **Tests:** Vitest (274 tests)

## Project Status

**Completion: ~82%** — Functional MVP with known gaps.

| Category | Status |
|----------|--------|
| Telegram Bot UX | ✅ 85% — All flows work |
| Value Engine | ✅ 85% — Historical pricing now wired |
| Subscription Flow | ✅ 90% — Category/keyword filtering implemented |
| Error Handling | ⚠️ 70% — Circuit breaker not user-visible |
| Test Coverage | ⚠️ 65% — Gaps in critical paths |

See [DEVLOG.md](DEVLOG.md) for detailed session notes.

## Getting Started

### Prerequisites

- Node.js >= 22
- Telegram bot token (from @BotFather)
- Ticketmaster API key (free at developer.ticketmaster.com)
- Optional: SeatGeek API credentials, PostgreSQL

### Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env: add TELEGRAM_BOT_TOKEN and TICKETMASTER_API_KEY

# Build and run
npm run build
npm start
```

The app runs without PostgreSQL (in-memory fallback).

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `TICKETMASTER_API_KEY` | Yes | Ticketmaster Discovery API key |
| `SEATGEEK_CLIENT_ID` | No | SeatGeek API credentials (when approved) |
| `DATABASE_URL` | No | PostgreSQL connection (uses in-memory if not set) |
| `MONITORED_CITIES` | No | Comma-separated cities (default: `portland,seattle`) |

## Project Structure

```
src/
├── adapters/                  # Platform API integrations
│   ├── ticketmaster/          # Ticketmaster Discovery API
│   └── seatgeek/              # SeatGeek API (ready for credentials)
├── services/
│   ├── monitoring/            # Priority-based polling + searchEvents
│   └── value-engine/          # 5-component scoring algorithm
├── notifications/
│   └── telegram/              # Bot UX + formatter + notifier
├── data/
│   ├── database.ts            # PostgreSQL pool (optional)
│   └── repositories/          # Subscription + alert repos
└── index.ts                   # Entry point
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript (tsup) |
| `npm start` | Run compiled build |
| `npm test` | Run 256 tests (Vitest) |
| `npm run dev` | Start with hot reload |

## Supported Venues

Pre-configured seat map support for Pacific Northwest venues:

- Moda Center (Portland)
- Climate Pledge Arena (Seattle)
- Lumen Field (Seattle)
- Tacoma Dome (Tacoma)
- Providence Park (Portland)

## Architecture

### Resilience

All platform adapters use Cockatiel for fault tolerance:
- **Circuit breaker:** Opens after 5 failures, 30s recovery
- **Retry:** Exponential backoff, max 3 attempts
- **Timeout:** 10s per request

### Rate Limiting

- Ticketmaster: 5,000 requests/day
- SeatGeek: 60 requests/minute

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release history.

## Development Log

See [`DEVLOG.md`](DEVLOG.md) for session-by-session development notes.

## License

UNLICENSED - Private project
