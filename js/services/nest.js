/**
 * nest.js — material nesting / waste estimation (§9 of the product brief).
 *
 * MVP algorithm: first-fit-decreasing shelf packing of piece bounding boxes,
 * trying both 0° and 90° orientations per piece. Reclaimed textiles are
 * finite, so even a simple packer plus a utilization number is genuinely
 * useful; the module boundary lets a true irregular-shape nester replace
 * this without touching callers.
 *
 * Input pieces: { id, label, wMm, hMm, areaMm2? }
 * Returns { placements: [{ id, label, xMm, yMm, wMm, hMm, rotated }],
 *           sheetWMm, usedHMm, utilization }
 */

const GAP_MM = 4; // cutting clearance between pieces

export function nestPieces(pieces, sheetWMm = 450) {
  const sorted = pieces
    .map((p) => ({ ...p }))
    .sort((a, b) => Math.max(b.wMm, b.hMm) - Math.max(a.wMm, a.hMm));

  const shelves = []; // { yMm, hMm, xCursor }
  const placements = [];

  for (const p of sorted) {
    let w = p.wMm, h = p.hMm, rotated = false;
    // Prefer the orientation that lies flatter (wider than tall): it makes
    // denser shelves. Fall back to the other if it doesn't fit the sheet.
    if (h > w && h <= sheetWMm) { [w, h] = [h, w]; rotated = true; }
    if (w > sheetWMm && h <= sheetWMm) { [w, h] = [h, w]; rotated = !rotated; }
    w = Math.min(w, sheetWMm); // oversize pieces still get a row (flagged by width)

    let placed = false;
    for (const shelf of shelves) {
      if (shelf.xCursor + w <= sheetWMm && h <= shelf.hMm) {
        placements.push({ id: p.id, label: p.label, xMm: shelf.xCursor, yMm: shelf.yMm, wMm: w, hMm: h, rotated });
        shelf.xCursor += w + GAP_MM;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const yMm = shelves.length
        ? shelves[shelves.length - 1].yMm + shelves[shelves.length - 1].hMm + GAP_MM
        : 0;
      shelves.push({ yMm, hMm: h, xCursor: w + GAP_MM });
      placements.push({ id: p.id, label: p.label, xMm: 0, yMm, wMm: w, hMm: h, rotated });
    }
  }

  const usedHMm = shelves.length
    ? shelves[shelves.length - 1].yMm + shelves[shelves.length - 1].hMm
    : 0;

  // Utilization estimate. When a real piece area is unknown, assume the
  // outline fills ~78% of its bounding box (typical for organic appliqué).
  const usedArea = pieces.reduce(
    (sum, p) => sum + (p.areaMm2 ?? p.wMm * p.hMm * 0.78), 0);
  const sheetArea = sheetWMm * usedHMm;
  const utilization = sheetArea > 0 ? Math.min(1, usedArea / sheetArea) : 0;

  return { placements, sheetWMm, usedHMm, utilization };
}
