-- SeatSniper TimescaleDB Setup
-- Migration 002: Time-series tables for price history and analytics

-- ============================================================================
-- Enable TimescaleDB Extension
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================================
-- Price History Table (Time-Series)
-- ============================================================================

CREATE TABLE price_history (
    -- Time dimension (required for hypertable)
    time TIMESTAMPTZ NOT NULL,

    -- Dimensions
    event_id UUID NOT NULL,
    section VARCHAR(100) NOT NULL,
    platform VARCHAR(20) NOT NULL,

    -- Metrics
    avg_price DECIMAL(10,2) NOT NULL,
    min_price DECIMAL(10,2) NOT NULL,
    max_price DECIMAL(10,2) NOT NULL,
    listing_count INTEGER NOT NULL,
    total_quantity INTEGER DEFAULT 0,

    -- Value score stats
    avg_value_score INTEGER,
    max_value_score INTEGER
);

-- Convert to hypertable (partitioned by time)
SELECT create_hypertable('price_history', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ============================================================================
-- Indexes on Hypertable
-- ============================================================================

CREATE INDEX idx_price_history_event
    ON price_history(event_id, time DESC);

CREATE INDEX idx_price_history_section
    ON price_history(event_id, section, time DESC);

CREATE INDEX idx_price_history_platform
    ON price_history(event_id, platform, time DESC);

-- ============================================================================
-- Continuous Aggregates for Analytics
-- ============================================================================

-- Hourly price aggregates
CREATE MATERIALIZED VIEW price_history_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    event_id,
    section,
    platform,
    AVG(avg_price)::DECIMAL(10,2) AS avg_price,
    MIN(min_price)::DECIMAL(10,2) AS min_price,
    MAX(max_price)::DECIMAL(10,2) AS max_price,
    SUM(listing_count) AS total_listings,
    AVG(avg_value_score)::INTEGER AS avg_value_score
FROM price_history
GROUP BY bucket, event_id, section, platform
WITH NO DATA;

-- Daily price aggregates
CREATE MATERIALIZED VIEW price_history_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    event_id,
    section,
    AVG(avg_price)::DECIMAL(10,2) AS avg_price,
    MIN(min_price)::DECIMAL(10,2) AS min_price,
    MAX(max_price)::DECIMAL(10,2) AS max_price,
    SUM(listing_count) AS total_listings,
    AVG(avg_value_score)::INTEGER AS avg_value_score
FROM price_history
GROUP BY bucket, event_id, section
WITH NO DATA;

-- ============================================================================
-- Refresh Policies for Continuous Aggregates
-- ============================================================================

-- Refresh hourly view every 30 minutes
SELECT add_continuous_aggregate_policy('price_history_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);

-- Refresh daily view every 6 hours
SELECT add_continuous_aggregate_policy('price_history_daily',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '6 hours',
    if_not_exists => TRUE
);

-- ============================================================================
-- Retention Policies
-- ============================================================================

-- Keep raw data for 30 days
SELECT add_retention_policy('price_history',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Note: Continuous aggregates are NOT affected by retention policies
-- Hourly and daily aggregates persist indefinitely

-- ============================================================================
-- Compression Policy (for older data)
-- ============================================================================

-- Enable compression on price_history
ALTER TABLE price_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'event_id, section',
    timescaledb.compress_orderby = 'time DESC'
);

-- Compress chunks older than 7 days
SELECT add_compression_policy('price_history',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- ============================================================================
-- Alert Metrics Table (for monitoring/analytics)
-- ============================================================================

CREATE TABLE alert_metrics (
    time TIMESTAMPTZ NOT NULL,

    -- Dimensions
    channel VARCHAR(20) NOT NULL,
    alert_type VARCHAR(30) NOT NULL,

    -- Metrics
    alerts_sent INTEGER DEFAULT 0,
    alerts_delivered INTEGER DEFAULT 0,
    alerts_failed INTEGER DEFAULT 0,
    avg_latency_ms INTEGER,

    -- Unique users/events reached
    unique_users INTEGER DEFAULT 0,
    unique_events INTEGER DEFAULT 0
);

-- Convert to hypertable
SELECT create_hypertable('alert_metrics', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX idx_alert_metrics_channel
    ON alert_metrics(channel, time DESC);

-- ============================================================================
-- Helper Functions for Time-Series Queries
-- ============================================================================

-- Get price trend for an event/section over time
CREATE OR REPLACE FUNCTION get_price_trend(
    p_event_id UUID,
    p_section VARCHAR(100) DEFAULT NULL,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    bucket TIMESTAMPTZ,
    avg_price DECIMAL(10,2),
    min_price DECIMAL(10,2),
    total_listings BIGINT
) AS $$
BEGIN
    IF p_section IS NULL THEN
        RETURN QUERY
        SELECT
            phd.bucket,
            phd.avg_price,
            phd.min_price,
            phd.total_listings
        FROM price_history_daily phd
        WHERE phd.event_id = p_event_id
          AND phd.bucket >= NOW() - (p_days || ' days')::INTERVAL
        ORDER BY phd.bucket;
    ELSE
        RETURN QUERY
        SELECT
            phd.bucket,
            phd.avg_price,
            phd.min_price,
            phd.total_listings
        FROM price_history_daily phd
        WHERE phd.event_id = p_event_id
          AND phd.section = p_section
          AND phd.bucket >= NOW() - (p_days || ' days')::INTERVAL
        ORDER BY phd.bucket;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Check if current price is at historical low
CREATE OR REPLACE FUNCTION is_historical_low(
    p_event_id UUID,
    p_section VARCHAR(100),
    p_current_price DECIMAL(10,2)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_historical_low DECIMAL(10,2);
BEGIN
    SELECT MIN(min_price) INTO v_historical_low
    FROM price_history_daily
    WHERE event_id = p_event_id
      AND section = p_section;

    IF v_historical_low IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Consider it a historical low if within 5% of the lowest recorded
    RETURN p_current_price <= (v_historical_low * 1.05);
END;
$$ LANGUAGE plpgsql;
