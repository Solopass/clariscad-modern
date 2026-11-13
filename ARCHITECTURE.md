# TemariCad: Architecture

A modern, local-first 2D precision drafting program for Windows 11 and macOS,
modelled on the classic early-1990s Mac 2D CAD programs. This file is the feature
contract and data model; `PLAN.md` tracks status. The original blueprint came
from the owner on 2026-11-13. Where this file differs from it, the
"Decisions" section explains why.

> The feature list below is the blueprint's. It has not been checked against
> a real copy of the original program, and some items (Smart Walls, the five
> drafting-standard presets) are probably additions, not original features.
> Treat it as our spec, not as a description of the 1990s product.

## 1. Tech stack

- **Desktop runtime:** Tauri v2 (Rust): native file dialogs, menus, file I/O, PDF/print. `src-tauri/`.
- **Frontend:** React 19 + TypeScript + Tailwind CSS v4, built with Vite (dev port 5183, loopback only).
- **State:** Zustand, with a command-pattern undo/redo stack.
- **Rendering:** stacked HTML5 Canvas 2D layers: grid/guides, cached static geometry, live overlay (rubber band, snap badges).
- **Spatial index:** R-tree (`rbush`) for hit-testing and snap queries.
- **Geometry:** pure TypeScript float64 kernel in `src/kernel/`, with no React, DOM or canvas imports.
- **Tooling:** Bun (package manager, test runner). There is no Node on this PC: use `bun x` instead of `npx`.

## 2. Layout

```text
temaricad/
├── src-tauri/                  Rust shell (Tauri v2)
├── src/
│   ├── kernel/                 pure geometry, no UI deps
│   │   ├── vec.ts              Vec2 math, angles, tolerances
│   │   ├── transform.ts        2D affine transforms
│   │   ├── types.ts            entity / layer / symbol data model
│   │   ├── prims.ts            entity → primitives (seg, arc, xline, ellipse, curve), bboxes, closest point
│   │   ├── intersections.ts    exact line/circle/ellipse solvers + Newton-refined curve intersections
│   │   ├── spatialIndex.ts     rbush wrapper + EntityIndex (exact nearest queries)
│   │   ├── snapEngine.ts       Modifiers: point snaps, alignment guides, constraints
│   │   ├── construct.ts        construction math (3P circle/arc, TTR, polygons, 3P rect)
│   │   ├── units.ts            length/angle expression parser and formatter
│   │   ├── simplify.ts         freehand decimation (RDP)
│   │   ├── booleanOps.ts       (M3) trim, extend, split, offset, fillet, chamfer
│   │   └── wallSolver.ts       (M3) wall L/T/X junction cleanup, opening breaks
│   ├── state/                  (M2) document store, tool store, command stack
│   ├── io/                     (M5) .tcad, DXF, SVG, PDF
│   └── components/             (M2+) viewport, palettes, dialogs
└── test/                       bun test suites
```

## 3. Kernel design

- **Units:** model space is millimetres, float64. Angles are radians, measured CCW. Arcs run CCW from `start` to `end`.
- **Entities are plain data** (`types.ts`): serializable, no methods, safe for the store, undo stack and file format.
- **Primitives:** every entity is decomposed by `toPrims()` into `seg`, `arc` (circles are 2π arcs), `xline` (guides),
  `ell` (elliptical arcs) and `curve` (splines with an evaluator plus flattened polyline). Intersections, snapping,
  bounding boxes and hit-testing operate on primitives only, so a new entity kind needs only a `toPrims` case.
- **Intersections:** line/line, line/circle, circle/circle and line/ellipse are solved analytically.
  Ellipse/arc, ellipse/ellipse and anything involving splines seed from flattened polylines and are polished with
  Newton's method; tests check results to 1e-9.
- **Apparent intersections:** the `extend` option treats segments as infinite lines and arcs as full circles.
- **Snapping** (`snap()`): gathers candidates from entities within the pick radius, ranks by priority
  (END = INT < CEN = MID = INS < QUAD < PERP = TAN < APP < ALIGN < ON) then distance. With no point snap in range,
  constraints apply in order: parallel direction lock, angle lock, grid. Results carry a label for the cursor badge
  and guide segments for dotted alignment lines.
- **Spatial index:** unbounded entities (guides) are kept outside the R-tree and returned by every query.
- **Walls** are capped bands in the kernel for now; junction cleanup belongs to `wallSolver.ts` (M3).
- **Dimensions** have no snap geometry; they are drawn by the dimension renderer from their definition points and
  associative `refs`.

## 4. Feature contract (from the blueprint)

### Tools, Methods, Modifiers

Tools are *what* is drawn, Methods are *how* the clicks build it, Modifiers are *where* points lock.

| Tool | Methods |
| --- | --- |
| Select / Reshape | Marquee (inside vs crossing), lasso, polygon select, vertex reshape handles |
| Single Line | Two-point, continuous polyline, polar (length + angle), orthogonal |
| Double Line | Center/left/right justified, custom width, open/capped ends |
| Smart Wall | Auto-healing L/T/X junctions, cavity/fill pattern, door/window insertion auto-break |
| Rectangle | Corner-corner, center-corner, 3-point rotated, rounded corners |
| Circle | Center-radius, 2-point diameter, 3-point, tangent-tangent-radius |
| Arc | Center-start-end, 3-point, start-end-radius, tangent to entity |
| Ellipse | Bounding box, center + axes, rotated |
| Regular Polygon | Center-vertex (inscribed), center-side (circumscribed), edge length; 3–64 sides |
| Spline / Freehand | Control-point B-spline, interpolated, freehand with decimation |
| Graphic Guides | Infinite horizontal, vertical, angled, parallel-offset, perpendicular |
| Fillet / Chamfer | Trim both / first / none; radius, or distance × distance / distance + angle |
| Trim / Extend / Split | Click-trim between intersections, extend to boundary, split at point/entity |
| Duplicate / Array | Linear step-and-repeat (N at ΔX, ΔY), polar array (N over θ) |
| Dimensioning | Linear H/V/aligned, chain, datum/baseline, angular, radius, diameter, center marks |

### Modifiers

- Point snaps: endpoint, midpoint, center, quadrant, intersection (real and apparent), nearest on entity, symbol insertion point.
- Constraints: perpendicular, tangent, parallel, angle lock (custom increment), grid.
- Smart cursor: floating badge (`END`, `MID`, `CEN`, `INT`, `PERP`, `TAN`, ...) and dotted alignment guides from hovered vertices.
- Modifiers toggle globally or one-shot by hotkey mid-command.

### Layers, standards, units

- Per-layer drawing scale (e.g. 1/4" = 1'-0" plan and 1" = 1'-0" detail on one sheet).
- Units: architectural (`12'-4 3/8"`), engineering (`12.365'`), decimal inches/feet, mm, cm, m; HUD fields accept
  expressions (`24 + 3/16`).
- Drafting standard presets: ANSI Y14.5, ISO, DIN, JIS, BS 308 (arrowheads, extension-line gaps, text placement, tolerances).
- Hatches clipped to closed boundaries (brick, concrete, steel, insulation, wood, crosshatch); pen weights 0.13–2.00 mm; dash patterns.

### Files

- `.tcad` native JSON (layers with scales, associative dimension links, symbols), Save / Save As / Open, crash-recovery backup.
- DXF R12/2000 import/export (layers, linetypes, arcs, circles, polylines, blocks, dimensions).
- SVG at true scale; vector PDF with pen-color-to-weight mapping and multi-page tiling.
- Native menus: File, Edit, Arrange, Layout, Standards, Window.

## 5. Milestones

1. **Kernel**: data model, intersections, spatial index, snap engine, units, construction helpers, tests.
2. **Workspace**: camera (world↔screen, cursor-centred zoom, middle-mouse pan, adaptive grid), Tools palette,
   Methods bar, Modifiers palette, Coordinates HUD with Tab-to-type, all creation tools with rubber band and snap
   badges, undo/redo.
3. **Editing**: wall solver, trim/extend/split/offset/fillet/chamfer, grip editing, associative dimensions.
4. **Organization**: layers dialog with per-layer scale, hatches and pen styles, symbol library, drafting standards.
5. **Files and packaging**: .tcad, DXF, SVG, PDF, native menus and shortcuts, installers.

## 6. Decisions (changes from the blueprint)

- **Bun instead of npm + Vitest.** This PC has no Node; Bun runs the tests with the same `describe/test/expect` API.
- **Millimetres as model units.** Imperial values are exact enough in float64 (1/64" = 0.396875 mm exactly).
- **`prims.ts` added** as the shared layer between entities and all geometry algorithms.
- **`construct.ts`, `units.ts`, `simplify.ts` live in the kernel** because they are pure math the UI methods need and they
  are easy to test there.
- **Rectangles are their own entity** (centre, size, rotation, corner radius) rather than polygons, so rounded corners
  and the rectangle methods keep their construction data.
- **One model space for all layers.** Every layer's geometry is in the same millimetre coordinates; `Layer.scale`
  only changes how that layer is shown and printed on the sheet and the paper size of its annotations. Snapping and
  intersections across layers therefore need no conversion.
- **DXF-ready entities** (from the M1 review): polylines carry optional bulges (arc segments); symbol instances have
  `scaleX`/`scaleY` (negative = mirrored); splines are NURBS (`degree`, `knots`, `weights`, de Boor evaluation, clamped
  uniform by default); ellipses can be partial (`start`/`end`); polygon centres are always derived, never stored.
- **Dimension refs use vertex indices.** Any command that inserts/removes/splits vertices must remap the refs that
  point at the entity, in the same undoable command (M3 command stack).
- **`CadDocument`** (types.ts) is the saved shape: `version`, units, standard, layers, ordered entity list (draw order), symbols.
