/**
 * Add Design / Artwork screen (MVP screen 4).
 *
 * Four ways in (§3): AI-generate from a text prompt, template library,
 * upload SVG, upload/photograph PNG-JPG artwork (traced to a vector).
 * Every artwork arrives as manufacturable components (§4) that the user
 * can then place, retexture and edit in the Designer.
 */

import { el, svgEl, uid, fileToDataURL, loadImage, showModal, appAlert } from '../util.js';
import { state, saveProject, newPiece, pxPerMm } from '../state.js';
import { ai } from '../services/ai.js';
import { TEMPLATES } from '../services/shapes.js';
import { simplifyPolyline, smoothClosedPath, pathBBox } from '../services/geometry.js';
import { navigate } from '../app.js';

export async function renderArtwork(container) {
  const p = state.project;
  const pad = el('div', { class: 'pad' });
  container.append(pad);

  if (!p.garment) {
    pad.append(el('div', { class: 'empty-state' },
      el('div', { class: 'big' }, '👕'),
      el('div', {}, 'Add the base garment first — artwork is sized against it.'),
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${p.id}/garment`) }, 'Add garment')));
    return;
  }

  // --- AI generate -----------------------------------------------------
  const promptInput = el('input', {
    type: 'text',
    placeholder: 'e.g. three overlapping wildflowers with a stem',
  });
  const genBtn = el('button', { class: 'btn' }, '✨ Generate');
  genBtn.addEventListener('click', () => {
    const artwork = ai.generateArtwork(promptInput.value, Math.floor(Math.random() * 1e5));
    confirmArtwork(artwork, pad);
  });

  pad.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Generate with AI'),
      el('div', { class: 'muted' }, 'Describes artwork designed for fabric appliqué — it arrives already split into cuttable pieces you can edit.'),
      el('label', { class: 'field' }, 'What do you want to make?', promptInput),
      el('div', { class: 'btn-row' }, genBtn),
    ),
  );

  // --- Upload / photograph ---------------------------------------------
  const fileInput = el('input', { type: 'file', accept: 'image/*,.svg', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const artwork = await importFile(file);
      if (!artwork) {
        appAlert('Couldn’t find a traceable shape in that image. Try higher contrast (dark artwork on light background) or a PNG with transparency.');
        return;
      }
      confirmArtwork(artwork, pad);
    } catch (err) {
      console.error(err);
      appAlert('Could not read that file.');
    } finally {
      fileInput.value = '';
    }
  });
  pad.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Upload or photograph artwork'),
      el('div', { class: 'muted' },
        'SVG, PNG or JPG — or photograph a drawing. Raster images are traced into a simplified, sewable outline.'),
      fileInput,
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn secondary', onclick: () => fileInput.click() }, '📁 Choose file / photo')),
    ),
  );

  // --- Template library -------------------------------------------------
  pad.append(el('div', { class: 'section-title' }, 'Template library'));
  const grid = el('div', { class: 'art-grid' });
  for (const t of TEMPLATES) {
    const artwork = t.build(7);
    const tile = el('button', { class: 'art-tile' });
    tile.append(artworkThumb(artwork), el('div', { class: 'cap' }, t.name));
    tile.addEventListener('click', () => confirmArtwork(t.build(Math.floor(Math.random() * 1e5)), pad));
    grid.append(tile);
  }
  pad.append(grid);

  if (p.pieces.length) {
    pad.append(el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${p.id}/designer`) }, 'Open designer →')));
  }
}

/** Mini SVG rendering of an artwork's components. */
function artworkThumb(artwork, size = 96) {
  const svg = svgEl('svg', { viewBox: computeViewBox(artwork), width: '100%', height: '72' });
  for (const c of artwork.components) {
    const g = svgEl('g', {
      transform: `translate(${c.offsetMm?.x ?? 0} ${c.offsetMm?.y ?? 0}) rotate(${c.rotation ?? 0})`,
    });
    g.append(svgEl('path', { d: c.pathMm, fill: roleColor(c.role), stroke: '#14110f', 'stroke-width': 1 }));
    svg.append(g);
  }
  return svg;
}

function roleColor(role) {
  return { petal: '#7d9bc0', center: '#e3c25a', leaf: '#7fae7a', stem: '#7fae7a', body: '#c0847d' }[role] || '#a89e93';
}

function computeViewBox(artwork) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of artwork.components) {
    // conservative: bbox center offset ± half diagonal covers any rotation
    const ox = c.offsetMm?.x ?? 0, oy = c.offsetMm?.y ?? 0;
    const reach = Math.hypot(
      Math.max(Math.abs(c.bboxMm.x), Math.abs(c.bboxMm.x + c.bboxMm.w)),
      Math.max(Math.abs(c.bboxMm.y), Math.abs(c.bboxMm.y + c.bboxMm.h)));
    minX = Math.min(minX, ox - reach); maxX = Math.max(maxX, ox + reach);
    minY = Math.min(minY, oy - reach); maxY = Math.max(maxY, oy + reach);
  }
  const pd = 4;
  return `${minX - pd} ${minY - pd} ${maxX - minX + pd * 2} ${maxY - minY + pd * 2}`;
}

/** Import an uploaded file into artwork components. */
async function importFile(file) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const text = await file.text();
    const fromPaths = importSvgPaths(text);
    if (fromPaths) return fromPaths;
    // Fallback: rasterize the SVG and trace its silhouette.
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
    const img = await loadImage(url);
    return traceToArtwork(img, file.name);
  }
  const dataUrl = await fileToDataURL(file, 1000);
  const img = await loadImage(dataUrl);
  return traceToArtwork(img, file.name);
}

function traceToArtwork(img, name) {
  const traced = ai.traceArtwork(img, { targetWMm: 100 });
  if (!traced) return null;
  return {
    name: name.replace(/\.[^.]+$/, '') || 'Traced artwork',
    components: [{
      name: 'Traced shape', role: 'body',
      pathMm: traced.pathMm, bboxMm: traced.bboxMm,
      offsetMm: { x: 0, y: 0 }, quantity: 1,
    }],
  };
}

/**
 * Native vector import for simple flat SVGs: top-level paths with no
 * transforms. Anything more complex falls back to raster tracing.
 * Uses a temporarily-attached hidden <svg> so getBBox() works.
 */
function importSvgPaths(text) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch { return null; }
  if (doc.querySelector('parsererror')) return null;
  if (doc.querySelector('[transform]')) return null; // keep MVP import predictable
  const paths = [...doc.querySelectorAll('path')].slice(0, 16);
  if (!paths.length) return null;

  const probe = svgEl('svg', { style: 'position:absolute;width:0;height:0;overflow:hidden' });
  document.body.append(probe);
  try {
    // Measure, then resample each path into our canonical geometry format
    // (absolute mm coordinates, closed smooth path) so downstream code has a
    // single path representation for rendering AND cutting.
    const measured = paths.map((p) => {
      const clone = svgEl('path', { d: p.getAttribute('d') || '' });
      probe.append(clone);
      const bb = clone.getBBox();
      return { node: clone, bb };
    }).filter(({ bb }) => bb.width > 0 && bb.height > 0);
    if (!measured.length) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { bb } of measured) {
      minX = Math.min(minX, bb.x); maxX = Math.max(maxX, bb.x + bb.width);
      minY = Math.min(minY, bb.y); maxY = Math.max(maxY, bb.y + bb.height);
    }
    const wUnits = maxX - minX;
    if (!(wUnits > 0)) return null;
    const mmPerUnit = 100 / wUnits; // normalize artwork to 100 mm wide
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    const components = [];
    measured.forEach(({ node, bb }, i) => {
      const len = node.getTotalLength();
      if (!(len > 0)) return;
      const n = Math.min(240, Math.max(48, Math.round(len / (wUnits / 60))));
      // Re-center each component on its own bbox center: piece transforms
      // (rotate/scale) act about the path's local origin, and offsetMm
      // preserves the arrangement inside the artwork.
      const compCx = bb.x + bb.width / 2, compCy = bb.y + bb.height / 2;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const pt = node.getPointAtLength((len * k) / n);
        pts.push([(pt.x - compCx) * mmPerUnit, (pt.y - compCy) * mmPerUnit]);
      }
      const simplified = simplifyPolyline(pts, 0.4);
      if (simplified.length < 3) return;
      const pathMm = smoothClosedPath(simplified, 0.8);
      components.push({
        name: `Path ${i + 1}`, role: 'body',
        pathMm,
        bboxMm: pathBBox(pathMm),
        offsetMm: {
          x: (bb.x + bb.width / 2 - cx) * mmPerUnit,
          y: (bb.y + bb.height / 2 - cy) * mmPerUnit,
        },
        quantity: 1,
      });
    });
    if (!components.length) return null;
    return { name: 'Imported SVG', components };
  } finally {
    probe.remove();
  }
}

/** Show the decomposition, let the user tweak size, then add to the design. */
function confirmArtwork(artwork, pad) {
  const p = state.project;
  const sizeInput = el('input', { type: 'range', min: 30, max: 220, value: 100 });
  const thumbHolder = el('div', { class: 'photo-frame', style: 'background:#fff; padding:8px' });
  thumbHolder.append(artworkThumb(artwork));

  const pieceList = el('div', { class: 'muted' }, describeComponents(artwork));

  const content = el('div', {},
    thumbHolder,
    el('div', { class: 'section-title' }, 'Cuttable pieces'),
    pieceList,
    el('div', { class: 'small-note' }, 'You can resize, retexture, duplicate or delete each piece in the designer.'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => { addToDesign(artwork); modal.close(); navigate(`#/p/${p.id}/designer`); } },
        'Add to design'),
      el('button', { class: 'btn secondary', onclick: () => modal.close() }, 'Cancel'),
    ),
  );
  const modal = showModal(artwork.name, content);
}

function describeComponents(artwork) {
  const byRole = {};
  for (const c of artwork.components) byRole[c.role] = (byRole[c.role] || 0) + 1;
  return Object.entries(byRole)
    .map(([role, n]) => `${n} × ${role}`)
    .join(' · ') + ` — ${artwork.components.length} pieces total`;
}

/** Instantiate artwork components as placed DesignPieces at garment center. */
function addToDesign(artwork) {
  const p = state.project;
  const ppm = pxPerMm(p);
  const g = p.garment;
  // Drop at the chest area: horizontally centred, upper third of the garment.
  const cx = g.bbox.x + g.bbox.w / 2;
  const cy = g.bbox.y + g.bbox.h * 0.38;
  const groupId = uid('art');
  const groupName = artwork.name;
  const maxLayer = p.pieces.reduce((m, x) => Math.max(m, x.layer), -1);

  artwork.components.forEach((c, i) => {
    const piece = newPiece({
      name: c.name,
      role: c.role,
      group: groupName,
      pathMm: c.pathMm,
      bboxMm: c.bboxMm,
      x: cx + (c.offsetMm?.x ?? 0) * ppm,
      y: cy + (c.offsetMm?.y ?? 0) * ppm,
      rotation: c.rotation ?? 0,
      scale: 1,
      textileId: state.textiles[0]?.id ?? null,
    });
    piece.groupId = groupId;
    piece.layer = maxLayer + 1 + i;
    p.pieces.push(piece);
  });
  saveProject();
}
