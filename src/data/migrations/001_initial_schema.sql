-- SeatSniper Initial Schema
-- Migration 001: Core tables for users, venues, events, listings, and alerts

-- ============================================================================
-- Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Users Table
-- ============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Contact methods (at least one required)
    telegram_chat_id VARCHAR(50) UNIQUE,
    phone_number VARCHAR(20) UNIQUE,
    email VARCHAR(255) UNIQUE,

    -- Preferences
    notification_preferences JSONB DEFAULT '{
        "telegram": true,
        "sms": false,
        "whatsapp": false,
        "email": false
    }'::jsonb,

    -- Alert settings
    default_max_price DECIMAL(10,2),
    default_min_value_score INTEGER DEFAULT 70,
    timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',

    -- Metadata
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure at least one contact method
ALTER TABLE users ADD CONSTRAINT users_has_contact_method
    CHECK (telegram_chat_id IS NOT NULL OR phone_number IS NOT NULL OR email IS NOT NULL);

-- ============================================================================
-- Venues Table
-- ============================================================================

CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identity
    name VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,

    -- Platform IDs for matching
    stubhub_venue_id VARCHAR(100),
    ticketmaster_venue_id VARCHAR(100),
    seatgeek_venue_id VARCHAR(100),

    -- Seat map data
    seat_map_data JSONB,
    section_tiers JSONB,  -- Maps section names to SectionTier enum values

    -- Metadata
    total_capacity INTEGER,
    venue_type VARCHAR(50),  -- arena, stadium, theater, club
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_venue_name_city UNIQUE (name, city, state)
);

-- ============================================================================
-- Events Table
-- ============================================================================

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Platform IDs (for deduplication and linking)
    stubhub_id VARCHAR(100) UNIQUE,
    ticketmaster_id VARCHAR(100) UNIQUE,
    seatgeek_id VARCHAR(100),
    vividseats_id VARCHAR(100),

    -- Event details
    name VARCHAR(500) NOT NULL,
    venue_id UUID REFERENCES venues(id),
    event_date TIMESTAMPTZ NOT NULL,

    -- Classification
    category VARCHAR(50),  -- concerts, sports, theater, comedy, festivals
    subcategory VARCHAR(100),
    performer VARCHAR(255),

    -- Popularity and pricing stats
    popularity_score INTEGER DEFAULT 50,  -- 0-100
    average_price DECIMAL(10,2),
    lowest_price DECIMAL(10,2),
    highest_price DECIMAL(10,2),
    listing_count INTEGER DEFAULT 0,

    -- Status
    is_active BOOLEAN DEFAULT true,
    is_sold_out BOOLEAN DEFAULT false,

    -- Metadata
    image_url TEXT,
    primary_url TEXT,  -- Link to event page
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_polled_at TIMESTAMPTZ
);

-- ============================================================================
-- Listings Table (Current Inventory Snapshot)
-- ============================================================================

CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Relationships
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- Platform identification
    platform VARCHAR(20) NOT NULL,  -- stubhub, ticketmaster, seatgeek, vividseats
    platform_listing_id VARCHAR(100) NOT NULL,

    -- Seat information
    section VARCHAR(100) NOT NULL,
    row VARCHAR(20),
    seat_numbers TEXT[],
    quantity INTEGER NOT NULL,

    -- Pricing
    price_per_ticket DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    fees DECIMAL(10,2) DEFAULT 0,

    -- Delivery and seller
    delivery_type VARCHAR(20),  -- electronic, instant, physical, willcall
    seller_rating DECIMAL(3,2),

    -- Purchase link
    deep_link TEXT NOT NULL,

    -- Value scoring
    value_score INTEGER,
    value_breakdown JSONB,

    -- Tracking
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    captured_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique listing per platform
    CONSTRAINT unique_platform_listing UNIQUE (platform, platform_listing_id)
);

-- ============================================================================
-- Alert Subscriptions Table
-- ============================================================================

CREATE TABLE alert_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Relationships
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- Alert criteria
    max_price DECIMAL(10,2),
    min_value_score INTEGER DEFAULT 70,
    preferred_sections TEXT[],  -- NULL means all sections
    max_row_number INTEGER,     -- NULL means any row
    min_quantity INTEGER DEFAULT 1,

    -- Alert preferences
    alert_on_new_listing BOOLEAN DEFAULT true,
    alert_on_price_drop BOOLEAN DEFAULT true,
    alert_on_high_value BOOLEAN DEFAULT true,  -- Score >= 85
    price_drop_threshold_percent INTEGER DEFAULT 15,

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Deduplication
    last_alert_at TIMESTAMPTZ,
    alert_cooldown_minutes INTEGER DEFAULT 30,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One subscription per user per event
    CONSTRAINT unique_user_event_subscription UNIQUE (user_id, event_id)
);

-- ============================================================================
-- Alerts Sent Log
-- ============================================================================

CREATE TABLE alerts_sent (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Relationships
    subscription_id UUID REFERENCES alert_subscriptions(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- Alert details
    channel VARCHAR(20) NOT NULL,  -- telegram, sms, whatsapp, email
    alert_type VARCHAR(30) NOT NULL,  -- new_listing, price_drop, high_value, daily_digest

    -- Delivery tracking
    message_id VARCHAR(100),
    delivery_status VARCHAR(20) DEFAULT 'pending',  -- pending, delivered, failed

    -- Content (for debugging/audit)
    payload JSONB NOT NULL,
    listings_included INTEGER,

    -- Timestamps
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,

    -- Error tracking
    error_message TEXT
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Users
CREATE INDEX idx_users_telegram ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE INDEX idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;

-- Venues
CREATE INDEX idx_venues_city ON venues(city, state);
CREATE INDEX idx_venues_stubhub ON venues(stubhub_venue_id) WHERE stubhub_venue_id IS NOT NULL;
CREATE INDEX idx_venues_ticketmaster ON venues(ticketmaster_venue_id) WHERE ticketmaster_venue_id IS NOT NULL;

-- Events
CREATE INDEX idx_events_date ON events(event_date);
CREATE INDEX idx_events_venue ON events(venue_id);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_active ON events(is_active, event_date) WHERE is_active = true;
CREATE INDEX idx_events_polling ON events(last_polled_at, event_date) WHERE is_active = true;

-- Listings
CREATE INDEX idx_listings_event ON listings(event_id);
CREATE INDEX idx_listings_event_value ON listings(event_id, value_score DESC);
CREATE INDEX idx_listings_section ON listings(event_id, section);
CREATE INDEX idx_listings_price ON listings(event_id, price_per_ticket);
CREATE INDEX idx_listings_last_seen ON listings(last_seen_at);

-- Subscriptions
CREATE INDEX idx_subscriptions_user ON alert_subscriptions(user_id) WHERE is_active = true;
CREATE INDEX idx_subscriptions_event ON alert_subscriptions(event_id) WHERE is_active = true;
CREATE INDEX idx_subscriptions_active ON alert_subscriptions(is_active, event_id);

-- Alerts
CREATE INDEX idx_alerts_user ON alerts_sent(user_id, sent_at DESC);
CREATE INDEX idx_alerts_event ON alerts_sent(event_id, sent_at DESC);
CREATE INDEX idx_alerts_status ON alerts_sent(delivery_status) WHERE delivery_status = 'pending';

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_venues_updated_at
    BEFORE UPDATE ON venues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON alert_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
