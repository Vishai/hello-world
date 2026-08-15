/**
 * shapes.js — parametric artwork generator ("AI generate" local provider).
 *
 * Generates artwork already decomposed into individually cuttable fabric
 * components (§4 of the product brief): a wildflower is returned as separate
 * petals, a center, leaves and a stem — each with its own path — rather than
 * as one flat picture. Every component's geometry is expressed in mm.
 *
 * A generated artwork is:
 *   { name, components: [{ name, role, pathMm, bboxMm, offsetMm: {x, y}, quantity }] }
 *
 * `offsetMm` places the component inside the artwork's own coordinate space so
 * the designer can drop the whole motif and keep its internal arrangement.
 * `role` is a hint for material assignment (petal / center / leaf / stem / body).
 */

import {
  ellipsePath, petalPath, leafPath, heartPath, starPath,
  roundedRectPath, pathBBox, r2,
} from './geometry.js';

/** Deterministic PRNG so "regenerate" can vary while staying reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function comp(name, role, pathMm, offsetMm = { x: 0, y: 0 }, quantity = 1) {
  return { name, role, pathMm, bboxMm: pathBBox(pathMm), offsetMm, quantity };
}

/**
 * A wildflower with `petals` petals arranged radially, a round center,
 * plus optional leaves and stem. sizeMm is the overall flower diameter.
 */
export function wildflower({ petals = 5, sizeMm = 90, leaves = 2, stem = false, seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  const petalLen = sizeMm / 2;
  const petalW = petalLen * (0.52 + rnd() * 0.16);
  const centerR = sizeMm * (0.13 + rnd() * 0.04);
  const components = [];

  // One petal shape, cut `petals` times — appliqué petals are placed
  // radially during assembly. Store each placement so the designer shows
  // the full flower, but production groups identical petals.
  for (let i = 0; i < petals; i++) {
    const angle = (360 / petals) * i + (rnd() - 0.5) * 6;
    components.push({
      ...comp(`Petal ${i + 1}`, 'petal', petalPath(petalLen, petalW)),
      rotation: r2(angle),
      offsetMm: { x: 0, y: 0 }, // petal base sits at flower center; rotation fans them out
    });
  }
  components.push(comp('Center', 'center', ellipsePath(0, 0, centerR, centerR)));

  for (let i = 0; i < leaves; i++) {
    const len = sizeMm * (0.42 + rnd() * 0.12);
    const side = i % 2 === 0 ? 1 : -1;
    components.push({
      ...comp(`Leaf ${i + 1}`, 'leaf', leafPath(len, len * 0.42)),
      rotation: r2(side * (35 + rnd() * 20) + 90),
      offsetMm: { x: side * sizeMm * 0.18, y: sizeMm * 0.52 + i * 4 },
    });
  }

  if (stem) {
    const stemLen = sizeMm * 0.9;
    components.push(
      comp('Stem', 'stem', roundedRectPath(sizeMm * 0.055, stemLen, sizeMm * 0.027),
        { x: 0, y: sizeMm / 2 + stemLen / 2 - centerR })
    );
  }

  return { name: `Wildflower (${petals} petals)`, components };
}

export function heart({ sizeMm = 80 } = {}) {
  return { name: 'Heart', components: [comp('Heart', 'body', heartPath(sizeMm))] };
}

export function star({ points = 5, sizeMm = 80 } = {}) {
  return {
    name: `Star (${points} points)`,
    components: [comp('Star', 'body', starPath(points, sizeMm / 2, sizeMm / 4.6))],
  };
}

export function circle({ sizeMm = 70 } = {}) {
  return { name: 'Circle patch', components: [comp('Circle', 'body', ellipsePath(0, 0, sizeMm / 2, sizeMm / 2))] };
}

export function leafSprig({ sizeMm = 100, count = 3, seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  const components = [];
  for (let i = 0; i < count; i++) {
    const len = sizeMm * (0.35 + rnd() * 0.25);
    const side = i % 2 === 0 ? 1 : -1;
    components.push({
      ...comp(`Leaf ${i + 1}`, 'leaf', leafPath(len, len * 0.4)),
      rotation: r2(side * (20 + rnd() * 35)),
      offsetMm: { x: (i - (count - 1) / 2) * sizeMm * 0.3, y: (rnd() - 0.5) * sizeMm * 0.2 },
    });
  }
  return { name: `Leaf sprig (${count})`, components };
}

export function patchRect({ wMm = 90, hMm = 70, cornerMm = 10 } = {}) {
  return { name: 'Patch', components: [comp('Patch', 'body', roundedRectPath(wMm, hMm, cornerMm))] };
}

/**
 * Tiny prompt parser: turns a free-text request like
 * "three small five-petal wildflowers with a stem" into generator calls.
 * This is the editable-AI seam (§18): a hosted model can replace parseprompt
 * while the component contract stays identical.
 */
const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function generateFromPrompt(prompt, seed = Date.now() % 100000) {
  const p = (prompt || '').toLowerCase();
  const nums = [];
  for (const m of p.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/g)) {
    nums.push(WORD_NUMBERS[m[1]] ?? parseInt(m[1], 10));
  }
  const sizeMm = /\b(tiny|small)\b/.test(p) ? 55 : /\b(big|large|huge)\b/.test(p) ? 130 : 90;

  if (/flower|floral|daisy|bloom|petal/.test(p)) {
    const petals = nums.find((n) => n >= 3 && n <= 12) ?? 5;
    return wildflower({
      petals, sizeMm, seed,
      leaves: /leaf|leaves/.test(p) ? 2 : /\bno leaves\b/.test(p) ? 0 : 2,
      stem: /stem/.test(p),
    });
  }
  if (/heart|love/.test(p)) return heart({ sizeMm });
  if (/star/.test(p)) return star({ points: nums.find((n) => n >= 4 && n <= 9) ?? 5, sizeMm });
  if (/leaf|leaves|sprig|branch/.test(p)) return leafSprig({ sizeMm, count: nums.find((n) => n >= 2 && n <= 7) ?? 3, seed });
  if (/circle|dot|round/.test(p)) return circle({ sizeMm });
  if (/patch|rect|square|label/.test(p)) return patchRect({ wMm: sizeMm, hMm: sizeMm * 0.78 });
  // Default: a friendly manufacturable flower.
  return wildflower({ petals: 5, sizeMm, seed });
}

/** Built-in template library (§3 "Template Library"). */
export const TEMPLATES = [
  { id: 'wildflower5', name: 'Wildflower ×5', build: (seed) => wildflower({ petals: 5, seed }) },
  { id: 'wildflower8', name: 'Daisy ×8', build: (seed) => wildflower({ petals: 8, sizeMm: 80, leaves: 0, seed }) },
  { id: 'flower-stem', name: 'Flower + stem', build: (seed) => wildflower({ petals: 5, stem: true, seed }) },
  { id: 'heart', name: 'Heart', build: () => heart({}) },
  { id: 'star5', name: 'Star', build: () => star({}) },
  { id: 'sprig', name: 'Leaf sprig', build: (seed) => leafSprig({ seed }) },
  { id: 'circle', name: 'Circle patch', build: () => circle({}) },
  { id: 'patch', name: 'Rounded patch', build: () => patchRect({}) },
];
