# SeatSniper

Ticket intelligence platform that monitors StubHub, Ticketmaster, and SeatGeek for event tickets in the Pacific Northwest. Calculates value scores and delivers instant alerts via Telegram with seat map images, buy links, and interactive controls.

## How It Works

SeatSniper polls ticket platforms on a priority-based schedule, scores every listing through a 5-component weighted algorithm, and fires alerts when it finds deals that match your preferences — city, seat count, budget, and quality threshold.

```
Ticket Platforms          Value Engine              Telegram Bot
┌────────────┐          ┌──────────────┐          ┌─────────────────────┐
│  StubHub   │──┐       │ Price    35% │       ┌──│ /subscribe          │
│Ticketmaster│──┼──────▶│ Section  25% │──────▶│  │ /scan [city]        │
│  SeatGeek  │──┘       │ Row      15% │       │  │ /pause  /resume     │
└────────────┘          │ History  15% │       │  │ /status /settings   │
                        │ Resale   10% │       │  │ 🔕 Mute  🔄 Refresh │
                        └──────────────┘       └──└─────────────────────┘
```

**Target metrics:** <30s alert latency, >95% accuracy, >99.5% uptime

## Telegram Bot

The primary interface is a Telegram bot with 9 commands and inline action buttons.

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and quick start guide |
| `/subscribe` | 4-step setup: cities → seats → budget → score threshold |
| `/scan [city]` | One-shot scan with buy links (typing indicator + 45s timeout) |
| `/status` | System status + your personal subscription status |
| `/settings` | View preferences: cities, score, quantity, budget, paused state |
| `/pause` | Temporarily mute alerts (settings preserved) |
| `/resume` | Resume paused alerts |
| `/unsub` | Unsubscribe with confirmation dialog |
| `/help` | Full command reference |

### Subscribe Flow

The `/subscribe` command walks you through a 4-step inline keyboard flow:

1. **Cities** — Multi-select with ✅ toggles, "Done (N selected)", or "All Cities"
2. **Seats together** — Solo (1), Pair (2), Family (4), or Any
3. **Budget** — $50, $100, $200 per ticket, or no limit
4. **Score threshold** — Excellent (85+), Good (70+), Fair (55+), or Most (40+)

### Alert Features

Each alert includes:
- 🗺️ Venue seat map with highlighted sections
- 💰 Value score and price analysis
- 🛒 Direct buy links to the platform
- 🔕 **Mute Event** button — stop alerts for that specific event
- 🔄 **Refresh** button — re-scan the city for updated prices

### Setup

1. Message **@BotFather** on Telegram → `/newbot` → copy your bot token
2. Set `TELEGRAM_BOT_TOKEN=<your-token>` in `.env`
3. Start the app and message your bot `/start`

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
- **Alert deduplication** — 30-minute cooldown per event per user (in-memory + PostgreSQL)
- **Budget filtering** — Only alerts for listings within your max price
- **Quantity filtering** — Only alerts with enough consecutive seats
- **Pause/resume** — Mute alerts without losing settings
- **Auto-deactivation** — Users who block the bot are automatically deactivated

## Tech Stack

- **Runtime:** Node.js 22, TypeScript 5.7 (ESM)
- **Build:** tsup (184KB ESM bundle)
- **Database:** PostgreSQL 16 + TimescaleDB (auto-creates tables on startup)
- **Cache:** Redis 7 (configured, not yet used)
- **Resilience:** Cockatiel (circuit breaker, retry, bulkhead, timeout)
- **Telegram:** Telegraf v4.16.3 (shared instance for bot + notifier)
- **SMS/WhatsApp:** Twilio SDK
- **Infrastructure:** Docker & Docker Compose

## Getting Started

### Prerequisites

- Node.js >= 22
- Docker & Docker Compose
- API credentials for at least one ticket platform
- Telegram bot token (from @BotFather)

### Setup

```bash
# Install dependencies
npm install

# Copy environment template and fill in your credentials
cp .env.example .env

# Start PostgreSQL + TimescaleDB + Redis
npm run docker:up

# Build and run
npm run build
npm start
```

The app runs fine without PostgreSQL (in-memory fallback) — just start with `npm start`.

### Environment Variables

See [`.env.example`](.env.example) for the full list. Key groups:

| Variable | Description |
|----------|-------------|
| `STUBHUB_CLIENT_ID` / `STUBHUB_CLIENT_SECRET` | StubHub OAuth 2.0 credentials |
| `TICKETMASTER_API_KEY` | Ticketmaster Discovery API key |
| `SEATGEEK_CLIENT_ID` / `SEATGEEK_CLIENT_SECRET` | SeatGeek API credentials |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio SMS/WhatsApp credentials |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | PostgreSQL connection (optional) |
| `MONITORED_CITIES` | Comma-separated cities (default: `portland,seattle`) |

Each platform and notification channel is optional. The app starts with whatever credentials are available.

## Project Structure

```
src/
├── adapters/                  # Platform API integrations
│   ├── base/                  # Shared interface + circuit breaker
│   ├── stubhub/               # StubHub OAuth 2.0 adapter
│   ├── ticketmaster/          # Ticketmaster Discovery API adapter
│   └── seatgeek/              # SeatGeek API adapter
├── services/
│   ├── monitoring/            # Priority-based polling loop
│   │   └── monitor.service.ts # Discovery, scoring, alert dispatch
│   └── value-engine/          # Scoring algorithm
│       └── scoring/           # Individual score components
├── notifications/             # Alert delivery
│   ├── telegram/              # Bot UX + notifier + formatter
│   └── twilio/                # SMS + WhatsApp
├── data/
│   ├── database.ts            # PostgreSQL connection pool
│   ├── repositories/          # Subscription + alert log repos
│   └── migrations/            # SQL schema (auto-created on startup)
├── venues/                    # Seat map processing + venue registry
├── utils/                     # Logger, rate limiter, deep link generator
├── config/                    # Zod-validated env config
└── index.ts                   # Entry point (SeatSniperApp)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript (tsup) |
| `npm start` | Run compiled build |
| `npm test` | Run tests (Vitest) |
| `npm run test:coverage` | Tests with coverage |
| `npm run lint` | Lint check |
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`) |
| `npm run docker:up` | Start Docker services |
| `npm run docker:down` | Stop Docker services |

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
- **Circuit breaker:** Opens after 5 failures, 30s recovery window
- **Retry:** Exponential backoff, max 3 attempts
- **Timeout:** 10s per request (inside retry, not wrapping it)
- **Bulkhead:** Max 5 concurrent requests per platform

### Rate Limiting

Serialized token bucket with per-platform limits:
- StubHub: 10 requests/minute
- Ticketmaster: 5,000 requests/day
- SeatGeek: 60 requests/minute

### Database

PostgreSQL handles subscriptions and alert deduplication. Tables are auto-created on startup with automatic column migration for schema upgrades. TimescaleDB extension is available for future time-series price history.

Schema:
- `user_subscriptions` — User preferences (cities, score, quantity, budget, paused, tier)
- `alert_log` — Deduplication and audit trail with cooldown checks

### Shutdown

Graceful shutdown on SIGINT/SIGTERM:
1. Stop Telegram bot (stops long-polling)
2. Stop monitoring loop (clears all timers)
3. Shut down notifiers
4. Close database pool
5. Exit

Double-shutdown guard prevents race conditions from rapid signals.

## Development Log

See [`DEVLOG.md`](DEVLOG.md) for detailed session-by-session changelog, audit findings, and architecture decisions.

## License

UNLICENSED - Private project
