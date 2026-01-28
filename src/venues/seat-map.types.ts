/**
 * Seat Map Types
 * Data structures for venue seating charts and section highlighting
 */

// ============================================================================
// Section Polygon Coordinates
// ============================================================================

/**
 * A point on the seat map image (in pixels)
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * A polygon defining a section's boundaries on the seat map
 * Points should be in clockwise order
 */
export interface SectionPolygon {
  sectionId: string;
  sectionName: string;
  points: Point[];
  // Center point for label placement
  center: Point;
}

// ============================================================================
// Venue Seat Map Definition
// ============================================================================

export interface VenueSeatMap {
  venueId: string;
  venueName: string;
  city: string;
  state: string;

  // Base image information
  imageFile: string;        // Filename in assets/seat-maps/
  imageWidth: number;       // Original image width in pixels
  imageHeight: number;      // Original image height in pixels

  // Section polygons for highlighting
  sections: SectionPolygon[];

  // Optional: Link to venue's official interactive map
  officialMapUrl?: string;

  // Image attribution if required
  attribution?: string;
}

// ============================================================================
// Highlight Options
// ============================================================================

export interface HighlightOptions {
  // Highlight color (RGBA)
  fillColor: { r: number; g: number; b: number; a: number };
  // Border color
  strokeColor: { r: number; g: number; b: number };
  // Border width
  strokeWidth: number;
  // Whether to add a label
  showLabel: boolean;
  // Label text (defaults to section name)
  labelText?: string;
}

export const DEFAULT_HIGHLIGHT_OPTIONS: HighlightOptions = {
  fillColor: { r: 255, g: 215, b: 0, a: 0.5 },   // Gold with 50% opacity
  strokeColor: { r: 255, g: 69, b: 0 },           // Red-orange border
  strokeWidth: 3,
  showLabel: true,
};

// ============================================================================
// Seat Map Registry
// ============================================================================

/**
 * Registry of all venue seat maps
 * Key is normalized venue name (lowercase, spaces replaced with hyphens)
 */
export type SeatMapRegistry = Map<string, VenueSeatMap>;
