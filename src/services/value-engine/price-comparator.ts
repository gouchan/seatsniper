/**
 * Price Comparator Service
 * Compares prices across platforms for the same event to find best deals.
 */

import type { NormalizedListing, NormalizedEvent } from '../../adapters/base/platform-adapter.interface.js';

// ============================================================================
// Types
// ============================================================================

export interface PlatformPrice {
  platform: string;
  price: number;
  url: string;
  quantity: number;
}

export interface SectionComparison {
  section: string;
  prices: PlatformPrice[];
  bestDeal: {
    platform: string;
    price: number;
    url: string;
    savings: number; // vs next cheapest
    savingsPercent: number;
  } | null;
}

export interface EventComparison {
  canonicalName: string;
  venueName: string;
  eventDate: Date;
  sections: SectionComparison[];
  overallBestDeal: {
    section: string;
    platform: string;
    price: number;
    url: string;
  } | null;
  platformsCompared: string[];
}

// ============================================================================
// Section Name Normalization
// ============================================================================

/**
 * Normalize section names for comparison across platforms.
 * Different platforms use different formats:
 * - "Section 100" vs "Sec 100" vs "SEC100"
 * - "Floor" vs "GA Floor" vs "General Admission"
 */
function normalizeSectionName(section: string): string {
  return section
    .toLowerCase()
    .replace(/\bsec\.?\b/gi, 'section')
    .replace(/\bga\b/gi, 'general admission')
    .replace(/\brow\s*\d+\b/gi, '') // Remove row info for section comparison
    .replace(/[^\w\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ')
    .trim();
}

// sectionsMatch is available for future use (e.g., cross-platform section deduplication)

/**
 * Extract section number from a section name
 */
function extractSectionNumber(section: string): number | null {
  const match = section.match(/(?:section|sec)?\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// Price Comparison Logic
// ============================================================================

/**
 * Compare prices for listings across multiple platforms for the same event.
 */
export function comparePrices(
  platformListings: Map<string, { event: NormalizedEvent; listings: NormalizedListing[] }>
): EventComparison | null {
  if (platformListings.size < 2) {
    return null; // Need at least 2 platforms to compare
  }

  // Get event info from first platform
  const firstPlatform = platformListings.values().next().value;
  if (!firstPlatform) return null;

  const { event } = firstPlatform;

  // Build a map of normalized section -> platform prices
  const sectionPrices = new Map<string, Map<string, PlatformPrice>>();

  for (const [platform, data] of platformListings) {
    for (const listing of data.listings) {
      const normalizedSection = normalizeSectionName(listing.section);

      if (!sectionPrices.has(normalizedSection)) {
        sectionPrices.set(normalizedSection, new Map());
      }

      const platformMap = sectionPrices.get(normalizedSection)!;

      // Keep the lowest price per platform per section
      const existing = platformMap.get(platform);
      if (!existing || listing.pricePerTicket < existing.price) {
        platformMap.set(platform, {
          platform,
          price: listing.pricePerTicket,
          url: listing.deepLink,
          quantity: listing.quantity,
        });
      }
    }
  }

  // Build section comparisons
  const sections: SectionComparison[] = [];
  let overallBestDeal: EventComparison['overallBestDeal'] = null;

  for (const [section, platformMap] of sectionPrices) {
    const prices = Array.from(platformMap.values()).sort((a, b) => a.price - b.price);

    let bestDeal: SectionComparison['bestDeal'] = null;

    if (prices.length >= 1) {
      const lowest = prices[0];
      const nextLowest = prices[1];

      const savings = nextLowest ? nextLowest.price - lowest.price : 0;
      const savingsPercent = nextLowest
        ? Math.round((savings / nextLowest.price) * 100)
        : 0;

      bestDeal = {
        platform: lowest.platform,
        price: lowest.price,
        url: lowest.url,
        savings,
        savingsPercent,
      };

      // Track overall best deal
      if (!overallBestDeal || lowest.price < overallBestDeal.price) {
        overallBestDeal = {
          section,
          platform: lowest.platform,
          price: lowest.price,
          url: lowest.url,
        };
      }
    }

    sections.push({
      section,
      prices,
      bestDeal,
    });
  }

  // Sort sections by section number/name
  sections.sort((a, b) => {
    const numA = extractSectionNumber(a.section) ?? 999;
    const numB = extractSectionNumber(b.section) ?? 999;
    return numA - numB;
  });

  return {
    canonicalName: event.name,
    venueName: event.venue.name,
    eventDate: event.dateTime,
    sections,
    overallBestDeal,
    platformsCompared: Array.from(platformListings.keys()),
  };
}

/**
 * Format price comparison for display (compact version for alerts)
 */
export function formatComparisonSummary(comparison: EventComparison): string {
  const lines: string[] = [];

  // Header
  lines.push(`\n💰 Cross-Platform Comparison:`);
  lines.push(`   Platforms: ${comparison.platformsCompared.map(p => getPlatformEmoji(p)).join(' vs ')}`);

  // Top 3 sections with best deals
  const topDeals = comparison.sections
    .filter(s => s.bestDeal && s.prices.length > 1)
    .slice(0, 3);

  if (topDeals.length > 0) {
    lines.push(`\n   Best Deals:`);
    for (const section of topDeals) {
      const deal = section.bestDeal!;
      const priceList = section.prices
        .map(p => `${getPlatformAbbrev(p.platform)} $${p.price}`)
        .join(' < ');
      lines.push(`   • ${section.section}: ${priceList}`);
      if (deal.savings > 0) {
        lines.push(`     ✓ Save $${deal.savings} (${deal.savingsPercent}%) on ${getPlatformAbbrev(deal.platform)}`);
      }
    }
  }

  // Overall best
  if (comparison.overallBestDeal) {
    const best = comparison.overallBestDeal;
    lines.push(`\n   🏆 Overall Best: ${best.section} on ${getPlatformAbbrev(best.platform)} @ $${best.price}`);
  }

  return lines.join('\n');
}

/**
 * Get platform emoji
 */
function getPlatformEmoji(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'ticketmaster':
      return '🎫 TM';
    case 'seatgeek':
      return '🪑 SG';
    case 'stubhub':
      return '🎟️ SH';
    default:
      return platform;
  }
}

/**
 * Get platform abbreviation
 */
function getPlatformAbbrev(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'ticketmaster':
      return 'TM';
    case 'seatgeek':
      return 'SG';
    case 'stubhub':
      return 'SH';
    default:
      return platform;
  }
}
