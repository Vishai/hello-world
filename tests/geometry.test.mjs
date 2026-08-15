import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ellipsePath, petalPath, heartPath, starPath, polygonPath,
  smoothClosedPath, simplifyPolyline, polygonArea, pathBBox, roundedRectPath,
} from '../js/services/geometry.js';

test('ellipsePath bbox matches radii', () => {
  const bb = pathBBox(ellipsePath(0, 0, 30, 20));
  assert.equal(bb.w, 60);
  assert.equal(bb.h, 40);
  assert.equal(bb.x, -30);
  assert.equal(bb.y, -20);
});

test('petalPath extends from base(0,0) upward by len', () => {
  const bb = pathBBox(petalPath(50, 24));
  assert.equal(bb.y, -50);
  assert.equal(bb.h, 50);
  assert.ok(bb.w >= 24 - 0.01); // control points make box conservative
});

test('heartPath is roughly size × size and centred', () => {
  const bb = pathBBox(heartPath(80));
  assert.ok(Math.abs(bb.x + bb.w / 2) < 1, 'horizontally centred');
  assert.ok(bb.w > 60 && bb.w < 100);
  assert.ok(bb.h > 60 && bb.h < 100);
});

test('starPath has expected reach', () => {
  const bb = pathBBox(starPath(5, 40, 18));
  assert.ok(Math.abs(bb.y - -40) < 0.01, 'top point at -outerR');
  assert.ok(bb.w <= 80.01);
});

test('roundedRectPath centred on origin', () => {
  const bb = pathBBox(roundedRectPath(50, 30, 8));
  assert.equal(bb.w, 50);
  assert.equal(bb.h, 30);
  assert.equal(bb.x, -25);
});

test('simplifyPolyline keeps endpoints and reduces points', () => {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push([i, Math.sin(i / 8) * 0.1]); // near-straight
  const out = simplifyPolyline(pts, 0.5);
  assert.ok(out.length < 10);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
});

test('polygonArea of unit square', () => {
  assert.equal(Math.abs(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])), 1);
});

test('smoothClosedPath produces a closed cubic path', () => {
  const d = smoothClosedPath([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.ok(d.startsWith('M '));
  assert.ok(d.trimEnd().endsWith('Z'));
  assert.ok(d.includes('C '));
});

test('polygonPath round-trips through pathBBox', () => {
  const bb = pathBBox(polygonPath([[-5, -5], [15, -5], [15, 25], [-5, 25]]));
  assert.deepEqual(bb, { x: -5, y: -5, w: 20, h: 30 });
});
