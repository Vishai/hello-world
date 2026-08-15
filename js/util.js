/** util.js — small DOM + misc helpers. */

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** el('div', {class: 'card', onclick: fn}, child1, 'text', ...) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k === 'html') {
      node.innerHTML = v;
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, v);
  }
  return node;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Read a File as a downscaled JPEG/PNG data URL (bounds memory + storage). */
export function fileToDataURL(file, maxDim = 1400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      // keep alpha if the source may have it
      const isPng = /png|webp|svg/.test(file.type);
      resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.88));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function downloadText(filename, text, mime = 'image/svg+xml') {
  // Claude Artifact runtime: direct browser downloads are sandboxed away —
  // use the viewer-consented save dialog, falling back to copy-the-text.
  if (typeof window !== 'undefined' && window.claude?.use) {
    let downloads = null;
    try { downloads = await window.claude.use('downloads'); } catch { /* absent */ }
    if (downloads) {
      try {
        await downloads.save({ filename, data: text });
        return;
      } catch (err) {
        if (err?.code === 'declined') return; // viewer said no — respect it
        if (err?.code === 'extension_not_enabled' || err?.code === 'rejected_extension') {
          try {
            await downloads.save({ filename: `${filename}.txt`, data: text });
            return;
          } catch (err2) {
            if (err2?.code === 'declined') return;
          }
        }
      }
    }
    showCopyFallback(filename, text);
    return;
  }

  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Last-resort export path: show the file contents to copy/paste. */
function showCopyFallback(filename, text) {
  const ta = el('textarea', { rows: 8, readonly: '', style: 'font-family:monospace;font-size:11px' });
  ta.value = text;
  const copyBtn = el('button', { class: 'btn small' }, 'Copy to clipboard');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied ✓';
    } catch {
      ta.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copied ✓';
    }
  });
  showModal(filename, el('div', {},
    el('div', { class: 'muted', style: 'margin-bottom:8px' },
      `Saving isn’t available here — copy the file contents and paste into a file named “${filename}”.`),
    ta,
    el('div', { class: 'btn-row' }, copyBtn)));
}

/** In-app replacements for confirm()/alert() — sandboxed iframes (like the
 *  Claude Artifact viewer) silently no-op the native dialogs. */
export function appConfirm(message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; modal.close(); resolve(v); } };
    const modal = showModal('Are you sure?', el('div', {},
      el('div', { class: 'muted', style: 'margin-bottom:12px' }, message),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn danger', onclick: () => finish(true) }, confirmLabel),
        el('button', { class: 'btn secondary', onclick: () => finish(false) }, 'Cancel'))),
      { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

export function appAlert(message) {
  return new Promise((resolve) => {
    const modal = showModal('Heads up', el('div', {},
      el('div', { class: 'muted', style: 'margin-bottom:12px' }, message),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn', onclick: () => modal.close() }, 'OK'))),
      { onClose: resolve });
  });
}

/** Bottom-sheet modal. Returns { close }. */
export function showModal(title, contentNode, { onClose } = {}) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' }, el('h2', {}, title), contentNode);
  backdrop.append(modal);
  const close = () => { backdrop.remove(); onClose?.(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  return { close };
}

export function fmtMm(mm) {
  return mm >= 100 ? `${(mm / 10).toFixed(1)} cm` : `${Math.round(mm)} mm`;
}

export function fmtArea(mm2) {
  if (mm2 >= 1e6) return `${(mm2 / 1e6).toFixed(2)} m²`;
  return `${(mm2 / 100).toFixed(0)} cm²`;
}
