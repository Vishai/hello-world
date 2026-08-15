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
 *   1. Cluster border colors (handles gradients, shadowed corners, and
 *      two-tone backdrops — not just one uniform color).
 *   2. Flood-fill background inward FROM THE PHOTO EDGES only. Pixels are
 *      removed only if they match a background color AND connect to the
 *      border — so faded or weathered fabric inside the garment can never
 *      be eaten, no matter how close its color is to the backdrop.
 *   3. Keep the largest connected foreground region; drop speckle.
 *   4. Fabric stays fully opaque; only the mask boundary gets a ~2px
 *      feather (no washed-out translucent fabric).
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
  const n = w * h;

  // 1. Cluster border colors (greedy, up to 5 clusters).
  const clusters = [];
  const step = Math.max(1, Math.floor((w + h) / 500));
  const addSample = (x, y) => {
    const i = (y * w + x) * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    for (const c of clusters) {
      const d = Math.hypot(r - c.r / c.n, g - c.g / c.n, b - c.b / c.n);
      if (d < 44) { c.r += r; c.g += g; c.b += b; c.n++; return; }
    }
    if (clusters.length < 5) clusters.push({ r, g, b, n: 1 });
  };
  for (let x = 0; x < w; x += step) { addSample(x, 0); addSample(x, h - 1); }
  for (let y = 0; y < h; y += step) { addSample(0, y); addSample(w - 1, y); }
  // ignore tiny clusters (a sleeve poking off-frame shouldn't count as backdrop)
  const minClusterN = Math.max(3, ((2 * (w + h)) / step) * 0.06);
  const bgs = clusters.filter((c) => c.n >= minClusterN)
    .map((c) => [c.r / c.n, c.g / c.n, c.b / c.n]);
  if (!bgs.length) bgs.push([px[0], px[1], px[2]]);

  const thr = 30 + tolerance * 1.6; // tolerance 0..100 → distance 30..190
  const isBgColor = (j) => {
    const i = j * 4;
    for (const [r, g, b] of bgs) {
      if (Math.hypot(px[i] - r, px[i + 1] - g, px[i + 2] - b) <= thr) return true;
    }
    return false;
  };

  // 2. BFS background from the border. 0 = unknown/foreground, 1 = background.
  const state = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qHead = 0, qTail = 0;
  const seed = (j) => {
    if (!state[j] && isBgColor(j)) { state[j] = 1; queue[qTail++] = j; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qHead < qTail) {
    const j = queue[qHead++];
    const x = j % w, y = (j / w) | 0;
    if (x > 0) seed(j - 1);
    if (x < w - 1) seed(j + 1);
    if (y > 0) seed(j - w);
    if (y < h - 1) seed(j + w);
  }

  // 3. Largest connected foreground component; drop small islands/speckle.
  const labels = new Int32Array(n).fill(-1);
  let bestLabel = -1, bestCount = 0, nextLabel = 0;
  const stack = queue; // reuse the buffer
  for (let start = 0; start < n; start++) {
    if (state[start] === 1 || labels[start] !== -1) continue;
    let sp = 0, count = 0;
    stack[sp++] = start;
    labels[start] = nextLabel;
    while (sp > 0) {
      const idx = stack[--sp];
      count++;
      const x = idx % w, y = (idx / w) | 0;
      if (x > 0 && state[idx - 1] !== 1 && labels[idx - 1] === -1) { labels[idx - 1] = nextLabel; stack[sp++] = idx - 1; }
      if (x < w - 1 && state[idx + 1] !== 1 && labels[idx + 1] === -1) { labels[idx + 1] = nextLabel; stack[sp++] = idx + 1; }
      if (y > 0 && state[idx - w] !== 1 && labels[idx - w] === -1) { labels[idx - w] = nextLabel; stack[sp++] = idx - w; }
      if (y < h - 1 && state[idx + w] !== 1 && labels[idx + w] === -1) { labels[idx + w] = nextLabel; stack[sp++] = idx + w; }
    }
    if (count > bestCount) { bestCount = count; bestLabel = nextLabel; }
    nextLabel++;
  }

  // 4. Binary alpha + bbox, then feather only the boundary.
  const alpha = new Uint8Array(n);
  let minX = w, minY = h, maxX = 0, maxY = 0, kept = 0;
  for (let j = 0; j < n; j++) {
    if (labels[j] === bestLabel) {
      alpha[j] = 255;
      kept++;
      const x = j % w, y = (j / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (kept === 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }

  const feathered = boxBlurMask(alpha, w, h, 2);
  for (let j = 0; j < n; j++) {
    // soften only the foreground side of the edge: interior stays opaque,
    // background stays fully transparent (no halo fringe)
    px[j * 4 + 3] = alpha[j] === 255 ? Math.max(180, feathered[j]) : 0;
  }

  ctx.putImageData(data, 0, 0);
  return {
    dataUrl: ctx.canvas.toDataURL('image/png'),
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    coverage: kept / n,
  };
}

/** Separable box blur on a single-channel mask (radius in px). */
function boxBlurMask(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = Math.min(w - 1, x + radius + 1), sub = Math.max(0, x - radius);
      sum += src[row + add] - src[row + sub];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / win);
      const add = Math.min(h - 1, y + radius + 1), sub = Math.max(0, y - radius);
      sum += tmp[add * w + x] - tmp[sub * w + x];
    }
  }
  return out;
}

/**
 * Build a display swatch from the central region of a textile photo:
 * a plain center crop, faithful to the fabric as photographed.
 *
 * Deliberately NOT mirror-tiled: mirroring hides tiling seams on fine
 * textures but turns any large motif (a knit logo, a big floral print)
 * into a kaleidoscope. Piece fills use the original photo at physical
 * scale instead (see designer/preview), so a cut piece shows one
 * contiguous region of fabric — like the real scissors would.
 */
export function extractSwatch(img, tile = 512) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const crop = Math.floor(Math.min(w, h) * 0.7);
  const sx = Math.floor((w - crop) / 2), sy = Math.floor((h - crop) / 2);
  const ctx = ctx2d(tile, tile);
  ctx.drawImage(img, sx, sy, crop, crop, 0, 0, tile, tile);
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
