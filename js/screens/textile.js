/**
 * Add Textile screen (MVP screen 3).
 * Photo/upload a donor material → tileable swatch + estimated usable area.
 * Textiles are a user-level library (finite, unique materials — §2, §12).
 */

import { el, fileToDataURL, loadImage, fmtArea, showModal } from '../util.js';
import { state, newTextile, saveTextile } from '../state.js';
import { db } from '../db.js';
import { ai } from '../services/ai.js';
import { navigate } from '../app.js';

export async function renderTextile(container) {
  const pad = el('div', { class: 'pad' });
  container.append(pad);
  draw(pad);
}

function draw(pad) {
  pad.replaceChildren();

  const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  input.addEventListener('change', async () => {
    if (!input.files?.[0]) return;
    const dataUrl = await fileToDataURL(input.files[0]);
    await addTextile(pad, dataUrl);
  });

  pad.append(
    input,
    el('button', { class: 'btn block', onclick: () => input.click() }, '📷 Photograph donor textile'),
    el('div', { class: 'small-note' },
      'Old jeans, a plaid shirt, a floral dress, quilt scraps… The photo becomes the actual material your pieces are cut from — this exact fabric, not a generic color.'),
  );

  if (!state.textiles.length) {
    pad.append(el('div', { class: 'empty-state' },
      el('div', { class: 'big' }, '🧶'),
      el('div', {}, 'No donor textiles yet.')));
    return;
  }

  pad.append(el('div', { class: 'section-title' }, 'Your material library'));
  const grid = el('div', { class: 'swatch-grid' });
  for (const t of state.textiles) {
    const tile = el('button', { class: 'swatch' },
      el('img', { src: t.swatch, alt: t.name }),
      el('span', { class: 'cap' }, `${t.name} · ${fmtArea(t.estimatedAreaM2 * 1e6)}`));
    tile.addEventListener('click', () => editTextile(pad, t));
    grid.append(tile);
  }
  pad.append(grid);

  if (state.project) {
    pad.append(el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${state.project.id}/artwork`) },
        'Next: artwork →')));
  }
}

async function addTextile(pad, dataUrl) {
  pad.replaceChildren(el('div', { class: 'empty-state' },
    el('div', { class: 'big' }, '🪡'), el('div', {}, 'Extracting material…')));
  const img = await loadImage(dataUrl);
  const swatch = ai.makeSwatch(img);
  const textile = newTextile({ image: dataUrl, swatch });
  await saveTextile(textile);
  draw(pad);
  editTextile(pad, textile);
}

function editTextile(pad, t) {
  {
    const name = el('input', { type: 'text', value: t.name });
    const area = el('input', { type: 'number', min: 0.05, step: 0.05, value: t.estimatedAreaM2 });
    const cost = el('input', { type: 'number', min: 0, step: 0.5, value: t.acquisitionCost ?? '' , placeholder: 'optional'});
    const content = el('div', {},
      el('div', { class: 'photo-frame' }, el('img', { src: t.swatch, alt: '' })),
      el('label', { class: 'field' }, 'Name', name),
      el('label', { class: 'field' }, 'Estimated usable material (m²)', area),
      el('div', { class: 'small-note' },
        'Reclaimed materials are finite — this feeds the cutting-layout utilization estimate. A pair of adult jeans yields roughly 0.5 m²; a maxi dress 1.5–2 m².'),
      el('label', { class: 'field' }, 'Acquisition cost ($)', cost),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn', onclick: async () => {
          t.name = name.value.trim() || t.name;
          t.estimatedAreaM2 = parseFloat(area.value) || t.estimatedAreaM2;
          t.remainingAreaM2 = Math.min(t.remainingAreaM2, t.estimatedAreaM2) || t.estimatedAreaM2;
          t.acquisitionCost = cost.value === '' ? null : parseFloat(cost.value);
          await saveTextile(t);
          modal.close();
          draw(pad);
        } }, 'Save'),
        el('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(`Remove “${t.name}” from your library?`)) return;
          await db.delete('textiles', t.id);
          state.textiles = state.textiles.filter((x) => x.id !== t.id);
          modal.close();
          draw(pad);
        } }, 'Delete'),
      ),
    );
    const modal = showModal('Donor textile', content);
  }
}
