# Seat Map Images

This directory contains venue seating chart images used by SeatSniper to generate highlighted alerts.

## Required Images

| Venue | Filename | Dimensions | Source |
|-------|----------|------------|--------|
| Moda Center | `moda-center.jpg` | 800x600 | [Rose Quarter](https://www.rosequarter.com/moda-center/seating-chart) |
| Climate Pledge Arena | `climate-pledge-arena.jpg` | 800x600 | [Climate Pledge](https://climatepledgearena.com/seating-charts/) |
| Lumen Field | `lumen-field.jpg` | 900x600 | [Lumen Field](https://www.lumenfield.com/seating-chart) |
| Tacoma Dome | `tacoma-dome.jpg` | 800x600 | [Tacoma Dome](https://www.tacomadome.org/seating-charts) |
| Providence Park | `providence-park.jpg` | 900x550 | [Providence Park](https://www.providenceparkpdx.com/seating-chart) |

## How to Add a New Venue

1. **Get the seating chart image**
   - Download from venue's official website
   - Or screenshot and crop the interactive seat map
   - Resize to approximately 800x600 pixels

2. **Name the file**
   - Use lowercase with hyphens: `venue-name.jpg`
   - Prefer JPEG for photos, PNG for vector graphics

3. **Map section coordinates**
   - Open image in an editor that shows pixel coordinates
   - For each section, note the polygon corner points (clockwise)
   - Note the center point for label placement

4. **Add to registry**
   - Edit `src/venues/seat-map.registry.ts`
   - Add a new `VenueSeatMap` entry with section polygons

## Coordinate Mapping Tips

- Use a tool like GIMP, Photoshop, or online tools to get pixel coordinates
- Sections are defined as polygons with 4+ corner points
- Points should be in clockwise order
- Center point is used for rank labels

## Example Polygon Definition

```typescript
{
  sectionId: '112',
  sectionName: 'Section 112',
  points: [
    { x: 340, y: 90 },   // Top-left
    { x: 380, y: 90 },   // Top-right
    { x: 380, y: 130 },  // Bottom-right
    { x: 340, y: 130 }   // Bottom-left
  ],
  center: { x: 360, y: 110 }
}
```

## Notes

- Images are NOT committed to git (added to .gitignore)
- You must manually add images to this directory after cloning
- If an image is missing, alerts will be sent without seat maps
