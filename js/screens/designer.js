/**
 * Designer screen (MVP screen 5) — the visual garment canvas.
 *
 * The garment photo is the workspace; pieces render as SVG paths filled with
 * their assigned donor-textile texture. Gestures:
 *   - drag a piece to move it (whole artwork group moves when group mode is on)
 *   - pinch with two fingers to resize + rotate
 *   - mouse: corner handle = resize, top handle = rotate
 * Toolbar: duplicate · mirror · layer up/down · assign textile · group · delete.
 *
 * All edits mutate the production model (mm geometry + placement numbers) and
 * autosave; rendering is derived from that model, never the reverse (§19).
 */

import { el, svgEl, uid, loadImage, showModal, fmtMm, appAlert } from '../util.js';
import { state, saveProject, pxPerMm, getTextile } from '../state.js';
import { navigate } from '../app.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export async function renderDesigner(container) {
  const p = state.project;

  if (!p.garment) {
    container.append(el('div', { class: 'pad' }, el('div', { class: 'empty-state' },
      el('div', { class: 'big' }, '👕'),
      el('div', {}, 'Add a garment photo first.'),
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${p.id}/garment`) }, 'Add garment'))));
    return;
  }

  const img = await loadImage(p.garment.maskImage);
  const W = img.naturalWidth, H = img.naturalHeight;
  const ppm = pxPerMm(p);

  const wrap = el('div', { id: 'designer-wrap' });
  const svg = svgEl('svg', { id: 'designer-svg', viewBox: `0 0 ${W} ${H}` });
  wrap.append(svg);

  const defs = svgEl('defs');
  svg.append(defs);
  svg.append(svgEl('image', { href: p.garment.maskImage, x: 0, y: 0, width: W, height: H }));

  const piecesLayer = svgEl('g', { id: 'pieces' });
  const overlay = svgEl('g', { id: 'overlay' }); // selection handles
  svg.append(piecesLayer, overlay);

  // --- textile fill patterns -------------------------------------------
  const patternIds = new Map();
  function ensurePattern(textileId) {
    if (!textileId) return null;
    if (patternIds.has(textileId)) return patternIds.get(textileId);
    const t = getTextile(textileId);
    if (!t) return null;
    const id = `pat_${textileId}`;
    const tileMm = 80; // pattern tile ≈ 8 cm of fabric (piece-local units are mm)
    const pat = svgEl('pattern', {
      id, patternUnits: 'userSpaceOnUse', width: tileMm, height: tileMm,
    });
    pat.append(svgEl('image', { href: t.swatch, x: 0, y: 0, width: tileMm, height: tileMm, preserveAspectRatio: 'xMidYMid slice' }));
    defs.append(pat);
    patternIds.set(textileId, id);
    return id;
  }

  // --- piece rendering --------------------------------------------------
  const nodeByPiece = new Map();

  function pieceTransform(piece) {
    const s = piece.scale * ppm;
    return `translate(${piece.x} ${piece.y}) rotate(${piece.rotation}) ` +
      `scale(${piece.mirror ? -s : s} ${s})`;
  }

  function renderPieces() {
    piecesLayer.replaceChildren();
    nodeByPiece.clear();
    const sorted = [...p.pieces].sort((a, b) => a.layer - b.layer);
    for (const piece of sorted) {
      const patId = ensurePattern(piece.textileId);
      const g = svgEl('g', { class: 'piece', 'data-id': piece.id, transform: pieceTransform(piece) });
      const path = svgEl('path', {
        class: 'outline',
        d: piece.pathMm,
        fill: patId ? `url(#${patId})` : '#b9917b',
        stroke: 'rgba(0,0,0,.55)',
        'stroke-width': 1.5,
      });
      g.append(path);
      piecesLayer.append(g);
      nodeByPiece.set(piece.id, g);
    }
    updateSelectionUI();
  }

  // --- selection --------------------------------------------------------
  let groupMode = true;

  function selected() {
    return p.pieces.find((x) => x.id === state.selectedPieceId) || null;
  }
  function selectionSet() {
    const s = selected();
    if (!s) return [];
    return groupMode && s.groupId ? p.pieces.filter((x) => x.groupId === s.groupId) : [s];
  }

  function updateSelectionUI() {
    overlay.replaceChildren();
    const s = selected();
    for (const [id, node] of nodeByPiece) {
      node.classList.toggle('selected', !!s && selectionSet().some((x) => x.id === id));
    }
    toolbarState();
    if (!s) { info.textContent = 'Tap a piece to edit it'; return; }
    const wMm = s.bboxMm.w * s.scale, hMm = s.bboxMm.h * s.scale;
    const t = getTextile(s.textileId);
    info.textContent = `${s.name} — ${fmtMm(wMm)} × ${fmtMm(hMm)}` + (t ? ` · ${t.name}` : ' · no material');

    // handles at the piece's transformed bbox corners (manual math keeps us
    // independent of getCTM/viewBox quirks)
    const rad = s.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const sy = s.scale * ppm;
    const sx = s.mirror ? -sy : sy;
    const pt = (x, y) => ({
      x: s.x + cos * (x * sx) - sin * (y * sy),
      y: s.y + sin * (x * sx) + cos * (y * sy),
    });
    const bb = s.bboxMm;
    const corners = [
      pt(bb.x, bb.y), pt(bb.x + bb.w, bb.y),
      pt(bb.x + bb.w, bb.y + bb.h), pt(bb.x, bb.y + bb.h),
    ];
    const poly = svgEl('polygon', {
      points: corners.map((c) => `${c.x},${c.y}`).join(' '),
      fill: 'none', stroke: '#e8734a', 'stroke-dasharray': '6 4',
      'stroke-width': 2, 'vector-effect': 'non-scaling-stroke',
    });
    overlay.append(poly);

    const hr = Math.max(10, W / 55); // handle radius in svg units
    const scaleHandle = svgEl('circle', {
      class: 'handle', cx: corners[2].x, cy: corners[2].y, r: hr,
    });
    const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const rotHandle = svgEl('circle', {
      class: 'handle rotate', cx: topMid.x, cy: topMid.y, r: hr,
    });
    scaleHandle.addEventListener('pointerdown', (e) => startHandleGesture(e, 'scale'));
    rotHandle.addEventListener('pointerdown', (e) => startHandleGesture(e, 'rotate'));
    overlay.append(scaleHandle, rotHandle);
  }

  // --- gesture machinery ------------------------------------------------
  const pointers = new Map(); // pointerId → {x, y}
  let gesture = null;

  function svgPoint(e) {
    const m = svg.getScreenCTM().inverse();
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
  }

  function centroidOf(pieces) {
    const n = pieces.length || 1;
    return {
      x: pieces.reduce((a, x) => a + x.x, 0) / n,
      y: pieces.reduce((a, x) => a + x.y, 0) / n,
    };
  }

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    const pt = svgPoint(e);
    pointers.set(e.pointerId, pt);

    if (pointers.size === 2 && selected()) {
      // pinch takes over from drag
      const [a, b] = [...pointers.values()];
      const set = selectionSet();
      gesture = {
        kind: 'pinch',
        startDist: Math.hypot(b.x - a.x, b.y - a.y),
        startAngle: Math.atan2(b.y - a.y, b.x - a.x),
        centroid: centroidOf(set),
        snapshot: set.map((x) => ({ id: x.id, x: x.x, y: x.y, scale: x.scale, rotation: x.rotation })),
      };
      return;
    }

    if (gesture?.kind === 'handle') return; // handle gestures own the pointer

    const pieceEl = e.target.closest?.('.piece');
    if (pieceEl) {
      const id = pieceEl.dataset.id;
      if (state.selectedPieceId !== id) {
        state.selectedPieceId = id;
        updateSelectionUI();
      }
      gesture = {
        kind: 'drag', start: pt,
        snapshot: selectionSet().map((x) => ({ id: x.id, x: x.x, y: x.y })),
      };
    } else if (!e.target.closest('.handle')) {
      state.selectedPieceId = null;
      gesture = null;
      updateSelectionUI();
    }
  });

  function startHandleGesture(e, mode) {
    e.stopPropagation();
    svg.setPointerCapture(e.pointerId);
    const s = selected();
    if (!s) return;
    const pt = svgPoint(e);
    const set = selectionSet();
    const c = { x: s.x, y: s.y };
    gesture = {
      kind: 'handle', mode,
      start: pt, center: c,
      startDist: Math.hypot(pt.x - c.x, pt.y - c.y),
      startAngle: Math.atan2(pt.y - c.y, pt.x - c.x),
      centroid: centroidOf(set),
      snapshot: set.map((x) => ({ id: x.id, x: x.x, y: x.y, scale: x.scale, rotation: x.rotation })),
    };
  }

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) && gesture?.kind !== 'handle') return;
    const pt = svgPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
    if (!gesture) return;

    if (gesture.kind === 'drag') {
      const dx = pt.x - gesture.start.x, dy = pt.y - gesture.start.y;
      for (const snap of gesture.snapshot) {
        const piece = p.pieces.find((x) => x.id === snap.id);
        piece.x = snap.x + dx;
        piece.y = snap.y + dy;
        nodeByPiece.get(piece.id)?.setAttribute('transform', pieceTransform(piece));
      }
      liveSelection();
    } else if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      applyScaleRotate(dist / gesture.startDist, (angle - gesture.startAngle) * 180 / Math.PI);
    } else if (gesture.kind === 'handle') {
      const c = gesture.center;
      if (gesture.mode === 'scale') {
        const dist = Math.hypot(pt.x - c.x, pt.y - c.y);
        applyScaleRotate(Math.max(0.1, dist / gesture.startDist), 0);
      } else {
        const angle = Math.atan2(pt.y - c.y, pt.x - c.x);
        applyScaleRotate(1, (angle - gesture.startAngle) * 180 / Math.PI);
      }
    }
  });

  function applyScaleRotate(ds, dAngleDeg) {
    const rad = dAngleDeg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const c = gesture.centroid;
    for (const snap of gesture.snapshot) {
      const piece = p.pieces.find((x) => x.id === snap.id);
      if (!piece) continue;
      piece.scale = Math.min(8, Math.max(0.08, snap.scale * ds));
      piece.rotation = snap.rotation + dAngleDeg;
      // orbit position about the gesture centroid so groups stay coherent
      const rx = snap.x - c.x, ry = snap.y - c.y;
      piece.x = c.x + (rx * cos - ry * sin) * ds;
      piece.y = c.y + (rx * sin + ry * cos) * ds;
      nodeByPiece.get(piece.id)?.setAttribute('transform', pieceTransform(piece));
    }
    liveSelection();
  }

  function liveSelection() {
    // cheap live update: redraw handles only (throttled by rAF)
    if (liveSelection.raf) return;
    liveSelection.raf = requestAnimationFrame(() => {
      liveSelection.raf = null;
      updateSelectionUI();
    });
  }

  function endGesture(e) {
    pointers.delete(e.pointerId);
    if (gesture && (pointers.size === 0 || (gesture.kind === 'pinch' && pointers.size < 2))) {
      gesture = null;
      saveProject();
    }
  }
  svg.addEventListener('pointerup', endGesture);
  svg.addEventListener('pointercancel', endGesture);

  // --- toolbar ----------------------------------------------------------
  const info = el('div', { class: 'muted', style: 'padding:6px 14px 0; font-size:12px' }, '');

  const tb = (icon, label, fn) => {
    const b = el('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick: fn }, icon);
    return b;
  };

  const groupBtn = tb('⛓', 'Move whole artwork together', () => {
    groupMode = !groupMode;
    groupBtn.style.color = groupMode ? 'var(--accent)' : '';
    updateSelectionUI();
  });
  groupBtn.style.color = 'var(--accent)';

  const buttons = {
    textile: tb('🧵', 'Assign material', assignTextile),
    duplicate: tb('⧉', 'Duplicate', () => {
      const set = selectionSet();
      if (!set.length) return;
      const newGroup = uid('art');
      let last = null;
      const maxLayer = p.pieces.reduce((m, x) => Math.max(m, x.layer), -1);
      set.forEach((s, i) => {
        const copy = { ...s, id: uid('piece'), x: s.x + 30, y: s.y + 30, groupId: s.groupId ? newGroup : null, layer: maxLayer + 1 + i };
        p.pieces.push(copy);
        last = copy;
      });
      state.selectedPieceId = last.id;
      renderPieces();
      saveProject();
    }),
    mirror: tb('⇋', 'Mirror', () => {
      for (const s of selectionSet()) s.mirror = !s.mirror;
      renderPieces();
      saveProject();
    }),
    up: tb('▲', 'Bring forward', () => bumpLayer(1)),
    down: tb('▼', 'Send backward', () => bumpLayer(-1)),
    del: tb('🗑', 'Delete', () => {
      const ids = new Set(selectionSet().map((x) => x.id));
      if (!ids.size) return;
      p.pieces = p.pieces.filter((x) => !ids.has(x.id));
      state.selectedPieceId = null;
      renderPieces();
      saveProject();
    }),
  };

  function bumpLayer(dir) {
    const set = selectionSet();
    if (!set.length) return;
    for (const s of set) s.layer += dir * (set.length + 0.5);
    // normalize layers to integers preserving order
    [...p.pieces].sort((a, b) => a.layer - b.layer).forEach((x, i) => { x.layer = i; });
    renderPieces();
    saveProject();
  }

  function toolbarState() {
    const has = !!selected();
    for (const b of Object.values(buttons)) b.disabled = !has;
  }

  function assignTextile() {
    const set = selectionSet();
    if (!set.length) return;
    if (!state.textiles.length) {
      appAlert('Photograph a donor textile first (Textiles tab).');
      return;
    }
    const grid = el('div', { class: 'swatch-grid' });
    for (const t of state.textiles) {
      const tile = el('button', { class: 'swatch' + (set[0].textileId === t.id ? ' selected' : '') },
        el('img', { src: t.swatch, alt: t.name }),
        el('span', { class: 'cap' }, t.name));
      tile.addEventListener('click', () => {
        for (const s of set) s.textileId = t.id;
        modal.close();
        renderPieces();
        saveProject();
      });
      grid.append(tile);
    }
    const modal = showModal('Assign material', el('div', {},
      el('div', { class: 'muted', style: 'margin-bottom:10px' },
        groupMode ? 'Applies to the whole selected artwork.' : 'Applies to the selected piece.'),
      grid));
  }

  const toolbar = el('div', { id: 'designer-toolbar' },
    groupBtn, buttons.textile, buttons.duplicate, buttons.mirror,
    buttons.up, buttons.down, buttons.del,
  );

  // --- assemble ---------------------------------------------------------
  const inner = el('div', { class: 'screen-inner' });
  if (!p.pieces.length) {
    inner.append(el('div', { class: 'pad', style: 'padding-bottom:0' },
      el('div', { class: 'card' },
        el('div', { class: 'muted' }, 'No artwork on the garment yet.'),
        el('div', { class: 'btn-row', style: 'margin-bottom:0' },
          el('button', { class: 'btn small', onclick: () => navigate(`#/p/${p.id}/artwork`) }, '+ Add artwork')))));
  }
  inner.append(info, wrap, toolbar);
  container.append(inner);

  renderPieces();
}
