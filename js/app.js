/**
 * app.js — hash router + app shell.
 *
 * Routes:
 *   #/projects            project list (home)
 *   #/p/<id>/<tab>        project workspace tabs:
 *                         garment | textile | artwork | designer | preview | make
 */

import { state, loadProject, loadTextiles } from './state.js';
import { renderProjects } from './screens/projects.js';
import { renderGarment } from './screens/garment.js';
import { renderTextile } from './screens/textile.js';
import { renderArtwork } from './screens/artwork.js';
import { renderDesigner } from './screens/designer.js';
import { renderPreview } from './screens/preview.js';
import { renderMake } from './screens/make.js';

const SCREENS = {
  garment: { title: 'Base garment', render: renderGarment },
  textile: { title: 'Donor textiles', render: renderTextile },
  artwork: { title: 'Artwork', render: renderArtwork },
  designer: { title: 'Designer', render: renderDesigner },
  preview: { title: 'Preview', render: renderPreview },
  make: { title: 'Make', render: renderMake },
};

const $screen = () => document.getElementById('screen');
const $title = () => document.getElementById('screen-title');
const $tabbar = () => document.getElementById('tabbar');
const $back = () => document.getElementById('back-btn');

export function navigate(hash) {
  location.hash = hash;
}

async function route() {
  const hash = location.hash || '#/projects';
  const parts = hash.replace(/^#\//, '').split('/');
  const container = $screen();
  container.replaceChildren();
  window.scrollTo(0, 0);

  await loadTextiles();

  if (parts[0] === 'p' && parts[1]) {
    const tab = SCREENS[parts[2]] ? parts[2] : 'garment';
    if (!state.project || state.project.id !== parts[1]) {
      const proj = await loadProject(parts[1]);
      if (!proj) { navigate('#/projects'); return; }
    }
    $title().textContent = state.project.name;
    $back().hidden = false;
    $back().onclick = () => navigate('#/projects');
    const bar = $tabbar();
    bar.hidden = false;
    bar.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.onclick = () => navigate(`#/p/${state.project.id}/${b.dataset.tab}`);
    });
    await SCREENS[tab].render(container);
  } else {
    state.project = null;
    $title().textContent = 'ReStitch';
    $back().hidden = true;
    $tabbar().hidden = true;
    await renderProjects(container);
  }
}

window.addEventListener('hashchange', route);
route();
