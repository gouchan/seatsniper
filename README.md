# SeatSniper

Ticket intelligence platform that monitors StubHub, Ticketmaster, and SeatGeek for event tickets in the Pacific Northwest. Calculates value scores and delivers instant alerts via Telegram, SMS, and WhatsApp.

## How It Works

SeatSniper polls ticket platforms, runs each listing through a weighted scoring algorithm, and fires off alerts when it finds deals worth grabbing.

```
Ticket Platforms          Value Engine              Alert Channels
┌────────────┐          ┌──────────────┐          ┌────────────┐
│  StubHub   │──┐       │ Price    35% │       ┌──│  Telegram  │
│Ticketmaster│──┼──────▶│ Section  25% │──────▶├──│    SMS     │
│  SeatGeek  │──┘       │ Row      15% │       └──│  WhatsApp  │
└────────────┘          │ History  15% │          └────────────┘
                        │ Resale   10% │
                        └──────────────┘
```

**Target metrics:** <30s alert latency, >95% accuracy, >99.5% uptime

## Value Score

Each listing gets a 1-100 score based on five weighted components:

| Score | Rating | Action |
|-------|--------|--------|
| 85-100 | Excellent | Buy immediately |
| 70-84 | Good | Strong buy |
| 55-69 | Fair | Compare options |
| 40-54 | Below Average | Wait for better |
| <40 | Poor | Overpriced |

## Tech Stack

- **Runtime:** Node.js 22, TypeScript 5.7 (ESM)
- **Database:** PostgreSQL 16 + TimescaleDB
- **Cache:** Redis 7
- **Resilience:** Cockatiel (circuit breaker, retry, bulkhead)
- **Notifications:** Telegraf, Twilio
- **Infrastructure:** Docker & Docker Compose

## Getting Started

### Prerequisites

- Node.js >= 22
- Docker & Docker Compose
- API credentials for at least one ticket platform
- At least one notification channel configured

### Setup

```bash
# Install dependencies
npm install

# Copy environment template and fill in your credentials
cp .env.example .env

# Start PostgreSQL + TimescaleDB + Redis
npm run docker:up

# Run database migrations
npm run db:migrate

# Start in development mode (hot reload)
npm run dev

# Or build and run production
npm run build
npm start
```

### Environment Variables

See [`.env.example`](.env.example) for the full list. Key groups:

| Variable | Description |
|----------|-------------|
| `STUBHUB_CLIENT_ID` / `STUBHUB_CLIENT_SECRET` | StubHub OAuth 2.0 credentials |
| `TICKETMASTER_API_KEY` | Ticketmaster Discovery API key |
| `SEATGEEK_CLIENT_ID` / `SEATGEEK_CLIENT_SECRET` | SeatGeek API credentials |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio SMS/WhatsApp credentials |
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
│   └── value-engine/          # Scoring algorithm
│       └── scoring/           # Individual score components
├── notifications/             # Alert delivery
│   ├── telegram/              # Telegram bot
│   └── twilio/                # SMS + WhatsApp
├── venues/                    # Seat map processing + venue registry
├── utils/                     # Logger, rate limiter, deep link generator
├── config/                    # Zod-validated env config
├── data/
│   └── migrations/            # PostgreSQL + TimescaleDB schema
└── index.ts                   # Entry point
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled build |
| `npm test` | Run tests |
| `npm run test:coverage` | Tests with coverage |
| `npm run lint` | Lint check |
| `npm run typecheck` | TypeScript type check |
| `npm run db:migrate` | Run database migrations |
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
- **Timeout:** 10s per request
- **Bulkhead:** Max 5 concurrent requests per platform

### Rate Limiting

Token bucket algorithm with per-platform limits:
- StubHub: 10 requests/minute
- Ticketmaster: 5,000 requests/day
- SeatGeek: 60 requests/minute

### Database

PostgreSQL handles relational data (users, events, subscriptions). TimescaleDB extension provides time-series optimization for price history with automatic partitioning and continuous aggregates.

## License

UNLICENSED - Private project
