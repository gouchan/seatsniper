/**
 * Seat Map Registry
 * Defines venue seat maps with section coordinates for highlighting
 *
 * NOTE: Section polygon coordinates should be mapped from actual seat map images.
 * The coordinates below are approximate and should be calibrated with real images.
 *
 * To add a new venue:
 * 1. Add the seat map image to assets/seat-maps/
 * 2. Determine image dimensions
 * 3. Map section polygons using an image editor (get pixel coordinates)
 * 4. Add entry to this registry
 */

import type { VenueSeatMap, SeatMapRegistry } from './seat-map.types.js';

// ============================================================================
// Moda Center (Portland Trail Blazers)
// ============================================================================

const MODA_CENTER: VenueSeatMap = {
  venueId: 'moda-center',
  venueName: 'Moda Center',
  city: 'Portland',
  state: 'OR',
  imageFile: 'moda-center.jpg',
  imageWidth: 800,
  imageHeight: 600,
  officialMapUrl: 'https://www.rosequarter.com/moda-center/seating-chart',
  attribution: 'Rose Quarter',
  sections: [
    // Lower Bowl (100 level) - Premium
    { sectionId: '100', sectionName: 'Section 100', points: [{ x: 380, y: 450 }, { x: 420, y: 450 }, { x: 420, y: 480 }, { x: 380, y: 480 }], center: { x: 400, y: 465 } },
    { sectionId: '101', sectionName: 'Section 101', points: [{ x: 340, y: 440 }, { x: 380, y: 450 }, { x: 380, y: 480 }, { x: 340, y: 470 }], center: { x: 360, y: 460 } },
    { sectionId: '102', sectionName: 'Section 102', points: [{ x: 300, y: 420 }, { x: 340, y: 440 }, { x: 340, y: 470 }, { x: 300, y: 450 }], center: { x: 320, y: 445 } },
    { sectionId: '103', sectionName: 'Section 103', points: [{ x: 260, y: 390 }, { x: 300, y: 420 }, { x: 300, y: 450 }, { x: 260, y: 420 }], center: { x: 280, y: 420 } },
    { sectionId: '104', sectionName: 'Section 104', points: [{ x: 230, y: 350 }, { x: 260, y: 390 }, { x: 260, y: 420 }, { x: 230, y: 380 }], center: { x: 245, y: 385 } },
    { sectionId: '105', sectionName: 'Section 105', points: [{ x: 210, y: 310 }, { x: 230, y: 350 }, { x: 230, y: 380 }, { x: 210, y: 340 }], center: { x: 220, y: 345 } },
    { sectionId: '106', sectionName: 'Section 106', points: [{ x: 200, y: 270 }, { x: 210, y: 310 }, { x: 210, y: 340 }, { x: 200, y: 300 }], center: { x: 205, y: 305 } },
    { sectionId: '107', sectionName: 'Section 107', points: [{ x: 200, y: 230 }, { x: 200, y: 270 }, { x: 200, y: 300 }, { x: 200, y: 260 }], center: { x: 205, y: 265 } },
    { sectionId: '108', sectionName: 'Section 108', points: [{ x: 210, y: 190 }, { x: 200, y: 230 }, { x: 200, y: 260 }, { x: 210, y: 220 }], center: { x: 205, y: 225 } },
    { sectionId: '109', sectionName: 'Section 109', points: [{ x: 230, y: 150 }, { x: 210, y: 190 }, { x: 210, y: 220 }, { x: 230, y: 180 }], center: { x: 220, y: 185 } },
    { sectionId: '110', sectionName: 'Section 110', points: [{ x: 260, y: 120 }, { x: 230, y: 150 }, { x: 230, y: 180 }, { x: 260, y: 150 }], center: { x: 245, y: 150 } },
    { sectionId: '111', sectionName: 'Section 111', points: [{ x: 300, y: 100 }, { x: 260, y: 120 }, { x: 260, y: 150 }, { x: 300, y: 130 }], center: { x: 280, y: 125 } },
    { sectionId: '112', sectionName: 'Section 112', points: [{ x: 340, y: 90 }, { x: 300, y: 100 }, { x: 300, y: 130 }, { x: 340, y: 120 }], center: { x: 320, y: 110 } },
    { sectionId: '113', sectionName: 'Section 113', points: [{ x: 380, y: 85 }, { x: 340, y: 90 }, { x: 340, y: 120 }, { x: 380, y: 115 }], center: { x: 360, y: 102 } },
    { sectionId: '114', sectionName: 'Section 114', points: [{ x: 420, y: 85 }, { x: 380, y: 85 }, { x: 380, y: 115 }, { x: 420, y: 115 }], center: { x: 400, y: 100 } },
    { sectionId: '115', sectionName: 'Section 115', points: [{ x: 460, y: 90 }, { x: 420, y: 85 }, { x: 420, y: 115 }, { x: 460, y: 120 }], center: { x: 440, y: 102 } },
    { sectionId: '116', sectionName: 'Section 116', points: [{ x: 500, y: 100 }, { x: 460, y: 90 }, { x: 460, y: 120 }, { x: 500, y: 130 }], center: { x: 480, y: 110 } },
    { sectionId: '117', sectionName: 'Section 117', points: [{ x: 540, y: 120 }, { x: 500, y: 100 }, { x: 500, y: 130 }, { x: 540, y: 150 }], center: { x: 520, y: 125 } },
    { sectionId: '118', sectionName: 'Section 118', points: [{ x: 570, y: 150 }, { x: 540, y: 120 }, { x: 540, y: 150 }, { x: 570, y: 180 }], center: { x: 555, y: 150 } },
    { sectionId: '119', sectionName: 'Section 119', points: [{ x: 590, y: 190 }, { x: 570, y: 150 }, { x: 570, y: 180 }, { x: 590, y: 220 }], center: { x: 580, y: 185 } },
    { sectionId: '120', sectionName: 'Section 120', points: [{ x: 600, y: 230 }, { x: 590, y: 190 }, { x: 590, y: 220 }, { x: 600, y: 260 }], center: { x: 595, y: 225 } },
    { sectionId: '121', sectionName: 'Section 121', points: [{ x: 600, y: 270 }, { x: 600, y: 230 }, { x: 600, y: 260 }, { x: 600, y: 300 }], center: { x: 595, y: 265 } },
    { sectionId: '122', sectionName: 'Section 122', points: [{ x: 590, y: 310 }, { x: 600, y: 270 }, { x: 600, y: 300 }, { x: 590, y: 340 }], center: { x: 595, y: 305 } },

    // Club Level (Courtside)
    { sectionId: 'courtside', sectionName: 'Courtside', points: [{ x: 320, y: 250 }, { x: 480, y: 250 }, { x: 480, y: 350 }, { x: 320, y: 350 }], center: { x: 400, y: 300 } },
    { sectionId: 'floor', sectionName: 'Floor', points: [{ x: 300, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 400 }, { x: 300, y: 400 }], center: { x: 400, y: 300 } },

    // Upper Bowl (300 level) - samples
    { sectionId: '300', sectionName: 'Section 300', points: [{ x: 360, y: 520 }, { x: 440, y: 520 }, { x: 440, y: 560 }, { x: 360, y: 560 }], center: { x: 400, y: 540 } },
    { sectionId: '312', sectionName: 'Section 312', points: [{ x: 320, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 70 }, { x: 320, y: 70 }], center: { x: 340, y: 55 } },
    { sectionId: '324', sectionName: 'Section 324', points: [{ x: 440, y: 40 }, { x: 480, y: 40 }, { x: 480, y: 70 }, { x: 440, y: 70 }], center: { x: 460, y: 55 } },
  ],
};

// ============================================================================
// Climate Pledge Arena (Seattle Kraken)
// ============================================================================

const CLIMATE_PLEDGE_ARENA: VenueSeatMap = {
  venueId: 'climate-pledge-arena',
  venueName: 'Climate Pledge Arena',
  city: 'Seattle',
  state: 'WA',
  imageFile: 'climate-pledge-arena.jpg',
  imageWidth: 800,
  imageHeight: 600,
  officialMapUrl: 'https://climatepledgearena.com/seating-charts/',
  attribution: 'Climate Pledge Arena',
  sections: [
    // Lower Bowl samples
    { sectionId: '101', sectionName: 'Section 101', points: [{ x: 200, y: 250 }, { x: 240, y: 230 }, { x: 260, y: 280 }, { x: 220, y: 300 }], center: { x: 230, y: 265 } },
    { sectionId: '102', sectionName: 'Section 102', points: [{ x: 240, y: 230 }, { x: 290, y: 210 }, { x: 310, y: 260 }, { x: 260, y: 280 }], center: { x: 275, y: 245 } },
    { sectionId: '112', sectionName: 'Section 112', points: [{ x: 360, y: 180 }, { x: 440, y: 180 }, { x: 440, y: 220 }, { x: 360, y: 220 }], center: { x: 400, y: 200 } },
    { sectionId: '118', sectionName: 'Section 118', points: [{ x: 510, y: 210 }, { x: 560, y: 230 }, { x: 540, y: 280 }, { x: 490, y: 260 }], center: { x: 525, y: 245 } },
    { sectionId: '124', sectionName: 'Section 124', points: [{ x: 360, y: 380 }, { x: 440, y: 380 }, { x: 440, y: 420 }, { x: 360, y: 420 }], center: { x: 400, y: 400 } },

    // Floor/Pit
    { sectionId: 'floor', sectionName: 'Floor', points: [{ x: 300, y: 240 }, { x: 500, y: 240 }, { x: 500, y: 360 }, { x: 300, y: 360 }], center: { x: 400, y: 300 } },

    // Upper Bowl samples
    { sectionId: '201', sectionName: 'Section 201', points: [{ x: 150, y: 220 }, { x: 190, y: 200 }, { x: 210, y: 250 }, { x: 170, y: 270 }], center: { x: 180, y: 235 } },
    { sectionId: '212', sectionName: 'Section 212', points: [{ x: 340, y: 130 }, { x: 460, y: 130 }, { x: 460, y: 170 }, { x: 340, y: 170 }], center: { x: 400, y: 150 } },
  ],
};

// ============================================================================
// Lumen Field (Seattle Seahawks / Sounders)
// ============================================================================

const LUMEN_FIELD: VenueSeatMap = {
  venueId: 'lumen-field',
  venueName: 'Lumen Field',
  city: 'Seattle',
  state: 'WA',
  imageFile: 'lumen-field.jpg',
  imageWidth: 900,
  imageHeight: 600,
  officialMapUrl: 'https://www.lumenfield.com/seating-chart',
  attribution: 'Lumen Field',
  sections: [
    // Lower Bowl samples (100 level)
    { sectionId: '107', sectionName: 'Section 107', points: [{ x: 100, y: 280 }, { x: 140, y: 260 }, { x: 160, y: 310 }, { x: 120, y: 330 }], center: { x: 130, y: 295 } },
    { sectionId: '121', sectionName: 'Section 121', points: [{ x: 380, y: 180 }, { x: 440, y: 180 }, { x: 440, y: 220 }, { x: 380, y: 220 }], center: { x: 410, y: 200 } },
    { sectionId: '135', sectionName: 'Section 135', points: [{ x: 740, y: 260 }, { x: 780, y: 280 }, { x: 760, y: 330 }, { x: 720, y: 310 }], center: { x: 750, y: 295 } },

    // Club Level samples
    { sectionId: 'club', sectionName: 'Club Level', points: [{ x: 350, y: 250 }, { x: 550, y: 250 }, { x: 550, y: 350 }, { x: 350, y: 350 }], center: { x: 450, y: 300 } },

    // Upper Bowl samples (300 level)
    { sectionId: '307', sectionName: 'Section 307', points: [{ x: 60, y: 250 }, { x: 100, y: 230 }, { x: 120, y: 280 }, { x: 80, y: 300 }], center: { x: 90, y: 265 } },
    { sectionId: '335', sectionName: 'Section 335', points: [{ x: 780, y: 230 }, { x: 820, y: 250 }, { x: 800, y: 300 }, { x: 760, y: 280 }], center: { x: 790, y: 265 } },
  ],
};

// ============================================================================
// Tacoma Dome
// ============================================================================

const TACOMA_DOME: VenueSeatMap = {
  venueId: 'tacoma-dome',
  venueName: 'Tacoma Dome',
  city: 'Tacoma',
  state: 'WA',
  imageFile: 'tacoma-dome.jpg',
  imageWidth: 800,
  imageHeight: 600,
  officialMapUrl: 'https://www.tacomadome.org/seating-charts',
  attribution: 'Tacoma Dome',
  sections: [
    // Floor
    { sectionId: 'floor', sectionName: 'Floor', points: [{ x: 300, y: 220 }, { x: 500, y: 220 }, { x: 500, y: 380 }, { x: 300, y: 380 }], center: { x: 400, y: 300 } },

    // Lower Bowl (100 level)
    { sectionId: '101', sectionName: 'Section 101', points: [{ x: 200, y: 240 }, { x: 250, y: 220 }, { x: 270, y: 280 }, { x: 220, y: 300 }], center: { x: 235, y: 260 } },
    { sectionId: '104', sectionName: 'Section 104', points: [{ x: 340, y: 160 }, { x: 400, y: 150 }, { x: 410, y: 200 }, { x: 350, y: 210 }], center: { x: 375, y: 180 } },
    { sectionId: '108', sectionName: 'Section 108', points: [{ x: 550, y: 220 }, { x: 600, y: 240 }, { x: 580, y: 300 }, { x: 530, y: 280 }], center: { x: 565, y: 260 } },

    // Upper Bowl (200 level)
    { sectionId: '201', sectionName: 'Section 201', points: [{ x: 140, y: 200 }, { x: 190, y: 180 }, { x: 210, y: 240 }, { x: 160, y: 260 }], center: { x: 175, y: 220 } },
    { sectionId: '204', sectionName: 'Section 204', points: [{ x: 320, y: 100 }, { x: 400, y: 90 }, { x: 410, y: 140 }, { x: 330, y: 150 }], center: { x: 365, y: 120 } },
  ],
};

// ============================================================================
// Providence Park (Portland Timbers)
// ============================================================================

const PROVIDENCE_PARK: VenueSeatMap = {
  venueId: 'providence-park',
  venueName: 'Providence Park',
  city: 'Portland',
  state: 'OR',
  imageFile: 'providence-park.jpg',
  imageWidth: 900,
  imageHeight: 550,
  officialMapUrl: 'https://www.providenceparkpdx.com/seating-chart',
  attribution: 'Providence Park',
  sections: [
    // Lower Level
    { sectionId: '107', sectionName: 'Section 107', points: [{ x: 100, y: 250 }, { x: 150, y: 250 }, { x: 150, y: 300 }, { x: 100, y: 300 }], center: { x: 125, y: 275 } },
    { sectionId: '108', sectionName: 'Section 108', points: [{ x: 150, y: 250 }, { x: 200, y: 250 }, { x: 200, y: 300 }, { x: 150, y: 300 }], center: { x: 175, y: 275 } },

    // Timbers Army (north end)
    { sectionId: 'army', sectionName: 'Timbers Army', points: [{ x: 350, y: 80 }, { x: 550, y: 80 }, { x: 550, y: 150 }, { x: 350, y: 150 }], center: { x: 450, y: 115 } },

    // Upper Level
    { sectionId: '207', sectionName: 'Section 207', points: [{ x: 60, y: 200 }, { x: 110, y: 200 }, { x: 110, y: 250 }, { x: 60, y: 250 }], center: { x: 85, y: 225 } },
  ],
};

// ============================================================================
// Registry Export
// ============================================================================

export const VENUE_SEAT_MAPS: SeatMapRegistry = new Map([
  ['moda-center', MODA_CENTER],
  ['climate-pledge-arena', CLIMATE_PLEDGE_ARENA],
  ['lumen-field', LUMEN_FIELD],
  ['tacoma-dome', TACOMA_DOME],
  ['providence-park', PROVIDENCE_PARK],
]);

/**
 * Get a list of all supported venues
 */
export function getSupportedVenues(): string[] {
  return Array.from(VENUE_SEAT_MAPS.values()).map(v => `${v.venueName} (${v.city}, ${v.state})`);
}
