# ReStitch — AI Upcycled Apparel Design & Production Studio

Photograph a real garment and a reclaimed textile, design custom appliqué
visually with AI assistance, preview the finished piece, then export
production-ready cutting patterns.

> Physical garment → physical reclaimed textile → digital design →
> realistic mockup → cuttable pattern → finished one-of-one apparel.

This repository contains the **MVP**: a mobile-first web app that proves the
core workflow end-to-end —
**photograph garment → photograph textile → import/create shape → position →
preview → export cuttable SVG** — with zero dependencies and no build step.

## Running it

Any static file server works:

```bash
cd hello-world
python3 -m http.server 8000
# open http://localhost:8000 (best on a phone — gestures are touch-first)
```

Run the unit tests (pure geometry/production modules):

```bash
node --test tests/*.test.mjs
```

## The MVP flow

| Screen | What it does |
|---|---|
| **Projects** | Create/manage designs; everything autosaves to IndexedDB on-device |
| **Garment** | Photo/upload → automatic background removal (adjustable), garment type, real-world width calibration (px ↔ mm) |
| **Textiles** | Photo/upload donor material → tileable texture swatch, estimated usable area, cost — a user-level library of finite, unique materials |
| **Artwork** | Generate from a text prompt ("a small five-petal wildflower with a stem"), pick a template, upload an SVG, or upload/photograph artwork which is traced into a simplified sewable vector |
| **Designer** | Drag / pinch-resize / pinch-rotate pieces on the actual garment photo; duplicate, mirror, layer, group-move, assign each piece to a donor textile |
| **Preview** | Composited mockup: real textile texture per piece, the garment photo's wrinkles/seams shaded through, stitch lines and fabric-thickness shadows |
| **Make** | Cut list with true dimensions and sew order, per-material nested cutting layouts with a utilization estimate, real-size SVG export (1 unit = 1 mm) for Cricut / Silhouette / Brother / laser / print-and-hand-cut |

## Architecture

```
index.html, css/app.css        app shell (mobile-first, no framework)
js/app.js                      hash router + tabbed project workspace
js/state.js                    data model + autosave (production source of truth)
js/db.js                       IndexedDB persistence (projects + textile library)
js/screens/*.js                one module per MVP screen
js/services/
  geometry.js   pure  path building, bbox, simplify, smoothing   ← tested
  shapes.js     pure  parametric artwork generator + prompt parser ← tested
  nest.js       pure  shelf-nesting + utilization estimate        ← tested
  svgexport.js  pure  real-size production SVG generation         ← tested
  imaging.js    browser  background removal, swatch extraction, contour tracing
  ai.js         the AI adapter seam (see below)
```

### The two-representation principle

Every design keeps two representations, and they never blur:

- **Production representation** (the source of truth): every piece is an SVG
  path authored in **millimeters**, plus placement numbers
  (`x`, `y`, `rotation`, `scale`, `mirror`, `layer`, material assignment).
  Physical size = path bbox × scale; the garment photo is calibrated px↔mm
  from the garment's measured width. Cutting files are generated **only**
  from these numbers.
- **Visual representation**: the designer canvas and the preview mockup are
  renderings *derived from* the production model. The preview writes only a
  cached image and can never silently modify geometry.

### The AI adapter seam

`js/services/ai.js` is the single place "AI" is invoked, with a fixed
contract: segment garment, segment textile, make swatch, trace artwork,
generate artwork, render mockup. The MVP ships with **on-device heuristic
providers** so the entire flow works offline with no keys:

- background removal — border-color estimation + feathered distance mask +
  largest-connected-component cleanup, with a user-adjustable strength slider
- artwork tracing — threshold mask → Moore-neighbour contour following →
  Ramer–Douglas–Peucker simplification → Catmull-Rom smoothing, in mm
- artwork generation — parametric generators that emit artwork **already
  decomposed into cuttable components** (a wildflower = N petals + center +
  leaves + stem, each with its own path and material role)
- mockup — canvas compositing: textile texture fill (density fixed per-mm,
  like real fabric), garment luminance multiplied over pieces so wrinkles and
  seams show through, dashed inset stitch lines, thickness shadows

Swapping in hosted models (a segmentation model for garments, an image model
for photoreal mockups, Claude for prompt→pieces decomposition) means
implementing the same interface in a remote provider — screen code doesn't
change. Per the product's design philosophy, **every AI decision is editable
structured data**: the user can correct the mask, resize the trace, retexture
or delete any generated piece.

### Data model

Matches the product spec: `Project` (status, timestamps) → `Garment` (photo,
mask, type, measured width, cost), user-level `Textile` library (photo,
tileable swatch, estimated/remaining area, cost), `pieces[]` as placed
DesignPieces (mm path, bbox, material, placement, layer, quantity, seam
allowance), plus a cached `previewImage`.

## What's deliberately next (not in the MVP)

- **True shape nesting** — `nest.js` is a clean seam; today it shelf-packs
  bounding boxes with 0°/90° rotation and reports estimated utilization
- **True path offsetting** for seam allowance (today: approximate uniform
  outset, labeled as such)
- Manual mask touch-up brushes; garment region detection (chest/sleeve/back)
- Multi-piece decomposition of *uploaded* artwork (generated artwork already
  decomposes); template library growth
- Collections & scarcity ("7 pieces exist, no reproductions"), design
  recipes, inventory & economics, customer custom-order flow, marketplace —
  the data model already carries the fields these need (areas, costs,
  remaining material)
- Direct cutter integrations (Cricut first) — the exporter is deliberately
  machine-agnostic; real-size SVG imports into all mainstream cutter software
  today
- IP controls: original/licensed/public-domain artwork flags, moderation

## License / IP note

Design your own artwork or use artwork you have rights to. The platform is
built around original, customer-owned, licensed, or public-domain art — not
around reproducing trademarked logos.
