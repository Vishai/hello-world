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

async function processGarment(pad, dataUrl, tolerance = 42) {
  pad.replaceChildren(el('div', { class: 'empty-state' },
    el('div', { class: 'big' }, '✂️'),
    el('div', {}, 'Removing background…')));
  const img = await loadImage(dataUrl);
  const seg = await ai.segmentGarment(img, { tolerance });
  const p = state.project;
  const prevType = p.garment?.type ?? 't-shirt';
  const prevWidth = p.garment?.widthCm;
  p.garment = newGarment({
    image: dataUrl,
    maskImage: seg.dataUrl,
    bbox: seg.bbox,
    type: prevType,
    widthCm: prevWidth,
  });
  p.garment._tolerance = tolerance;
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
      el('div', { class: 'muted' }, 'If too much or too little was removed, adjust and it re-runs.'),
      el('label', { class: 'field' }, 'Removal strength', tolSlider),
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Real-world scale'),
      el('div', { class: 'muted' },
        'Piece dimensions are calculated from the garment’s real width. Measure across the chest (or widest point in the photo) for accurate cutting patterns.'),
      el('label', { class: 'field' }, 'Garment type', typeSelect),
      el('label', { class: 'field' }, 'Measured width (cm)', widthInput),
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
