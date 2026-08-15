/**
 * Preview screen (MVP screen 6) — realistic mockup of the finished piece.
 *
 * Local compositing pipeline (the ai.js adapter can swap in an image-model
 * renderer later): real textile textures fill each piece, the garment
 * photo's own luminance is multiplied back over the appliqué so wrinkles,
 * seams and folds show through, a soft shadow suggests fabric thickness,
 * and a dashed inset line simulates appliqué stitching.
 *
 * §19 guarantee: this screen READS the production model and writes only a
 * cached image (`project.previewImage`). It never alters geometry.
 */

import { el, loadImage } from '../util.js';
import { state, saveProject, pxPerMm, getTextile } from '../state.js';
import { navigate } from '../app.js';

export async function renderPreview(container) {
  const p = state.project;
  const pad = el('div', { class: 'pad' });
  container.append(pad);

  if (!p.garment || !p.pieces.length) {
    pad.append(el('div', { class: 'empty-state' },
      el('div', { class: 'big' }, '👁'),
      el('div', {}, 'Place some artwork on the garment first.'),
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${p.id}/designer`) }, 'Open designer')));
    return;
  }

  pad.append(el('div', { class: 'empty-state' }, el('div', { class: 'big' }, '🪄'), el('div', {}, 'Rendering mockup…')));

  const dataUrl = await renderMockup(p);
  p.previewImage = dataUrl;
  saveProject();

  pad.replaceChildren(
    el('div', { class: 'photo-frame' }, el('img', { src: dataUrl, alt: 'Mockup of the finished garment' })),
    el('div', { class: 'card' },
      el('h3', {}, 'Happy with it?'),
      el('div', { class: 'muted' },
        'This preview is a visualization. The cutting patterns are generated from the exact design geometry, not from this image.'),
    ),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn secondary', onclick: () => navigate(`#/p/${p.id}/designer`) }, '← Keep editing'),
      el('button', { class: 'btn', onclick: () => navigate(`#/p/${p.id}/make`) }, 'Make it →'),
    ),
  );
}

async function renderMockup(p) {
  const garmentImg = await loadImage(p.garment.maskImage);
  const W = garmentImg.naturalWidth, H = garmentImg.naturalHeight;
  const ppm = pxPerMm(p);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // neutral studio backdrop so the mockup reads as a product photo
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#efece7');
  grad.addColorStop(1, '#d9d4cc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.drawImage(garmentImg, 0, 0);

  // pre-render a grayscale copy of the garment for shading passes
  const shade = document.createElement('canvas');
  shade.width = W; shade.height = H;
  const sctx = shade.getContext('2d');
  sctx.filter = 'grayscale(1) brightness(1.25) contrast(0.9)';
  sctx.drawImage(garmentImg, 0, 0);

  const swatchCache = new Map();
  async function swatchImage(textileId) {
    if (!swatchCache.has(textileId)) {
      const t = getTextile(textileId);
      swatchCache.set(textileId, t ? await loadImage(t.swatch) : null);
    }
    return swatchCache.get(textileId);
  }

  const sorted = [...p.pieces].sort((a, b) => a.layer - b.layer);
  for (const piece of sorted) {
    const path = new Path2D(piece.pathMm);
    const s = piece.scale * ppm;
    const apply = (c) => {
      c.translate(piece.x, piece.y);
      c.rotate(piece.rotation * Math.PI / 180);
      c.scale(piece.mirror ? -s : s, s);
    };

    // 1. fabric thickness: soft drop shadow under the piece
    ctx.save();
    apply(ctx);
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 2 * ppm; // shadow params are in device px, not local units
    ctx.shadowOffsetX = 0.8 * ppm;
    ctx.shadowOffsetY = 1.2 * ppm;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill(path);
    ctx.restore();

    // 2. textile texture fill (texture density is per-mm, independent of
    //    piece scale, like real printed fabric)
    ctx.save();
    apply(ctx);
    ctx.clip(path);
    const sw = await swatchImage(piece.textileId);
    if (sw) {
      const pat = ctx.createPattern(sw, 'repeat');
      const tileMm = 80;
      const m = new DOMMatrix().scale(tileMm / sw.width / piece.scale);
      pat.setTransform(m);
      ctx.fillStyle = pat;
    } else {
      ctx.fillStyle = '#b9917b';
    }
    const bb = piece.bboxMm;
    ctx.fillRect(bb.x - 2, bb.y - 2, bb.w + 4, bb.h + 4);
    ctx.restore();

    // 3. garment shading multiplied over the piece: wrinkles/folds show through
    ctx.save();
    apply(ctx);
    ctx.clip(path);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.5;
    // draw the grayscale garment in garment-image space: undo piece transform
    ctx.scale(piece.mirror ? -1 / s : 1 / s, 1 / s);
    ctx.rotate(-piece.rotation * Math.PI / 180);
    ctx.translate(-piece.x, -piece.y);
    ctx.drawImage(shade, 0, 0);
    ctx.restore();

    // 4. appliqué stitching: dashed inset line around the edge
    ctx.save();
    apply(ctx);
    const cbx = bb.x + bb.w / 2, cby = bb.y + bb.h / 2;
    ctx.translate(cbx, cby);
    ctx.scale(0.93, 0.93);
    ctx.translate(-cbx, -cby);
    ctx.strokeStyle = 'rgba(35,28,22,0.85)';
    ctx.lineWidth = 0.9;
    ctx.setLineDash([2.6, 1.8]);
    ctx.stroke(path);
    ctx.restore();

    // 5. raw fabric edge: thin light line right on the cut edge
    ctx.save();
    apply(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.5;
    ctx.stroke(path);
    ctx.restore();
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}
