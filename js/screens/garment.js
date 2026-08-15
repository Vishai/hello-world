/**
 * Add Garment screen (MVP screen 2).
 * Photo/upload → automatic background removal → editable result (§18:
 * tolerance slider + garment type + measured width all user-correctable).
 */

import { el, fileToDataURL, loadImage } from '../util.js';
import { state, newGarment, saveProject, GARMENT_TYPES, pxPerMm } from '../state.js';
import { ai } from '../services/ai.js';
import { navigate } from '../app.js';

export async function renderGarment(container) {
  const p = state.project;
  const pad = el('div', { class: 'pad' });
  container.append(pad);

  if (!p.garment) {
    pad.append(
      el('div', { class: 'empty-state' },
        el('div', { class: 'big' }, '👕'),
        el('div', {}, 'Photograph the garment you want to upcycle.'),
        el('div', { class: 'small-note' },
          'Lay it flat on a plain background in even light — the background is removed automatically and your design is placed on the real photo.'),
      ),
      photoPicker(async (dataUrl) => {
        await processGarment(pad, dataUrl);
      }),
    );
    return;
  }

  renderGarmentCard(pad);
}

function photoPicker(onPhoto, label = 'Take / upload photo') {
  const input = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none',
  });
  input.addEventListener('change', async () => {
    if (input.files?.[0]) onPhoto(await fileToDataURL(input.files[0]));
  });
  const btn = el('button', { class: 'btn block', onclick: () => input.click() }, `📷 ${label}`);
  return el('div', {}, input, btn);
}

async function processGarment(pad, dataUrl, tolerance = 42, noMask = false) {
  pad.replaceChildren(el('div', { class: 'empty-state' },
    el('div', { class: 'big' }, '✂️'),
    el('div', {}, noMask ? 'Loading photo…' : 'Removing background…')));
  const img = await loadImage(dataUrl);
  const p = state.project;
  const prevType = p.garment?.type ?? 't-shirt';
  const prevWidth = p.garment?.widthCm;

  let maskImage, bbox, coverage;
  if (noMask) {
    // Escape hatch for tricky photos (busy backdrop, weathered fabric close
    // to the background color): design directly on the untouched photo.
    maskImage = dataUrl;
    bbox = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    coverage = 1;
  } else {
    const seg = await ai.segmentGarment(img, { tolerance });
    maskImage = seg.dataUrl;
    bbox = seg.bbox;
    coverage = seg.coverage;
  }

  p.garment = newGarment({ image: dataUrl, maskImage, bbox, type: prevType, widthCm: prevWidth });
  p.garment._tolerance = tolerance;
  p.garment.noMask = noMask;
  p.garment._coverage = coverage;
  saveProject();
  pad.replaceChildren();
  renderGarmentCard(pad);
}

function renderGarmentCard(pad) {
  const p = state.project;
  const g = p.garment;

  const frame = el('div', { class: 'photo-frame' }, el('img', { src: g.maskImage, alt: 'Garment with background removed' }));

  const tolSlider = el('input', {
    type: 'range', min: 5, max: 95, value: g._tolerance ?? 42,
  });
  tolSlider.addEventListener('change', () => processGarment(pad, g.image, Number(tolSlider.value)));

  // Cutout looks suspiciously empty or suspiciously full → likely a photo
  // the heuristic can't handle; surface the escape hatch prominently.
  const lowConfidence = !g.noMask && (g._coverage != null) && (g._coverage < 0.12 || g._coverage > 0.92);

  const asIsBtn = el('button', {
    class: 'btn small secondary',
    onclick: () => processGarment(pad, g.image, g._tolerance ?? 42, true),
  }, 'Use photo as-is');
  const reRunBtn = el('button', {
    class: 'btn small secondary',
    onclick: () => processGarment(pad, g.image, g._tolerance ?? 42, false),
  }, 'Remove background');

  const typeSelect = el('select', {},
    ...Object.entries(GARMENT_TYPES).map(([k, v]) =>
      el('option', { value: k, selected: g.type === k ? '' : null }, v.label)));
  typeSelect.addEventListener('change', () => {
    g.type = typeSelect.value;
    g.widthCm = GARMENT_TYPES[g.type].widthCm;
    widthInput.value = g.widthCm;
    saveProject();
  });

  const widthInput = el('input', { type: 'number', min: 10, max: 200, step: 0.5, value: g.widthCm });
  widthInput.addEventListener('change', () => {
    const v = parseFloat(widthInput.value);
    if (v > 0) { g.widthCm = v; saveProject(); }
  });

  pad.append(
    frame,
    el('div', { class: 'card' },
      el('h3', {}, 'Background removal'),
      g.noMask
        ? el('div', { class: 'muted' }, 'Using the untouched photo — nothing was removed.')
        : el('div', { class: 'muted' }, 'If too much or too little was removed, adjust and it re-runs. Faded or weathered fabric is protected: only background touching the photo edges is removed.'),
      lowConfidence
        ? el('div', { class: 'small-note', style: 'color:var(--accent)' },
            'This photo looks tricky for automatic removal (busy backdrop or fabric very close to the background color). You can design on the original photo instead — everything else works the same.')
        : null,
      g.noMask ? null : el('label', { class: 'field' }, 'Removal strength', tolSlider),
      el('div', { class: 'btn-row', style: 'margin-bottom:0' }, g.noMask ? reRunBtn : asIsBtn),
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Real-world scale'),
      el('div', { class: 'muted' },
        g.noMask
          ? 'Since the full photo is the workspace, enter the real-world width the photo covers edge-to-edge (lay a tape measure in frame next time — it makes this exact).'
          : 'Piece dimensions are calculated from the garment’s real width. Measure across the chest (or widest point in the photo) for accurate cutting patterns.'),
      el('label', { class: 'field' }, 'Garment type', typeSelect),
      el('label', { class: 'field' }, g.noMask ? 'Width covered by the photo (cm)' : 'Measured width (cm)', widthInput),
      el('div', { class: 'small-note' },
        `Current calibration: ${pxPerMm(p).toFixed(2)} px per mm on this photo.`),
    ),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn secondary', onclick: () => {
        p.garment = null;
        saveProject();
        const cont = pad.parentNode;
        cont.replaceChildren();
        renderGarment(cont);
      } }, 'Retake photo'),
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${p.id}/textile`) }, 'Next: textiles →'),
    ),
  );
}
