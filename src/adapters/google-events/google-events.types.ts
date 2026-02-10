/**
 * Google Events API Types (via Apify)
 * Data scraped from Google Events search results
 */

// ============================================================================
// Apify Actor Response Types
// ============================================================================

export interface ApifyRunResponse {
  data: {
    id: string;
    actId: string;
    status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED';
    finishedAt: string | null;
    defaultDatasetId: string;
    usageTotalUsd: number;
  };
}

export interface GoogleEventsSearchResult {
  search_parameters: {
    q: string;
    max_pages: number;
  };
  search_metadata: {
    total_results: number;
    events_count: number;
    pages_processed: number;
  };
  search_timestamp: string;
  page_number: number;
  events: GoogleEventItem[];
}

export interface GoogleEventItem {
  title: string;
  date: {
    start_date: string;
    when: string;
    description?: string;
  };
  address: string[];
  link: string;
  event_location_map?: {
    image: string;
    link: string;
  };
  description: string;
  ticket_info: GoogleTicketSource[];
  venue: {
    name: string;
    rating?: number;
    reviews?: number;
    link?: string;
  };
  image?: string;
}

export interface GoogleTicketSource {
  source: string;
  link: string;
  link_type: 'tickets' | 'more info';
  description?: string;
}

// ============================================================================
// Parsed/Extracted Types
// ============================================================================

export interface ExtractedTicketInfo {
  source: string;
  link: string;
  price?: number; // Extracted from URL params if available
  eventId?: string; // Platform-specific event ID
}

export interface GoogleEventsSearchParams {
  query: string;
  maxPages?: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface GoogleEventsConfig {
  apifyToken: string;
  actorId: string;
  timeout: number;
  pollIntervalMs: number;
}
