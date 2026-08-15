/** Projects screen — create and manage designs (MVP screen 1 & 8). */

import { el, showModal } from '../util.js';
import { newProject, listProjects, deleteProject } from '../state.js';
import { db } from '../db.js';
import { navigate } from '../app.js';

export async function renderProjects(container) {
  const projects = await listProjects();
  const pad = el('div', { class: 'pad' });

  pad.append(
    el('button', {
      class: 'btn block',
      onclick: () => promptNewProject(),
    }, '+ New design'),
  );

  if (!projects.length) {
    pad.append(el('div', { class: 'empty-state' },
      el('div', { class: 'big' }, '🧵'),
      el('div', {}, 'Turn thrifted garments and reclaimed fabric into one-of-one apparel.'),
      el('div', { class: 'small-note' },
        'Photograph a garment, photograph a donor textile, design the appliqué, preview it, then export cutting patterns.'),
    ));
  }

  for (const p of projects) {
    const thumb = p.previewImage || p.garment?.maskImage || p.garment?.image;
    const row = el('button', { class: 'project-row' },
      thumb
        ? el('img', { class: 'project-thumb', src: thumb, alt: '' })
        : el('div', { class: 'project-thumb' }),
      el('div', { class: 'grow' },
        el('div', { class: 'name' }, p.name),
        el('div', { class: 'muted' },
          `${p.pieces.length} piece${p.pieces.length === 1 ? '' : 's'} · ` +
          new Date(p.updatedAt).toLocaleDateString()),
      ),
      el('button', {
        class: 'icon-btn', 'aria-label': 'Delete project',
        onclick: async (e) => {
          e.stopPropagation();
          if (confirm(`Delete “${p.name}”? This cannot be undone.`)) {
            await deleteProject(p.id);
            container.replaceChildren();
            renderProjects(container);
          }
        },
      }, '🗑'),
    );
    row.addEventListener('click', () => navigate(`#/p/${p.id}/garment`));
    pad.append(row);
  }

  container.append(pad);
}

function promptNewProject() {
  const input = el('input', { type: 'text', placeholder: 'e.g. Denim Wildflower Hoodie', autofocus: '' });
  const content = el('div', {},
    el('label', { class: 'field' }, 'Design name', input),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn',
        onclick: async () => {
          const proj = newProject(input.value.trim());
          await db.put('projects', proj);
          modal.close();
          navigate(`#/p/${proj.id}/garment`);
        },
      }, 'Create'),
    ),
  );
  const modal = showModal('New design', content);
  input.focus();
}
