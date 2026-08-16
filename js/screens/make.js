/**
 * Make screen (MVP screen 7) — production mode.
 *
 * Converts the approved design into physical cutting patterns (§7–9):
 *   - a cut list: every piece with true dimensions, material, layer order
 *   - per-material nested cutting layouts with a utilization estimate
 *   - exportable real-size SVG cutting sheets (Cricut/Silhouette/laser/hand)
 *   - assembly notes (layer order = sewing order)
 */

import { el, svgEl, downloadText, fmtMm, fmtArea, showModal } from '../util.js';
import { state, saveProject, getTextile, textileTileMm } from '../state.js';
import { nestPieces } from '../services/nest.js';
import { buildCuttingSheetSVG, buildPieceSVG } from '../services/svgexport.js';
import { navigate } from '../app.js';

export async function renderMake(container) {
  const p = state.project;
  const pad = el('div', { class: 'pad' });
  container.append(pad);

  if (!p.pieces.length) {
    pad.append(el('div', { class: 'empty-state' },
      el('div', { class: 'big' }, '✂️'),
      el('div', {}, 'Nothing to cut yet — design something first.'),
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${p.id}/designer`) }, 'Open designer')));
    return;
  }

  // ---- seam allowance option ------------------------------------------
  const seamInput = el('input', { type: 'number', min: 0, max: 15, step: 0.5, value: p.seamAllowanceMm ?? 0 });
  seamInput.addEventListener('change', () => {
    p.seamAllowanceMm = parseFloat(seamInput.value) || 0;
    saveProject();
    redraw();
  });

  pad.append(el('div', { class: 'card' },
    el('h3', {}, 'Production settings'),
    el('label', { class: 'field' }, 'Seam / stitch allowance (mm, 0 = raw-edge appliqué)', seamInput),
    el('div', { class: 'small-note' },
      'Allowance is drawn as a second dashed outline around each piece (approximate uniform offset in this version).'),
  ));

  const body = el('div', {});
  pad.append(body);
  redraw();

  function redraw() {
    body.replaceChildren();

    // ---- cut list ------------------------------------------------------
    const sorted = [...p.pieces].sort((a, b) => a.layer - b.layer);
    const table = el('table', { class: 'piece-list' },
      el('thead', {}, el('tr', {},
        el('th', {}, '#'), el('th', {}, 'Piece'), el('th', {}, 'Size'),
        el('th', {}, 'Material'), el('th', {}, 'Sew order'))),
    );
    const tbody = el('tbody');
    sorted.forEach((piece, i) => {
      const t = getTextile(piece.textileId);
      tbody.append(el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {},
          `${piece.group ? piece.group + ' · ' : ''}${piece.name}${piece.mirror ? ' (mirrored)' : ''}`,
          piece.fabricOffsetMm ? el('span', { class: 'pill', style: 'margin-left:6px' }, '📍 motif') : null),
        el('td', {}, `${fmtMm(piece.bboxMm.w * piece.scale)} × ${fmtMm(piece.bboxMm.h * piece.scale)}`),
        el('td', {}, t ? t.name : el('span', { style: 'color:var(--danger)' }, 'unassigned!')),
        el('td', {}, String(i + 1)),
      ));
    });
    table.append(tbody);
    body.append(
      el('div', { class: 'section-title' }, `Cut list — ${sorted.length} pieces`),
      el('div', { style: 'overflow-x:auto' }, table),
      el('div', { class: 'small-note' }, 'Sew order = layer order from the designer: bottom pieces first.'),
    );

    // ---- per-material nesting + export --------------------------------
    const byTextile = new Map();
    for (const piece of sorted) {
      const key = piece.textileId || 'unassigned';
      if (!byTextile.has(key)) byTextile.set(key, []);
      byTextile.get(key).push(piece);
    }

    body.append(el('div', { class: 'section-title' }, 'Cutting sheets by material'));

    for (const [textileId, pieces] of byTextile) {
      const t = getTextile(textileId);
      const matName = t ? t.name : 'Unassigned material';

      const nestInput = pieces.map((piece) => ({
        id: piece.id,
        label: piece.name,
        wMm: piece.bboxMm.w * piece.scale + 2 * (p.seamAllowanceMm || 0),
        hMm: piece.bboxMm.h * piece.scale + 2 * (p.seamAllowanceMm || 0),
      }));
      const sheetW = 450; // default usable width of a laid-flat donor garment
      const nested = nestPieces(nestInput, sheetW);

      const exportPieces = pieces.map((piece) => ({
        id: piece.id,
        label: piece.name,
        pathMm: piece.pathMm,
        scale: piece.scale,
        mirror: piece.mirror,
        seamAllowanceMm: p.seamAllowanceMm || 0,
      }));
      const svgText = buildCuttingSheetSVG({
        pieces: exportPieces,
        placements: nested.placements,
        sheetWMm: nested.sheetWMm,
        usedHMm: nested.usedHMm + 8,
        materialName: matName,
      });

      const sheetAreaMm2 = nested.sheetWMm * nested.usedHMm;
      const remainingNote = t
        ? ` · you estimated ${fmtArea(t.estimatedAreaM2 * 1e6)} of this material`
        : '';

      const holder = el('div', { class: 'layout-preview', html: svgText });

      body.append(el('div', { class: 'card' },
        el('h3', {}, `${matName} `, el('span', { class: 'pill' }, `${pieces.length} pieces`)),
        el('div', { class: 'muted' },
          `Layout: ${fmtMm(nested.sheetWMm)} wide × ${fmtMm(nested.usedHMm)} — ` +
          `estimated material utilization ${(nested.utilization * 100).toFixed(0)}%` +
          ` (${fmtArea(sheetAreaMm2)} consumed${remainingNote})`),
        holder,
        el('div', { class: 'btn-row' },
          el('button', {
            class: 'btn small',
            onclick: () => downloadText(fileSafe(`${p.name}-${matName}-cutsheet.svg`), svgText),
          }, '⬇ Cutting sheet SVG'),
          el('button', {
            class: 'btn small secondary',
            onclick: () => exportIndividual(pieces, matName),
          }, '⬇ Individual pieces'),
        ),
        !t ? el('div', { class: 'small-note', style: 'color:var(--danger)' },
          'Assign a donor textile to these pieces in the designer.') : null,
      ));

      const placed = pieces.filter((piece) => piece.fabricOffsetMm);
      if (t && placed.length) body.append(motifGuideCard(t, placed));
    }

    body.append(el('div', { class: 'card' },
      el('h3', {}, 'Using the files'),
      el('div', { class: 'muted', html:
        'Exported SVGs are true-to-size (1&nbsp;unit&nbsp;=&nbsp;1&nbsp;mm). Import into ' +
        '<b>Cricut Design Space</b>, <b>Silhouette Studio</b>, <b>Brother CanvasWorkspace</b> ' +
        'or any laser/vinyl software — or print at 100% scale for hand cutting. ' +
        'Pin or fuse each piece to its donor fabric, cut on the solid line, ' +
        'then attach in the sew order shown above.' }),
    ));
  }

  function exportIndividual(pieces, matName) {
    const list = el('div', {});
    for (const piece of pieces) {
      list.append(el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn small secondary',
          onclick: () => downloadText(
            fileSafe(`${piece.group || 'piece'}-${piece.name}.svg`),
            buildPieceSVG({ label: piece.name, pathMm: piece.pathMm, scale: piece.scale, mirror: piece.mirror })),
        }, `⬇ ${piece.name} (${fmtMm(piece.bboxMm.w * piece.scale)} × ${fmtMm(piece.bboxMm.h * piece.scale)})`)));
    }
    showModal(`${matName} — individual pieces`, list);
  }
}

function fileSafe(name) {
  return name.replace(/[^\w.-]+/g, '_');
}

/**
 * Motif placement guide: the fabric photo (at physical scale) with cut
 * outlines drawn exactly where each motif-placed piece must be taken from.
 * The mapping inverts the designer's fill: a local point L (mm, piece
 * space) shows fabric at F = L·scale − offset, wrapped into the photo tile.
 * Mirrored pieces are drawn flipped — the physically correct cut on
 * unmirrored fabric.
 */
function motifGuideCard(t, placed) {
  const tile = textileTileMm(t);
  const items = placed.map((piece) => {
    const s = piece.scale, ef = piece.fabricOffsetMm;
    const bb = piece.bboxMm;
    const sx = piece.mirror ? -s : s;
    const rawX = (piece.mirror ? -(bb.x + bb.w) : bb.x) * s - ef.x;
    const rawY = bb.y * s - ef.y;
    const wrapDx = (((rawX % tile.wMm) + tile.wMm) % tile.wMm) - rawX;
    const wrapDy = (((rawY % tile.hMm) + tile.hMm) % tile.hMm) - rawY;
    return {
      piece,
      transform: `translate(${wrapDx - ef.x} ${wrapDy - ef.y}) scale(${sx} ${s})`,
      rect: { x: rawX + wrapDx, y: rawY + wrapDy, w: bb.w * s, h: bb.h * s },
    };
  });

  // canvas large enough for outlines that run past the photo's right/bottom
  // edge (the fill wraps around; the guide just shows the photo repeating)
  const maxX = Math.min(2 * tile.wMm, Math.max(tile.wMm, ...items.map((i) => i.rect.x + i.rect.w)));
  const maxY = Math.min(2 * tile.hMm, Math.max(tile.hMm, ...items.map((i) => i.rect.y + i.rect.h)));
  const svg = svgEl('svg', { viewBox: `0 0 ${maxX} ${maxY}` });
  for (const ix of [0, tile.wMm]) {
    for (const iy of [0, tile.hMm]) {
      if (ix < maxX && iy < maxY) {
        svg.append(svgEl('image', {
          href: t.image || t.swatch, x: ix, y: iy,
          width: tile.wMm, height: tile.hMm, preserveAspectRatio: 'none',
        }));
      }
    }
  }
  for (const it of items) {
    svg.append(svgEl('path', {
      d: it.piece.pathMm, transform: it.transform,
      fill: 'rgba(232,115,74,0.18)', stroke: '#e8734a', 'stroke-width': 1.4,
    }));
    const label = svgEl('text', {
      x: it.rect.x + it.rect.w / 2, y: it.rect.y + it.rect.h / 2,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: '#fff', 'font-size': 8, 'font-family': 'sans-serif',
      stroke: 'rgba(0,0,0,0.65)', 'stroke-width': 2.4, 'paint-order': 'stroke',
    });
    label.textContent = it.piece.name;
    svg.append(label);
  }

  const overlaps = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].rect, b = items[j].rect;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        overlaps.push(`${items[i].piece.name} & ${items[j].piece.name}`);
      }
    }
  }

  return el('div', { class: 'card' },
    el('h3', {}, '📍 Motif placement — ', t.name),
    el('div', { class: 'muted' },
      `${placed.length} piece${placed.length === 1 ? '' : 's'} pinned to a specific spot on the fabric. ` +
      'Cut these from the marked outlines (photo shown at real scale) so the motif lands exactly as designed; ' +
      'everything else can be cut from the nested layout above.'),
    el('div', { class: 'layout-preview', style: 'margin-top:10px' }, svg),
    overlaps.length
      ? el('div', { class: 'small-note', style: 'color:var(--danger)' },
          `⚠ Overlapping fabric regions: ${overlaps.join('; ')}. These pieces claim the same spot on the fabric — shift one of them in the designer (🎯 mode).`)
      : null,
  );
}
