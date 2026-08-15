/**
 * state.js — app state, data model and autosave.
 *
 * The stored project object IS the production source of truth (§19):
 * `pieces[].pathMm` + placement numbers determine what gets cut. Preview
 * imagery is cached separately and is never read back into geometry.
 */

import { db } from './db.js';
import { uid, debounce } from './util.js';

/** Default physical widths (cm) per garment type, used to calibrate px→mm.
 *  The user can always override with a measured value. */
export const GARMENT_TYPES = {
  't-shirt': { label: 'T-shirt', widthCm: 50 },
  sweatshirt: { label: 'Sweatshirt', widthCm: 56 },
  hoodie: { label: 'Hoodie', widthCm: 57 },
  sweater: { label: 'Sweater', widthCm: 54 },
  jacket: { label: 'Jacket', widthCm: 58 },
  jeans: { label: 'Jeans / pants', widthCm: 40 },
  skirt: { label: 'Skirt', widthCm: 45 },
  bag: { label: 'Bag', widthCm: 38 },
  hat: { label: 'Hat', widthCm: 27 },
  other: { label: 'Other', widthCm: 50 },
};

export function newProject(name) {
  return {
    id: uid('proj'),
    name: name || 'Untitled design',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    garment: null,      // see newGarment()
    artworks: [],       // generated/imported artwork definitions (reusable within project)
    pieces: [],         // placed DesignPieces — the production representation
    previewImage: null, // cached mockup render (visualization only)
  };
}

export function newGarment({ image, maskImage, bbox, type = 't-shirt', widthCm }) {
  return {
    id: uid('garm'),
    image,            // original photo (kept — designs render on the real item)
    maskImage,        // background-removed PNG
    bbox,             // garment bounds in image px
    type,
    widthCm: widthCm ?? GARMENT_TYPES[type].widthCm,
    acquisitionCost: null,
  };
}

export function newTextile({ image, swatch, name, areaM2 = 0.5, cost = null, imageAspect = 1 }) {
  return {
    id: uid('tex'),
    name: name || 'Reclaimed textile',
    image,           // original photo — also the piece fill, at physical scale
    swatch,          // display crop (library thumbnails)
    imageAspect,     // photo height / width, for undistorted pattern fills
    photoWidthCm: 40, // real-world width the photo covers; sets fill scale
    estimatedAreaM2: areaM2,
    remainingAreaM2: areaM2,
    acquisitionCost: cost,
    createdAt: Date.now(),
  };
}

/** Fill-pattern metrics for a textile: photo tile size in mm (with defaults
 *  for records created before physical scale existed). */
export function textileTileMm(t) {
  const wMm = (t?.photoWidthCm ?? 40) * 10;
  return { wMm, hMm: wMm * (t?.imageAspect ?? 1) };
}

/**
 * A placed, cuttable piece. Geometry (pathMm) is authored in millimeters;
 * placement maps it onto the garment photo:
 *   x, y      — position of the piece's local origin, in garment-image px
 *   rotation  — degrees
 *   scale     — unitless multiplier on the mm geometry
 *   mirror    — horizontal flip
 * Physical size = bbox(pathMm) × scale. Rendered size additionally uses the
 * project's px-per-mm calibration.
 */
export function newPiece({ name, role, pathMm, bboxMm, group, textileId = null, x, y, rotation = 0, scale = 1 }) {
  return {
    id: uid('piece'),
    name, role: role || 'body', group: group || null,
    pathMm, bboxMm,
    textileId,
    x, y, rotation, scale,
    mirror: false,
    layer: 0,
    quantity: 1,
    seamAllowanceMm: 0,
  };
}

/** px per mm on the garment photo: garment bbox width ↔ real garment width. */
export function pxPerMm(project) {
  const g = project?.garment;
  if (!g || !g.bbox?.w || !g.widthCm) return 1;
  return g.bbox.w / (g.widthCm * 10);
}

// ---------------------------------------------------------------------------

export const state = {
  project: null,   // currently open project
  textiles: [],    // user textile library
  selectedPieceId: null,
};

const saveIndicator = () => document.getElementById('save-indicator');

export const saveProject = debounce(async () => {
  if (!state.project) return;
  state.project.updatedAt = Date.now();
  await db.put('projects', state.project);
  const ind = saveIndicator();
  if (ind) {
    ind.textContent = 'Saved';
    setTimeout(() => { if (ind.textContent === 'Saved') ind.textContent = ''; }, 1500);
  }
}, 500);

export async function saveTextile(textile) {
  await db.put('textiles', textile);
  const i = state.textiles.findIndex((t) => t.id === textile.id);
  if (i >= 0) state.textiles[i] = textile; else state.textiles.push(textile);
}

export async function loadTextiles() {
  state.textiles = await db.getAll('textiles');
  state.textiles.sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadProject(id) {
  state.project = await db.get('projects', id);
  state.selectedPieceId = null;
  return state.project;
}

export async function listProjects() {
  const all = await db.getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id) {
  await db.delete('projects', id);
  if (state.project?.id === id) state.project = null;
}

export function getTextile(id) {
  return state.textiles.find((t) => t.id === id) || null;
}
