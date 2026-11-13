# TemariCad: Plan and status

Spec and data model: `ARCHITECTURE.md`.

## How to run

- `bun install`
- `bun test`: kernel test suites in `test/`
- `bun run typecheck`
- `bun run dev`: web UI at http://127.0.0.1:5183 (browser-pane preview config `temaricad` in `D:\Workspace\.claude\launch.json`)
- `bun run tauri dev`: desktop window (first Rust build takes about a minute)

## Status

### Milestone 1: kernel (done 2026-11-13)

- [x] Vite + React 19 + TS + Tailwind v4 scaffold, Tauri v2 shell (`cargo check` passes)
- [x] Data model: line, polyline, double line, wall, rect, circle, arc, ellipse, polygon, spline, guide, dimension, symbol
- [x] Primitives, bboxes (exact for arcs/ellipses), closest point (Newton for ellipses/splines)
- [x] Intersections: analytic line/line, line/circle, circle/circle, line/ellipse; Newton-refined curve/curve; apparent (extended)
- [x] R-tree index with unbounded guides and exact nearest queries
- [x] Snap engine: END, MID, CEN, QUAD, INS, INT, APP, PERP, TAN, ON, alignment guides, parallel, angle lock, grid
- [x] Construction: 2P/3P circle, 3P arc, start-end-radius arc, regular polygons (3 methods), 3P rect, tangent-tangent-radius
- [x] Units: expression parser (architectural, engineering, metric) and formatter
- [x] Freehand decimation (RDP)
- [x] Architect review fixes: polyline bulges, mirrored/non-uniform symbols, NURBS splines, partial ellipses,
      precise far-from-origin circle3P, spaced-dash parsing, empty vs unbounded index entries, prim cache, `CadDocument`

### Milestone 2: workspace (in progress)

Goal from the owner: core features with modern improvements, but it must *feel* like the classic Mac CAD program it is modelled on.
The owner will supply the original program as a reference soon; until then the look is a classic
Mac (System 7-era) style: white canvas, 1-px black lines, floating palettes with striped title
bars, small monochrome icons, a tool palette whose tools pop out their Methods.

Design:
- **Store** (`src/state/`): Zustand. `useDocumentStore` holds the `CadDocument`, selection and an
  `EntityIndex` kept in step with every change. All edits go through `commit(patch)`; a patch is
  `{label, added, removed, changed: [before, after]}`, so undo/redo inverts it (no snapshots).
  `useToolStore` holds the active tool, its method, modifier toggles and tool settings.
- **Tools** (`src/tools/`): plain TS objects, not React. A tool gets snapped pointer events, keys and
  typed HUD values, and returns preview entities + guide marks; it commits through the store.
  One file per tool family. Esc cancels, Enter/double-click finishes multi-click tools.
- **Viewport** (`src/canvas/`): camera with y-up world (mm) → screen, cursor-centred wheel zoom,
  middle-drag / space-drag pan, zoom-to-fit. Three stacked canvases: grid, static geometry
  (redrawn on document/camera change), overlay (rubber band, selection, snap badge, guides; per
  mouse move). HiDPI aware.
- **UI** (`src/components/`): menu bar (File, Edit, View, Arrange placeholders), floating Tools palette,
  Methods bar, Modifiers palette, Coordinates HUD at the bottom (X, Y, ΔX, ΔY, length, angle;
  Tab jumps into the fields, typed values feed the active tool through the units parser).

Tools in M2: Select (click, shift-add, marquee inside L→R / crossing R→L, drag to move, Delete),
Line (2-point, continuous, polar), Double Line (center/left/right, width), Rectangle (corner,
center, 3-point, rounded), Circle (center-radius, diameter, 3-point), Arc (center-start-end,
3-point, start-end-radius), Ellipse (box, center-axes), Polygon (center-vertex, center-side, edge),
Spline (control points, interpolated, freehand), Guides (horizontal, vertical, angled, 2-point).
Walls, trim/fillet, dimensions and the select tool's lasso/vertex reshape come in M3.

- [x] Command stack (typed ops with draw-order indices; one `applyOps` for commit/undo/redo/load; entities frozen in dev)
- [x] Camera (float64 world→screen, cursor-centred zoom, middle/space-drag pan, trackpad pan, fit) and grid on snap multiples
- [x] Tools palette (hold or right-click for Methods), Methods bar with method settings, Modifiers palette, Coordinates HUD (Tab-to-type, unit expressions)
- [x] All M2 creation tools with rubber band, snap badge, alignment guides; press-drag-release or click-click
- [x] Select: click, Shift-toggle, marquee inside/crossing, drag-move as one undo step, Delete, arrow nudge
- [x] Menus: File (New), Edit (Undo/Redo with labels, Clear, Select All), View (zoom, grid, line weights), Layout (units), Window

Keys: tool letters V L D R C A E G S U (press again to cycle Methods), Esc cancels / back to Select,
Enter or right-click finishes, Backspace removes the last point, C closes a continuous line, Shift = 45° lock,
F fits, Ctrl+Z / Ctrl+Y / Ctrl+A, Space-drag pans, Tab jumps to the HUD.

Not yet: one-shot modifier hotkeys mid-command, parallel-offset and perpendicular guides,
arc tangent-to-entity, lasso/polygon select and vertex reshape (M3), layer UI (M4).
Waiting on the owner's reference copy of the original program to match the look and behaviour.

### Milestone 3: editing, walls, dimensions (done 2026-11-13)

- [x] Path model, trim (with hover preview of the piece), split, extend, offset (line/arc/circle/rect/polygon/polyline)
- [x] Fillet (line-line incl. radius 0, line/arc/circle via tangent circles) and chamfer (2 distances or distance + angle); trim both / first / none
- [x] Smart walls: L corners, T joins, X crossings, openings; continuous walls; Opening method
- [x] Grip editing of every entity kind; Select gains Lasso and Polygon methods
- [x] Associative dimensions: horizontal, vertical, aligned, chain, baseline, angular, radius, diameter, center mark;
      follow moves/grips/rotations in the same undo step, re-attach by position after trims, detach when the point is gone
- [x] Drafting-standard presets for dimension appearance (ANSI default; ISO/DIN/JIS/BS308 defined, picker comes in M4)
- [x] Arrange: Duplicate (Ctrl+D), Step and Repeat, Polar Array, Rotate, Scale, Flip H/V, Bring to Front / Send to Back
- [x] Fixed two M2 bugs found in the browser: drags never reached the Select tool (moves were only forwarded for
      freehand), and a disposed viewport (React StrictMode double mount) kept its canvas listeners and acted twice

New keys: W wall, M dimension, T trim, X extend, K split, O offset, I fillet, H chamfer, Ctrl+D duplicate.
Dev hook: `window.__stores.doc` / `.tool` and `window.__cad` (use these from the console; `import()` can load a second copy).

Known gaps: splines can't be trimmed/split/offset yet; ellipse offset unsupported; 3+ walls meeting at one point are
left unmitred; extend works on lines, arcs and straight polyline ends; fillet of two arcs picks the minor fillet arc.

Design notes (as built):

Design:
- **Path model** (`kernel/path.ts`): line, polyline (with bulges), polygon, rect, circle, arc and
  ellipse map to a chain of primitives with one global parameter s ∈ [0, n] (prim i covers [i, i+1]).
  Trim/split/extend cut that range and rebuild entities from sub-ranges (one seg → line, one arc →
  arc, full arc → circle, one ell → partial ellipse, mixed → polyline with bulges). Rect/polygon
  become polylines once cut. The first piece keeps the original id. Splines are not editable this way yet.
- **Edits** (`kernel/booleanOps.ts`, pure): trimAt(target, pick, cutters), extendTo(target, pick,
  boundaries), splitAt(target, point), offset(entity, distance, sidePoint), fillet(e1, pick1, e2,
  pick2, r, trimMode), chamfer(e1, pick1, e2, pick2, d1, d2 | d1+angle). Lines and arcs for
  fillet/chamfer; offset for line/arc/circle/polyline/rect/polygon.
- **Transforms** (`kernel/edit.ts`): transformEntity(e, T) for any similarity incl. mirror
  (rotate, flip, scale, arrays).
- **Walls** (`kernel/wallSolver.ts`): whole-document solve → Map<wallId, Prim[]>. L corners
  (shared endpoint: faces meet), T joins (end inside another wall's band: faces run to its near
  face, which gets a gap), X crossings (faces removed inside the other band), openings
  (`WallEntity.openings`, jambs). Stored in `index.ctx.wallPrims`, recomputed in applyOps
  whenever a wall changes; wall prims bypass the prim cache.
- **Associative dimensions** (`kernel/dimensions.ts`): refs name entity handles ("a", "b", "mid",
  "center", "start", "end", "vertex:i", "quad:k"); handle chosen by matching the snapped point
  against the entity's handle points. `withDependents(doc, patch)` appends replace ops that
  recompute dimension points for every entity the patch changes (refs to removed entities are
  dropped, points kept), so associativity is part of the same undo step. Geometry (extension lines,
  dimension line, arrows, text) is built from a DimStyle (ANSI defaults; M4 adds the other
  standards); paper sizes × layer scale. Types: horizontal, vertical, aligned, chain, baseline,
  angular, radius, diameter, center mark.
- **Grips** (`kernel/grips.ts`): handles(e) and moveHandle(e, handle, p) per kind; Select drags a
  handle of a selected entity with snapping, one replace on release.
- **Tools**: Trim, Extend, Split, Offset, Fillet, Chamfer, Wall (center/left/right, continuous,
  opening), Dimension; Select gains Lasso and Polygon methods.
- **Arrange menu**: Duplicate, Step & Repeat (N × ΔX, ΔY), Polar Array (N over θ about a point),
  Rotate, Flip H/V, Bring to Front / Send to Back (reorder op).

### Milestones 4–5

See `ARCHITECTURE.md` §5.

## Known gaps / notes

- Tangent snap works on circles/arcs only (not ellipses or splines).
- Intersections that touch tangentially between two curves (double roots) may be missed by the Newton path.
- Walls are capped bands until the wall solver lands (M3).
