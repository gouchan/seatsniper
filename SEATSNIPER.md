# SeatSniper Development Log

## Project Overview
**SeatSniper** - A ticket intelligence platform that monitors StubHub + Ticketmaster, calculates value scores, and delivers instant alerts via Telegram + SMS.

**Target Metrics:**
- Alert latency: <30 seconds
- Alert accuracy: >95%
- System uptime: >99.5%

---

## Tech Stack
- **Runtime:** Node.js 22, TypeScript 5.7
- **Database:** PostgreSQL + TimescaleDB (time-series data)
- **Cache:** Redis
- **APIs:** StubHub (OAuth 2.0), Ticketmaster (API Key)
- **Notifications:** Telegram Bot API, Twilio SMS
- **Resilience:** Cockatiel (circuit breaker, retry, bulkhead)

---

## Build Progress

### Phase 1: Foundation - COMPLETE

#### 2026-01-26 - MVP Core Implementation
- [x] Created project directory `/Users/robinsonchan/seatsniper`
- [x] Created `package.json` with all dependencies
- [x] Created `tsconfig.json` with path aliases
- [x] Created `tsup.config.ts` for ESM build
- [x] Set up full directory structure
- [x] Created core interfaces (`IPlatformAdapter`, `INotifier`, `ValueScore` types)
- [x] Implemented logger utility (Winston)
- [x] Set up Docker environment (PostgreSQL + TimescaleDB + Redis)
- [x] Created database migrations (initial schema, TimescaleDB, venue seeds)
- [x] Created SeatSniper Claude agent definitions

### Phase 2: Platform Adapters - COMPLETE

- [x] Implemented circuit breaker and resilience utilities (Cockatiel)
- [x] Built StubHub adapter (OAuth 2.0, event search, listings)
- [x] Built Ticketmaster adapter (API key, Discovery API, seat map URLs)
- [x] Built SeatGeek adapter (API key, event search, venue seat maps)
- [x] Created data mappers for normalization

### Phase 3: Value Engine - COMPLETE

- [x] Implemented PriceAnalyzer (current + historical comparison)
- [x] Implemented SectionRanker (venue tier mapping)
- [x] Implemented RowEvaluator (position scoring)
- [x] Implemented ResalePredictor (demand + timing)
- [x] Built ValueEngineService (weighted calculation)

### Phase 4: Notifications - COMPLETE

- [x] Built TelegramNotifier (Telegraf, MarkdownV2 formatting)
- [x] Built SMSNotifier (Twilio, segment-aware formatting)
- [x] Built WhatsAppNotifier (Twilio WhatsApp Business API)
- [x] Created message formatters for all channels
- [x] Added seat map visualization with highlighted sections

### Phase 5: Integration - COMPLETE

- [x] Created main entry point (`src/index.ts`)
- [x] Wired all services together
- [x] Added health check functionality
- [x] Created `.env.example` and `.gitignore`

**Next Steps:**
- [ ] Install dependencies (`npm install`)
- [ ] Configure environment variables
- [ ] Start Docker services (`docker-compose up`)
- [ ] Run database migrations
- [ ] Test with real API credentials

---

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `package.json` | Dependencies and scripts | Done |
| `tsconfig.json` | TypeScript configuration | Done |
| `tsup.config.ts` | Build configuration | Done |
| `.env.example` | Environment template | Done |
| `.gitignore` | Git ignore rules | Done |
| **Adapters** | | |
| `src/adapters/base/platform-adapter.interface.ts` | Core adapter interface | Done |
| `src/adapters/base/circuit-breaker.ts` | Resilience patterns | Done |
| `src/adapters/stubhub/stubhub.adapter.ts` | StubHub implementation | Done |
| `src/adapters/stubhub/stubhub.types.ts` | StubHub API types | Done |
| `src/adapters/stubhub/stubhub.mapper.ts` | Data normalization | Done |
| `src/adapters/ticketmaster/ticketmaster.adapter.ts` | Ticketmaster implementation | Done |
| `src/adapters/ticketmaster/ticketmaster.types.ts` | Ticketmaster API types | Done |
| `src/adapters/ticketmaster/ticketmaster.mapper.ts` | Data normalization | Done |
| `src/adapters/seatgeek/seatgeek.adapter.ts` | SeatGeek implementation | Done |
| `src/adapters/seatgeek/seatgeek.types.ts` | SeatGeek API types | Done |
| `src/adapters/seatgeek/seatgeek.mapper.ts` | Data normalization | Done |
| **Services** | | |
| `src/services/value-engine/value-score.types.ts` | Scoring types | Done |
| `src/services/value-engine/value-engine.service.ts` | Main scoring service | Done |
| `src/services/value-engine/scoring/price-analyzer.ts` | Price component | Done |
| `src/services/value-engine/scoring/section-ranker.ts` | Section component | Done |
| `src/services/value-engine/scoring/row-evaluator.ts` | Row component | Done |
| `src/services/value-engine/scoring/resale-predictor.ts` | Resale component | Done |
| **Notifications** | | |
| `src/notifications/base/notifier.interface.ts` | Notifier interface | Done |
| `src/notifications/telegram/telegram.notifier.ts` | Telegram implementation | Done |
| `src/notifications/telegram/telegram.formatter.ts` | Message formatting | Done |
| `src/notifications/twilio/sms.notifier.ts` | SMS implementation | Done |
| `src/notifications/twilio/sms.formatter.ts` | SMS formatting | Done |
| `src/notifications/twilio/whatsapp.notifier.ts` | WhatsApp implementation | Done |
| `src/notifications/twilio/whatsapp.formatter.ts` | WhatsApp formatting | Done |
| **Venues & Seat Maps** | | |
| `src/venues/seat-map.types.ts` | Seat map type definitions | Done |
| `src/venues/seat-map.service.ts` | Image annotation service | Done |
| `src/venues/seat-map.registry.ts` | Venue seat map registry | Done |
| `assets/seat-maps/README.md` | Seat map image instructions | Done |
| **Config & Utils** | | |
| `src/config/index.ts` | Configuration management | Done |
| `src/utils/logger.ts` | Winston logging | Done |
| `src/utils/rate-limiter.ts` | Token bucket rate limiter | Done |
| `src/utils/deep-link-generator.ts` | Purchase link generator | Done |
| **Database** | | |
| `src/data/migrations/001_initial_schema.sql` | Core tables | Done |
| `src/data/migrations/002_timescale_hypertables.sql` | Time-series setup | Done |
| `src/data/migrations/003_seed_venues.sql` | PNW venue data | Done |
| **Docker** | | |
| `docker/docker-compose.yml` | Production setup | Done |
| `docker/docker-compose.dev.yml` | Development overrides | Done |
| `docker/Dockerfile` | Production image | Done |
| `docker/Dockerfile.dev` | Development image | Done |
| **Claude Agents** | | |
| `.claude/agents/platform-adapter.md` | API integration specialist | Done |
| `.claude/agents/value-engine.md` | Valuation specialist | Done |
| `.claude/agents/alert-dispatcher.md` | Notification specialist | Done |
| `.claude/agents/inventory-monitor.md` | Monitoring specialist | Done |
| **Entry Point** | | |
| `src/index.ts` | Main application | Done |

---

## Architecture Decisions

### AD-001: Resilience Pattern Library
**Decision:** Use `cockatiel` for circuit breaker, retry, and bulkhead patterns.
**Rationale:** Native TypeScript, well-maintained, supports policy composition.
**Alternative Considered:** Manual implementation, opossum (callback-based).

### AD-002: Database Choice
**Decision:** PostgreSQL + TimescaleDB extension.
**Rationale:**
- PostgreSQL for relational data (users, events, subscriptions)
- TimescaleDB for time-series price history (automatic partitioning, continuous aggregates)
**Alternative Considered:** InfluxDB (separate system), pure PostgreSQL (no time-series optimization).

### AD-003: Notification Library
**Decision:** Telegraf for Telegram, official Twilio SDK for SMS.
**Rationale:** Both are official/well-supported libraries with TypeScript types.

### AD-004: Rate Limiting Strategy
**Decision:** Token bucket algorithm with platform-specific configurations.
**Rationale:**
- StubHub: 10 req/min → minute-based limiter
- Ticketmaster: 5000 req/day → distributed across day
**Implementation:** Custom `RateLimiter` class in `src/utils/rate-limiter.ts`

---

## Value Score Algorithm

```
VALUE_SCORE = (Price_Score × 0.35)
            + (Section_Score × 0.25)
            + (Row_Score × 0.15)
            + (Historical_Score × 0.15)
            + (Resale_Score × 0.10)
```

| Score Range | Rating | Recommendation |
|-------------|--------|----------------|
| 85-100 | Excellent | Buy immediately |
| 70-84 | Good | Strong buy |
| 55-69 | Fair | Compare options |
| 40-54 | Below Average | Wait for better |
| <40 | Poor | Overpriced |

---

## API Integration Notes

### StubHub
- **Auth:** OAuth 2.0 Client Credentials
- **Rate Limit:** ~10 requests/minute
- **Endpoints:**
  - `GET /catalog/events` - Search events
  - `GET /catalog/events/{id}/listings` - Get listings
- **Notes:** Token expires, needs refresh logic

### Ticketmaster
- **Auth:** API Key (query parameter)
- **Rate Limit:** 5000 requests/day
- **Endpoints:**
  - `GET /discovery/v2/events` - Search events
  - `GET /discovery/v2/events/{id}/offers` - Get resale offers
- **Notes:** HAL+JSON response format with `_embedded`

---

## Getting Started

```bash
# 1. Navigate to project
cd /Users/robinsonchan/seatsniper

# 2. Install dependencies
npm install

# 3. Copy environment file and configure
cp .env.example .env
# Edit .env with your API credentials

# 4. Start Docker services
docker-compose -f docker/docker-compose.yml up -d

# 5. Build and run
npm run build
npm start

# Or for development with hot reload
npm run dev
```

---

## Changelog

### 2026-01-27
- Added WhatsApp notification support (Twilio WhatsApp Business API)
- Created WhatsAppNotifier with template message support
- Created WhatsAppFormatter with WhatsApp-specific formatting (*bold*, _italic_)
- Updated config to support TWILIO_WHATSAPP_NUMBER
- Wired WhatsApp notifier into main application
- **Added Seat Map Visualization Feature:**
  - Created SeatMapService with Sharp image processing
  - Built section polygon highlighting with SVG overlays
  - Supports multi-section highlighting (gold/silver/bronze for top deals)
  - Integrated with Telegram notifier to send seat maps before text alerts
  - Added venue registry for Moda Center, Climate Pledge Arena, Lumen Field, Tacoma Dome, Providence Park
  - Created assets/seat-maps directory structure with setup instructions
- **Added SeatGeek Platform Adapter:**
  - Full SeatGeek API integration (events, listings, venues)
  - Venue seat map URL support (seating_chart_url)
  - Mapper for normalized event/listing data
  - Added SEATGEEK_CLIENT_ID/SECRET to config
- **Dynamic Seat Map Loading:**
  - Updated NormalizedEvent with seatMapUrl field
  - Updated AlertPayload with seatMapUrl field
  - SeatMapService now fetches from API URLs (Ticketmaster/SeatGeek)
  - Falls back to local files if API URL unavailable
  - URL caching for performance

### 2026-01-26
- Completed MVP implementation
- Built StubHub and Ticketmaster adapters with full resilience patterns
- Implemented Value Score algorithm with 5 components
- Created Telegram and SMS notification channels
- Set up Docker environment with PostgreSQL + TimescaleDB + Redis
- Created database schema with time-series support
- Defined 4 SeatSniper-specific Claude agents
- Wired all services in main entry point

### 2026-01-25
- Initial project setup
- Created package.json with all MVP dependencies
- Configured TypeScript with path aliases
- Created tsup build configuration
- Started SEATSNIPER.md documentation

---

## References
- [PRD Document](/Users/robinsonchan/Desktop/SeatSniper_PRD_v3.docx)
- [Implementation Plan](/.claude/plans/melodic-wondering-stallman.md)
