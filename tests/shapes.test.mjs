import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wildflower, generateFromPrompt, TEMPLATES } from '../js/services/shapes.js';

test('wildflower decomposes into cuttable components', () => {
  const art = wildflower({ petals: 5, sizeMm: 90, leaves: 2, stem: true, seed: 42 });
  const roles = art.components.map((c) => c.role);
  assert.equal(roles.filter((r) => r === 'petal').length, 5);
  assert.equal(roles.filter((r) => r === 'center').length, 1);
  assert.equal(roles.filter((r) => r === 'leaf').length, 2);
  assert.equal(roles.filter((r) => r === 'stem').length, 1);
  for (const c of art.components) {
    assert.ok(c.pathMm.length > 10, `${c.name} has geometry`);
    assert.ok(c.bboxMm.w > 0 && c.bboxMm.h > 0, `${c.name} has a real bbox`);
  }
});

test('wildflower is deterministic for a given seed', () => {
  const a = wildflower({ petals: 6, seed: 7 });
  const b = wildflower({ petals: 6, seed: 7 });
  assert.deepEqual(a, b);
});

test('prompt parser: petal count, size and stem are honored', () => {
  const art = generateFromPrompt('a small five petal wildflower with a stem', 1);
  assert.match(art.name, /5 petals/);
  assert.ok(art.components.some((c) => c.role === 'stem'));
  const petal = art.components.find((c) => c.role === 'petal');
  assert.ok(petal.bboxMm.h <= 30, 'small flower → petals under 30mm');
});

test('prompt parser: word numbers and other shapes', () => {
  assert.match(generateFromPrompt('a seven pointed star', 1).name, /7 points/);
  assert.match(generateFromPrompt('big heart', 1).name, /Heart/);
  assert.match(generateFromPrompt('three leaves on a branch', 1).name, /Leaf sprig \(3\)/);
});

test('prompt parser falls back to a manufacturable default', () => {
  const art = generateFromPrompt('something nice', 1);
  assert.ok(art.components.length > 0);
});

test('every template builds valid components', () => {
  for (const t of TEMPLATES) {
    const art = t.build(3);
    assert.ok(art.components.length >= 1, t.id);
    for (const c of art.components) {
      assert.ok(Number.isFinite(c.bboxMm.w) && c.bboxMm.w > 0, `${t.id}/${c.name}`);
    }
  }
});
