/**
 * ai.js — the AI adapter seam.
 *
 * Product rule (§18): AI assists, the user stays in control, and every AI
 * output is editable structured data — never an opaque final answer.
 *
 * This module is the single place where "AI" is invoked. The MVP ships with
 * on-device heuristic providers (imaging.js, shapes.js) so the whole flow
 * works offline with zero keys. Swapping in hosted models (e.g. a
 * segmentation model for garments, a diffusion model for photoreal mockups,
 * Claude for artwork decomposition) means implementing this same interface
 * in a `remoteProvider` and flipping `provider` — no screen code changes.
 *
 * Contract (all methods return editable structured data, in mm/px):
 *   segmentGarment(img, opts)  → { dataUrl, bbox, coverage }
 *   segmentTextile(img, opts)  → { dataUrl, bbox, coverage }
 *   makeSwatch(img)            → dataUrl (tileable texture)
 *   traceArtwork(img, opts)    → { pathMm, bboxMm, areaMm2 } | null
 *   generateArtwork(prompt)    → { name, components: [...] }   (see shapes.js)
 *   renderMockup(designCtx)    → dataUrl  (visualization ONLY — §19: it must
 *                                never alter production geometry)
 */

import { removeBackground, extractSwatch, traceContour } from './imaging.js';
import { generateFromPrompt } from './shapes.js';

const localProvider = {
  name: 'on-device heuristics',

  segmentGarment: (img, { tolerance } = {}) => removeBackground(img, tolerance ?? 42),
  segmentTextile: (img, { tolerance } = {}) => removeBackground(img, tolerance ?? 42),
  makeSwatch: (img) => extractSwatch(img),
  traceArtwork: (img, opts) => traceContour(img, opts),
  generateArtwork: (prompt, seed) => generateFromPrompt(prompt, seed),

  // The local "mockup" is a composited render done by the preview screen
  // itself (texture fill + garment shading + stitch marks). A hosted
  // provider would return an image-model rendering here instead.
  renderMockup: null,
};

export const ai = localProvider;
