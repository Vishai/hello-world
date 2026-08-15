/**
 * geometry.js — pure vector-path helpers.
 *
 * All piece geometry in ReStitch is authored in MILLIMETERS. Paths built here
 * are the production representation (§19 of the product brief): what gets cut
 * is derived from these numbers, never from a rendered preview.
 */

/** Round to 2 decimal places for compact, stable path strings. */
export function r2(n) {
  return Math.round(n * 100) / 100;
}

/** Build an SVG path string for an ellipse centred on (cx, cy). */
export function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5523; // cubic approximation constant
  const x0 = cx - rx, x1 = cx + rx, y0 = cy - ry, y1 = cy + ry;
  const dx = rx * k, dy = ry * k;
  return [
    `M ${r2(x0)} ${r2(cy)}`,
    `C ${r2(x0)} ${r2(cy - dy)} ${r2(cx - dx)} ${r2(y0)} ${r2(cx)} ${r2(y0)}`,
    `C ${r2(cx + dx)} ${r2(y0)} ${r2(x1)} ${r2(cy - dy)} ${r2(x1)} ${r2(cy)}`,
    `C ${r2(x1)} ${r2(cy + dy)} ${r2(cx + dx)} ${r2(y1)} ${r2(cx)} ${r2(y1)}`,
    `C ${r2(cx - dx)} ${r2(y1)} ${r2(x0)} ${r2(cy + dy)} ${r2(x0)} ${r2(cy)}`,
    'Z',
  ].join(' ');
}

/**
 * Teardrop/petal shape pointing up: base at (0,0), tip at (0,-len).
 * `width` is the widest point. Returns a closed cubic path.
 */
export function petalPath(len, width) {
  const w = width / 2;
  const bulge = len * 0.42; // where the petal is widest, from the base
  return [
    'M 0 0',
    `C ${r2(-w)} ${r2(-bulge * 0.4)} ${r2(-w)} ${r2(-len + bulge)} 0 ${r2(-len)}`,
    `C ${r2(w)} ${r2(-len + bulge)} ${r2(w)} ${r2(-bulge * 0.4)} 0 0`,
    'Z',
  ].join(' ');
}

/** Leaf shape: pointed at both ends, along +x axis from (0,0) to (len,0). */
export function leafPath(len, width) {
  const w = width / 2;
  return [
    'M 0 0',
    `C ${r2(len * 0.3)} ${r2(-w)} ${r2(len * 0.7)} ${r2(-w)} ${r2(len)} 0`,
    `C ${r2(len * 0.7)} ${r2(w)} ${r2(len * 0.3)} ${r2(w)} 0 0`,
    'Z',
  ].join(' ');
}

/** Classic heart centred on origin, fitting in size × size. */
export function heartPath(size) {
  const s = size / 2;
  return [
    `M 0 ${r2(s)}`,
    `C ${r2(-s * 1.1)} ${r2(s * 0.05)} ${r2(-s * 0.95)} ${r2(-s * 0.85)} 0 ${r2(-s * 0.35)}`,
    `C ${r2(s * 0.95)} ${r2(-s * 0.85)} ${r2(s * 1.1)} ${r2(s * 0.05)} 0 ${r2(s)}`,
    'Z',
  ].join(' ');
}

/** N-pointed star centred on origin. */
export function starPath(points, outerR, innerR) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push([r2(Math.cos(a) * r), r2(Math.sin(a) * r)]);
  }
  return polygonPath(pts);
}

/** Closed polygon path from [x, y] pairs. */
export function polygonPath(pts) {
  if (!pts.length) return '';
  const [first, ...rest] = pts;
  return `M ${first[0]} ${first[1]} ` + rest.map((p) => `L ${p[0]} ${p[1]}`).join(' ') + ' Z';
}

/**
 * Smooth closed path through polygon points using Catmull-Rom → cubic Bézier.
 * Used to turn traced pixel contours into organic, sewable outlines.
 */
export function smoothClosedPath(pts, tension = 1) {
  const n = pts.length;
  if (n < 3) return polygonPath(pts);
  const parts = [`M ${r2(pts[0][0])} ${r2(pts[0][1])}`];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    parts.push(`C ${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2[0])} ${r2(p2[1])}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/** Rounded rectangle centred on origin. */
export function roundedRectPath(w, h, r) {
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw, hh);
  return [
    `M ${r2(-hw + r)} ${r2(-hh)}`,
    `L ${r2(hw - r)} ${r2(-hh)} Q ${r2(hw)} ${r2(-hh)} ${r2(hw)} ${r2(-hh + r)}`,
    `L ${r2(hw)} ${r2(hh - r)} Q ${r2(hw)} ${r2(hh)} ${r2(hw - r)} ${r2(hh)}`,
    `L ${r2(-hw + r)} ${r2(hh)} Q ${r2(-hw)} ${r2(hh)} ${r2(-hw)} ${r2(hh - r)}`,
    `L ${r2(-hw)} ${r2(-hh + r)} Q ${r2(-hw)} ${r2(-hh)} ${r2(-hw + r)} ${r2(-hh)}`,
    'Z',
  ].join(' ');
}

/**
 * Ramer–Douglas–Peucker polyline simplification.
 * Reduces traced contours to a manufacturable number of points.
 */
export function simplifyPolyline(pts, epsilon) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegDistance(pts[i], pts[a], pts[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function pointSegDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Signed area of a polygon (shoelace). Positive = counter-clockwise. */
export function polygonArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * Approximate the bounding box of an SVG path string by sampling its
 * commands. Handles M/L/C/Q/Z (absolute) — the subset this app generates.
 * Curve control points are included, giving a slightly conservative box,
 * which is the safe direction for cutting layouts.
 */
export function pathBBox(d) {
  const nums = [];
  const re = /[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi;
  let m;
  const coords = [];
  while ((m = re.exec(d))) {
    const tok = m[0];
    if (/[MLCQZ]/i.test(tok)) continue;
    nums.push(parseFloat(tok));
  }
  for (let i = 0; i + 1 < nums.length; i += 2) coords.push([nums[i], nums[i + 1]]);
  if (!coords.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: r2(minX), y: r2(minY), w: r2(maxX - minX), h: r2(maxY - minY) };
}

/** Union of bounding boxes. */
export function unionBBox(boxes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
