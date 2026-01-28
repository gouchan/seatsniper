/**
 * Seat Map Service
 * Handles loading venue seat maps from APIs (Ticketmaster, SeatGeek) and local fallbacks
 */

import sharp from 'sharp';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  VenueSeatMap,
  SectionPolygon,
  HighlightOptions,
  SeatMapRegistry,
} from './seat-map.types.js';
import { DEFAULT_HIGHLIGHT_OPTIONS } from './seat-map.types.js';
import { VENUE_SEAT_MAPS } from './seat-map.registry.js';
import { logger } from '../utils/logger.js';

// Get directory path for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Seat Map Service
// ============================================================================

export class SeatMapService {
  private registry: SeatMapRegistry;
  private assetsPath: string;
  private urlCache: Map<string, Buffer> = new Map();

  constructor() {
    this.registry = VENUE_SEAT_MAPS;
    this.assetsPath = path.join(__dirname, '../../assets/seat-maps');
  }

  // ==========================================================================
  // Venue Lookup
  // ==========================================================================

  /**
   * Find a venue seat map by name (fuzzy matching)
   */
  findVenue(venueName: string): VenueSeatMap | undefined {
    const normalizedSearch = this.normalizeVenueName(venueName);

    // Try exact match first
    if (this.registry.has(normalizedSearch)) {
      return this.registry.get(normalizedSearch);
    }

    // Try partial match
    for (const [key, seatMap] of this.registry) {
      if (key.includes(normalizedSearch) || normalizedSearch.includes(key)) {
        return seatMap;
      }
    }

    // Try matching by venue name in the map
    for (const seatMap of this.registry.values()) {
      const normalizedMapName = this.normalizeVenueName(seatMap.venueName);
      if (
        normalizedMapName.includes(normalizedSearch) ||
        normalizedSearch.includes(normalizedMapName)
      ) {
        return seatMap;
      }
    }

    return undefined;
  }

  /**
   * Get all available venues
   */
  getAvailableVenues(): string[] {
    return Array.from(this.registry.values()).map(v => v.venueName);
  }

  /**
   * Check if a venue has a seat map
   */
  hasVenue(venueName: string): boolean {
    return this.findVenue(venueName) !== undefined;
  }

  // ==========================================================================
  // Section Lookup
  // ==========================================================================

  /**
   * Find a section polygon by section name/number
   */
  findSection(venue: VenueSeatMap, sectionName: string): SectionPolygon | undefined {
    const normalizedSection = sectionName.toLowerCase().trim();

    // Try exact match
    let section = venue.sections.find(
      s => s.sectionId.toLowerCase() === normalizedSection ||
           s.sectionName.toLowerCase() === normalizedSection
    );

    if (section) return section;

    // Try partial match (e.g., "112" matches "Section 112")
    section = venue.sections.find(
      s => s.sectionId.includes(normalizedSection) ||
           s.sectionName.toLowerCase().includes(normalizedSection) ||
           normalizedSection.includes(s.sectionId)
    );

    return section;
  }

  // ==========================================================================
  // Image Generation
  // ==========================================================================

  /**
   * Generate a seat map image with highlighted section
   */
  async generateHighlightedMap(
    venueName: string,
    sectionName: string,
    options: Partial<HighlightOptions> = {}
  ): Promise<Buffer | null> {
    const venue = this.findVenue(venueName);
    if (!venue) {
      logger.warn(`[SeatMap] Venue not found: ${venueName}`);
      return null;
    }

    const section = this.findSection(venue, sectionName);
    if (!section) {
      logger.warn(`[SeatMap] Section not found: ${sectionName} at ${venueName}`);
      // Return base image without highlighting
      return this.getBaseImage(venue);
    }

    const mergedOptions = { ...DEFAULT_HIGHLIGHT_OPTIONS, ...options };

    try {
      const imagePath = path.join(this.assetsPath, venue.imageFile);

      // Create SVG overlay for the highlight
      const svg = this.createHighlightSvg(
        section,
        venue.imageWidth,
        venue.imageHeight,
        mergedOptions
      );

      // Composite the highlight onto the base image
      const highlightedImage = await sharp(imagePath)
        .composite([{
          input: Buffer.from(svg),
          top: 0,
          left: 0,
        }])
        .jpeg({ quality: 85 })
        .toBuffer();

      logger.info(`[SeatMap] Generated highlighted map for ${venueName} section ${sectionName}`);
      return highlightedImage;
    } catch (error) {
      logger.error(`[SeatMap] Failed to generate highlighted map`, {
        venue: venueName,
        section: sectionName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Get the base seat map image without highlighting
   */
  async getBaseImage(venue: VenueSeatMap): Promise<Buffer | null> {
    try {
      const imagePath = path.join(this.assetsPath, venue.imageFile);
      return await sharp(imagePath).jpeg({ quality: 85 }).toBuffer();
    } catch (error) {
      logger.error(`[SeatMap] Failed to load base image for ${venue.venueName}`);
      return null;
    }
  }

  /**
   * Generate a multi-section highlighted map (for showing multiple deals)
   */
  async generateMultiHighlightMap(
    venueName: string,
    sections: Array<{ sectionName: string; rank: number }>
  ): Promise<Buffer | null> {
    const venue = this.findVenue(venueName);
    if (!venue) {
      logger.warn(`[SeatMap] Venue not found: ${venueName}`);
      return null;
    }

    try {
      const imagePath = path.join(this.assetsPath, venue.imageFile);

      // Create SVG overlays for all sections
      const svgParts: string[] = [];

      for (const { sectionName, rank } of sections) {
        const section = this.findSection(venue, sectionName);
        if (!section) continue;

        // Different colors for different ranks
        const color = this.getRankColor(rank);
        svgParts.push(this.createSectionPath(section, color, rank));
      }

      if (svgParts.length === 0) {
        return this.getBaseImage(venue);
      }

      const svg = `<svg width="${venue.imageWidth}" height="${venue.imageHeight}" xmlns="http://www.w3.org/2000/svg">
        ${svgParts.join('\n')}
      </svg>`;

      const highlightedImage = await sharp(imagePath)
        .composite([{
          input: Buffer.from(svg),
          top: 0,
          left: 0,
        }])
        .jpeg({ quality: 85 })
        .toBuffer();

      logger.info(`[SeatMap] Generated multi-highlight map for ${venueName} with ${sections.length} sections`);
      return highlightedImage;
    } catch (error) {
      logger.error(`[SeatMap] Failed to generate multi-highlight map`, {
        venue: venueName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  // ==========================================================================
  // SVG Generation Helpers
  // ==========================================================================

  /**
   * Create an SVG for highlighting a section
   */
  private createHighlightSvg(
    section: SectionPolygon,
    width: number,
    height: number,
    options: HighlightOptions
  ): string {
    const pathD = this.pointsToSvgPath(section.points);
    const { fillColor, strokeColor, strokeWidth, showLabel, labelText } = options;

    const fillRgba = `rgba(${fillColor.r}, ${fillColor.g}, ${fillColor.b}, ${fillColor.a})`;
    const strokeRgb = `rgb(${strokeColor.r}, ${strokeColor.g}, ${strokeColor.b})`;

    let labelSvg = '';
    if (showLabel) {
      const text = labelText || section.sectionName;
      labelSvg = `
        <text
          x="${section.center.x}"
          y="${section.center.y}"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="Arial, sans-serif"
          font-size="16"
          font-weight="bold"
          fill="white"
          stroke="black"
          stroke-width="1"
        >${text}</text>
      `;
    }

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <path
        d="${pathD}"
        fill="${fillRgba}"
        stroke="${strokeRgb}"
        stroke-width="${strokeWidth}"
      />
      ${labelSvg}
    </svg>`;
  }

  /**
   * Create a path element for multi-highlight mode
   */
  private createSectionPath(
    section: SectionPolygon,
    color: { fill: string; stroke: string },
    rank: number
  ): string {
    const pathD = this.pointsToSvgPath(section.points);

    return `
      <g>
        <path
          d="${pathD}"
          fill="${color.fill}"
          stroke="${color.stroke}"
          stroke-width="3"
        />
        <circle
          cx="${section.center.x}"
          cy="${section.center.y}"
          r="14"
          fill="${color.stroke}"
        />
        <text
          x="${section.center.x}"
          y="${section.center.y}"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="Arial, sans-serif"
          font-size="14"
          font-weight="bold"
          fill="white"
        >${rank}</text>
      </g>
    `;
  }

  /**
   * Convert points array to SVG path d attribute
   */
  private pointsToSvgPath(points: Array<{ x: number; y: number }>): string {
    if (points.length === 0) return '';

    const pathParts = points.map((p, i) =>
      i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
    );
    pathParts.push('Z'); // Close the path

    return pathParts.join(' ');
  }

  /**
   * Get color scheme based on rank (1 = best deal)
   */
  private getRankColor(rank: number): { fill: string; stroke: string } {
    const colors = [
      { fill: 'rgba(255, 215, 0, 0.5)', stroke: 'rgb(255, 165, 0)' },   // Gold - #1
      { fill: 'rgba(192, 192, 192, 0.5)', stroke: 'rgb(128, 128, 128)' }, // Silver - #2
      { fill: 'rgba(205, 127, 50, 0.5)', stroke: 'rgb(139, 69, 19)' },  // Bronze - #3
      { fill: 'rgba(100, 149, 237, 0.4)', stroke: 'rgb(65, 105, 225)' }, // Blue - #4+
      { fill: 'rgba(144, 238, 144, 0.4)', stroke: 'rgb(34, 139, 34)' },  // Green - #5+
    ];

    return colors[Math.min(rank - 1, colors.length - 1)];
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Normalize venue name for lookup
   */
  private normalizeVenueName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Get the official map URL for a venue
   */
  getOfficialMapUrl(venueName: string): string | undefined {
    const venue = this.findVenue(venueName);
    return venue?.officialMapUrl;
  }

  // ==========================================================================
  // URL-Based Seat Map Methods (for Ticketmaster/SeatGeek APIs)
  // ==========================================================================

  /**
   * Fetch a seat map image from a URL (Ticketmaster/SeatGeek static URLs)
   * Returns the image buffer for sending via Telegram
   */
  async fetchSeatMapFromUrl(url: string): Promise<Buffer | null> {
    // Check cache first
    if (this.urlCache.has(url)) {
      logger.debug(`[SeatMap] Cache hit for URL: ${url}`);
      return this.urlCache.get(url) || null;
    }

    try {
      logger.debug(`[SeatMap] Fetching seat map from URL: ${url}`);

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'SeatSniper/1.0',
          'Accept': 'image/*',
        },
      });

      const buffer = Buffer.from(response.data);

      // Validate it's an image and resize if needed
      const processedImage = await sharp(buffer)
        .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Cache for future use (limit cache size)
      if (this.urlCache.size > 50) {
        // Remove oldest entries
        const firstKey = this.urlCache.keys().next().value;
        if (firstKey) this.urlCache.delete(firstKey);
      }
      this.urlCache.set(url, processedImage);

      logger.info(`[SeatMap] Successfully fetched and cached seat map from URL`);
      return processedImage;
    } catch (error) {
      logger.warn(`[SeatMap] Failed to fetch seat map from URL`, {
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Get a seat map image - tries URL first, falls back to local file
   * @param seatMapUrl - Dynamic URL from event (Ticketmaster/SeatGeek)
   * @param venueName - Venue name for local fallback
   */
  async getSeatMapImage(
    seatMapUrl?: string,
    venueName?: string
  ): Promise<Buffer | null> {
    // Try URL first (from API)
    if (seatMapUrl) {
      const urlImage = await this.fetchSeatMapFromUrl(seatMapUrl);
      if (urlImage) return urlImage;
    }

    // Fall back to local venue registry
    if (venueName) {
      const venue = this.findVenue(venueName);
      if (venue) {
        return this.getBaseImage(venue);
      }
    }

    return null;
  }

  /**
   * Check if we can get a seat map for an event (either via URL or local)
   */
  canGetSeatMap(seatMapUrl?: string, venueName?: string): boolean {
    if (seatMapUrl) return true;
    if (venueName && this.hasVenue(venueName)) return true;
    return false;
  }

  /**
   * Clear the URL cache
   */
  clearCache(): void {
    this.urlCache.clear();
    logger.debug('[SeatMap] URL cache cleared');
  }
}
