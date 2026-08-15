/**
 * imaging.js — on-device computer-vision heuristics.
 *
 * These are the local implementations behind the AI adapter (see ai.js).
 * Each one follows the product's §18 rule: the algorithm proposes, the user
 * can adjust (threshold sliders, region crops), and the corrected result is
 * what gets stored.
 *
 *  - removeBackground: garment/textile isolation from a photo
 *  - extractSwatch:    build a tileable material texture from a photo region
 *  - traceContour:     photo/PNG of artwork → simplified closed vector path
 */

import { simplifyPolyline, smoothClosedPath, polygonArea, pathBBox } from './geometry.js';

function ctx2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c.getContext('2d', { willReadFrequently: true });
}

/**
 * Heuristic background removal.
 * Assumes the item was photographed on a roughly uniform background (floor,
 * table, wall — the normal way people shoot garments flat). Strategy:
 *   1. Estimate background color from the image border.
 *   2. Alpha-mask pixels near that color (with feathering).
 *   3. Keep the largest connected foreground component; drop speckle.
 * Returns { dataUrl (PNG with alpha), bbox: {x,y,w,h} in px, coverage }.
 * `tolerance` 0..100 is user-adjustable (§18: every AI decision editable).
 */
export async function removeBackground(img, tolerance = 42) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const ctx = ctx2d(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  // 1. Median border color.
  const rs = [], gs = [], bs = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const sample = (x, y) => {
    const i = (y * w + x) * 4;
    rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]);
  };
  for (let x = 0; x < w; x += step) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += step) { sample(0, y); sample(w - 1, y); }
  const med = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const bg = [med(rs), med(gs), med(bs)];

  // 2. Distance-based mask with a feather band.
  const thr = 30 + tolerance * 1.6; // tolerance 0..100 → distance 30..190
  const feather = 26;
  const mask = new Uint8Array(w * h); // 1 = foreground
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const d = Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
    mask[j] = d > thr ? 1 : 0;
    const a = d <= thr - feather ? 0 : d >= thr + feather ? 255
      : Math.round(((d - (thr - feather)) / (2 * feather)) * 255);
    px[i + 3] = a;
  }

  // 3. Largest connected component (4-neighbour flood fill, iterative).
  const labels = new Int32Array(w * h).fill(-1);
  let bestLabel = -1, bestCount = 0, nextLabel = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || labels[start] !== -1) continue;
    let sp = 0, count = 0;
    stack[sp++] = start;
    labels[start] = nextLabel;
    while (sp > 0) {
      const idx = stack[--sp];
      count++;
      const x = idx % w, y = (idx / w) | 0;
      if (x > 0 && mask[idx - 1] === 1 && labels[idx - 1] === -1) { labels[idx - 1] = nextLabel; stack[sp++] = idx - 1; }
      if (x < w - 1 && mask[idx + 1] === 1 && labels[idx + 1] === -1) { labels[idx + 1] = nextLabel; stack[sp++] = idx + 1; }
      if (y > 0 && mask[idx - w] === 1 && labels[idx - w] === -1) { labels[idx - w] = nextLabel; stack[sp++] = idx - w; }
      if (y < h - 1 && mask[idx + w] === 1 && labels[idx + w] === -1) { labels[idx + w] = nextLabel; stack[sp++] = idx + w; }
    }
    if (count > bestCount) { bestCount = count; bestLabel = nextLabel; }
    nextLabel++;
  }

  let minX = w, minY = h, maxX = 0, maxY = 0, kept = 0;
  for (let j = 0; j < mask.length; j++) {
    if (labels[j] !== bestLabel) {
      px[j * 4 + 3] = 0;
    } else {
      kept++;
      const x = j % w, y = (j / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (kept === 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }

  ctx.putImageData(data, 0, 0);
  return {
    dataUrl: ctx.canvas.toDataURL('image/png'),
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    coverage: kept / (w * h),
  };
}

/**
 * Build a tileable swatch from the central region of a textile photo.
 * Center crop avoids edges/background; mirror-tiling hides seams so the
 * texture can repeat across large appliqué pieces.
 */
export function extractSwatch(img, tile = 256) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const crop = Math.floor(Math.min(w, h) * 0.6);
  const sx = Math.floor((w - crop) / 2), sy = Math.floor((h - crop) / 2);

  const ctx = ctx2d(tile * 2, tile * 2);
  // 2×2 mirrored tiling → seamless repeat
  ctx.save(); ctx.drawImage(img, sx, sy, crop, crop, 0, 0, tile, tile); ctx.restore();
  ctx.save(); ctx.translate(tile * 2, 0); ctx.scale(-1, 1);
  ctx.drawImage(img, sx, sy, crop, crop, 0, 0, tile, tile); ctx.restore();
  ctx.save(); ctx.translate(0, tile * 2); ctx.scale(1, -1);
  ctx.drawImage(img, sx, sy, crop, crop, 0, 0, tile, tile); ctx.restore();
  ctx.save(); ctx.translate(tile * 2, tile * 2); ctx.scale(-1, -1);
  ctx.drawImage(img, sx, sy, crop, crop, 0, 0, tile, tile); ctx.restore();

  return ctx.canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Trace artwork (uploaded PNG/JPG or a photographed drawing) into ONE
 * simplified closed vector path, scaled to `targetWMm` wide.
 *
 * Uses transparency when present, else dark-on-light luminance; extracts the
 * outer boundary of the largest blob via boundary-following (Moore
 * neighbourhood), simplifies with RDP, then smooths into cubic curves.
 *
 * Returns { pathMm, bboxMm, points } or null if nothing traceable found.
 */
export function traceContour(img, { targetWMm = 100, threshold = 128 } = {}) {
  const maxDim = 320; // tracing resolution — plenty for sewable shapes
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const w = Math.max(2, Math.round(iw * scale));
  const h = Math.max(2, Math.round(ih * scale));
  const ctx = ctx2d(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  // Decide mask mode: alpha if the image has real transparency.
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 200) transparent++;
  const useAlpha = transparent > w * h * 0.05;

  const solid = new Uint8Array((w + 2) * (h + 2)); // 1px zero border simplifies tracing
  const W = w + 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let on;
      if (useAlpha) {
        on = px[i + 3] > 128;
      } else {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        on = lum < threshold; // dark ink on light paper
      }
      solid[(y + 1) * W + (x + 1)] = on ? 1 : 0;
    }
  }

  // Largest component's starting pixel (scan + flood-count).
  const seen = new Uint8Array(solid.length);
  let bestStart = -1, bestCount = 0;
  const stack = new Int32Array(solid.length);
  for (let s = 0; s < solid.length; s++) {
    if (!solid[s] || seen[s]) continue;
    let sp = 0, count = 0;
    stack[sp++] = s; seen[s] = 1;
    while (sp > 0) {
      const idx = stack[--sp];
      count++;
      for (const d of [-1, 1, -W, W]) {
        const n = idx + d;
        if (n >= 0 && n < solid.length && solid[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; }
      }
    }
    if (count > bestCount) { bestCount = count; bestStart = s; }
  }
  if (bestStart < 0 || bestCount < 16) return null;

  // Keep only the best component for tracing.
  const keep = new Uint8Array(solid.length);
  {
    let sp = 0;
    stack[sp++] = bestStart; keep[bestStart] = 1;
    while (sp > 0) {
      const idx = stack[--sp];
      for (const d of [-1, 1, -W, W]) {
        const n = idx + d;
        if (n >= 0 && n < solid.length && solid[n] && !keep[n]) { keep[n] = 1; stack[sp++] = n; }
      }
    }
  }

  // Moore-neighbour boundary following from the top-most left-most pixel.
  let startIdx = -1;
  for (let i = 0; i < keep.length; i++) if (keep[i]) { startIdx = i; break; }
  const nbr = [1, 1 + W, W, W - 1, -1, -1 - W, -W, -W + 1]; // E SE S SW W NW N NE
  const contour = [];
  let cur = startIdx, backtrack = 4; // came from the west
  const maxSteps = keep.length * 4;
  for (let step = 0; step < maxSteps; step++) {
    contour.push([cur % W, (cur / W) | 0]);
    let found = -1;
    for (let k = 0; k < 8; k++) {
      const dir = (backtrack + 1 + k) % 8;
      const n = cur + nbr[dir];
      if (n >= 0 && n < keep.length && keep[n]) { found = dir; break; }
    }
    if (found < 0) break; // isolated pixel
    cur += nbr[found];
    backtrack = (found + 4) % 8;
    if (cur === startIdx && contour.length > 2) break;
  }
  if (contour.length < 8) return null;

  // Simplify + smooth. Epsilon scales with size so detail stays proportional.
  const eps = Math.max(1.2, Math.max(w, h) / 160);
  let pts = simplifyPolyline(contour, eps);
  if (pts.length > 2 &&
      pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return null;

  // Scale to mm, centred on origin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pxW = Math.max(1, maxX - minX);
  const mmPerPx = targetWMm / pxW;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const mmPts = pts.map(([x, y]) => [(x - cx) * mmPerPx, (y - cy) * mmPerPx]);

  const pathMm = smoothClosedPath(mmPts, 0.9);
  return {
    pathMm,
    bboxMm: pathBBox(pathMm),
    areaMm2: Math.abs(polygonArea(mmPts)),
  };
}
