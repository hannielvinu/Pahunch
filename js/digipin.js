// DIGIPIN (India Post's open national addressing grid), written from the public specification.
// India's bounding box (2.5–38.5°N, 63.5–99.5°E) is split 4×4 ten times; each level adds one symbol.
// Level 10 cells are about 3.8 m × 3.8 m. Stored as 10 characters, no hyphens; shown in 3-4-3 groups.
// Checked against India Post's published examples (4P3JK852C9 ↔ 12.971601, 77.594584; 4T396F42L7).
const GRID = [
  ['F', 'C', '9', '8'],
  ['J', '3', '2', '7'],
  ['K', '4', '5', '6'],
  ['L', 'M', 'P', 'T'],
];
const BOUNDS = { minLat: 2.5, maxLat: 38.5, minLon: 63.5, maxLon: 99.5 };

export function inIndiaGrid(lat, lon) {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;
}

export function encodeDigipin(lat, lon) {
  if (!inIndiaGrid(lat, lon)) return null;
  let { minLat, maxLat, minLon, maxLon } = BOUNDS;
  let out = '';
  for (let level = 1; level <= 10; level++) {
    const latDiv = (maxLat - minLat) / 4, lonDiv = (maxLon - minLon) / 4;
    // Row 0 is the northern strip; clamp so points on the upper/right edge stay in the grid.
    const row = Math.min(3, Math.max(0, 3 - Math.floor((lat - minLat) / latDiv)));
    const col = Math.min(3, Math.max(0, Math.floor((lon - minLon) / lonDiv)));
    out += GRID[row][col];
    maxLat = minLat + latDiv * (4 - row);
    minLat = minLat + latDiv * (3 - row);
    minLon = minLon + lonDiv * col;
    maxLon = minLon + lonDiv;
  }
  return out;
}

export const formatDigipin = (pin) => (pin ? `${pin.slice(0, 3)} ${pin.slice(3, 7)} ${pin.slice(7)}` : '');

// Centre of the cell, or null for an invalid code.
export function decodeDigipin(code) {
  const pin = String(code).toUpperCase().replace(/[\s-]/g, '');
  if (pin.length !== 10) return null;
  let { minLat, maxLat, minLon, maxLon } = BOUNDS;
  for (const ch of pin) {
    let row = -1, col = -1;
    GRID.forEach((r, i) => { const j = r.indexOf(ch); if (j >= 0) { row = i; col = j; } });
    if (row < 0) return null;
    const latDiv = (maxLat - minLat) / 4, lonDiv = (maxLon - minLon) / 4;
    maxLat = minLat + latDiv * (4 - row);
    minLat = minLat + latDiv * (3 - row);
    minLon = minLon + lonDiv * col;
    maxLon = minLon + lonDiv;
  }
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}
