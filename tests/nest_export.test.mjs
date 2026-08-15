import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nestPieces } from '../js/services/nest.js';
import { buildCuttingSheetSVG, buildPieceSVG } from '../js/services/svgexport.js';
import { ellipsePath } from '../js/services/geometry.js';

function overlaps(a, b) {
  return a.xMm < b.xMm + b.wMm && b.xMm < a.xMm + a.wMm &&
         a.yMm < b.yMm + b.hMm && b.yMm < a.yMm + a.hMm;
}

test('nestPieces places every piece with no overlaps inside the sheet', () => {
  const pieces = [];
  for (let i = 0; i < 22; i++) pieces.push({ id: `p${i}`, label: `P${i}`, wMm: 40 + (i % 5) * 10, hMm: 55 });
  const r = nestPieces(pieces, 450);
  assert.equal(r.placements.length, 22);
  for (const pl of r.placements) {
    assert.ok(pl.xMm >= 0 && pl.xMm + pl.wMm <= 450 + 0.01, `${pl.id} inside sheet width`);
  }
  for (let i = 0; i < r.placements.length; i++) {
    for (let j = i + 1; j < r.placements.length; j++) {
      assert.ok(!overlaps(r.placements[i], r.placements[j]),
        `${r.placements[i].id} overlaps ${r.placements[j].id}`);
    }
  }
  assert.ok(r.utilization > 0.3 && r.utilization <= 1, `sane utilization (got ${r.utilization})`);
});

test('nestPieces rotates tall pieces to lie flat', () => {
  const r = nestPieces([{ id: 'tall', label: 'T', wMm: 30, hMm: 120 }], 450);
  assert.equal(r.placements[0].rotated, true);
  assert.equal(r.placements[0].wMm, 120);
});

test('nestPieces handles empty input', () => {
  const r = nestPieces([], 450);
  assert.equal(r.placements.length, 0);
  assert.equal(r.usedHMm, 0);
});

test('cutting sheet SVG is valid, real-size, and labeled', () => {
  const path = ellipsePath(0, 0, 30, 20);
  const pieces = [
    { id: 'a', label: 'Petal 1', pathMm: path, scale: 1, mirror: false, seamAllowanceMm: 0 },
    { id: 'b', label: 'Petal 2', pathMm: path, scale: 1.5, mirror: true, seamAllowanceMm: 0 },
  ];
  const nested = nestPieces([
    { id: 'a', label: 'Petal 1', wMm: 60, hMm: 40 },
    { id: 'b', label: 'Petal 2', wMm: 90, hMm: 60 },
  ], 450);
  const svg = buildCuttingSheetSVG({
    pieces, placements: nested.placements,
    sheetWMm: nested.sheetWMm, usedHMm: nested.usedHMm, materialName: 'Vintage Denim A',
  });
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /width="450mm"/, 'physical mm width');
  assert.match(svg, /viewBox="0 0 450/, '1 svg unit = 1 mm');
  assert.match(svg, /Vintage Denim A/);
  assert.match(svg, /Petal 1/);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /id="cut"/);
  assert.match(svg, /id="labels"/);
});

test('seam allowance adds a second dashed outline per piece', () => {
  const path = ellipsePath(0, 0, 25, 25);
  const nested = nestPieces([{ id: 'a', label: 'C', wMm: 60, hMm: 60 }], 200);
  const svg = buildCuttingSheetSVG({
    pieces: [{ id: 'a', label: 'C', pathMm: path, scale: 1, mirror: false, seamAllowanceMm: 5 }],
    placements: nested.placements, sheetWMm: 200, usedHMm: nested.usedHMm,
  });
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /stroke-dasharray/);
});

test('single piece SVG has true physical size', () => {
  const svg = buildPieceSVG({ label: 'Leaf', pathMm: ellipsePath(0, 0, 40, 15), scale: 2 });
  assert.match(svg, /width="160mm"/);
  assert.match(svg, /height="60mm"/);
  assert.match(svg, /Leaf/);
});
