/**
 * build-single.mjs — bundle the app into one self-contained HTML file.
 *
 * The app is plain ES modules with no name collisions across files, so the
 * bundle is a deterministic concatenation in dependency order with
 * import/export statements stripped (function declarations hoist, and app.js
 * — the only module with top-level execution — goes last).
 *
 * Outputs:
 *   dist/restitch.html      standalone page (open directly or host anywhere)
 *   dist/restitch-body.html body-only fragment (for hosts that provide the
 *                           <html>/<head>/<body> skeleton, e.g. Claude Artifacts)
 *
 * Usage: node tools/build-single.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order: leaf modules first, app.js (kicks off routing) last.
const MODULES = [
  'js/util.js',
  'js/db.js',
  'js/services/geometry.js',
  'js/services/shapes.js',
  'js/services/nest.js',
  'js/services/svgexport.js',
  'js/services/imaging.js',
  'js/services/ai.js',
  'js/state.js',
  'js/screens/projects.js',
  'js/screens/garment.js',
  'js/screens/textile.js',
  'js/screens/artwork.js',
  'js/screens/designer.js',
  'js/screens/preview.js',
  'js/screens/make.js',
  'js/app.js',
];

function stripModuleSyntax(src, name) {
  return (
    `// ───────────────────────── ${name} ─────────────────────────\n` +
    src
      // import ... from '...'; (single- or multi-line)
      .replace(/^import\b[^;]*;\s*$/gm, '')
      // export function / export async function / export const / export class
      .replace(/^export\s+(?=(async\s+)?(function|const|let|class)\b)/gm, '')
  );
}

const js = (await Promise.all(
  MODULES.map(async (m) => stripModuleSyntax(await readFile(path.join(root, m), 'utf8'), m)),
)).join('\n');

if (/^\s*(import|export)\b/m.test(js)) {
  throw new Error('Bundle still contains module syntax — check stripModuleSyntax.');
}

const css = await readFile(path.join(root, 'css/app.css'), 'utf8');
const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const bodyMatch = indexHtml.match(/<body>([\s\S]*?)<script/);
if (!bodyMatch) throw new Error('Could not extract app markup from index.html');
const markup = bodyMatch[1].trim();

const core = `<style>
${css}</style>
${markup}
<script type="module">
${js}</script>
`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#14110f">
<title>ReStitch</title>
</head>
<body>
${core}</body>
</html>
`;

const fragment = `<title>ReStitch</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
${core}`;

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/restitch.html'), standalone);
await writeFile(path.join(root, 'dist/restitch-body.html'), fragment);
console.log(`dist/restitch.html      ${(standalone.length / 1024).toFixed(0)} KB`);
console.log(`dist/restitch-body.html ${(fragment.length / 1024).toFixed(0)} KB`);
