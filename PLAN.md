# TemariCad: Plan and status

Spec and data model: `ARCHITECTURE.md`.

## How to run

- `bun install`
- `bun test`: kernel test suites in `test/`
- `bun run typecheck`
- `bun run dev`: web UI at http://127.0.0.1:5183 (browser-pane preview config `temaricad` in `D:\Workspace\.claude\launch.json`)
- `bun run tauri dev`: desktop window (first Rust build takes about a minute)
- Web version: every push to `main` runs the tests, builds and deploys to GitHub Pages
  (`.github/workflows/pages.yml`; the build uses relative asset paths so it works under `/temaricad/`).
  Check the production build at a subpath with the `temaricad-dist` preview config (http://127.0.0.1:5184/temaricad/).
  The Pages site is public even though the repo is private.
- `bun run tauri build`: Windows installers in `src-tauri\target\release\bundle\` — `msi\TemariCad_<ver>_x64_en-US.msi`
  and `nsis\TemariCad_<ver>_x64-setup.exe` (first built 2026-11-13, ~90 s; unsigned, so Windows SmartScreen
  warns on install; icons are still Tauri's placeholders)

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

New keys (M4): Y symbol. (M3:) W wall, M dimension, T trim, X extend, K split, O offset, I fillet, H chamfer, Ctrl+D duplicate.
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

### Milestone 4: layers, hatches, symbols, standards (done 2026-11-13)

- [x] Layers palette: visible, locked, colour, rename (double-click), per-layer scale presets/custom, active layer,
      New / Delete (takes its objects, undoable, keeps order) / reorder / Move Selection Here
- [x] Units and drafting standard are undoable document properties; Layout menu has both
- [x] Hatches: 13 patterns (solid, 2 grays, ANSI31, crosshatch, steel, brick, concrete, insulation, wood, earth, sand),
      paper-sized × layer scale × pattern size; tint when too fine to see; walls fill from the solver's outline
- [x] Attributes palette: pen, line type, colour, fill, pattern size; edits the selection and sets new-object defaults
- [x] Symbols: Make / Explode (stretched circles → ellipses), Symbols palette with previews, Symbol tool (Y) with
      scale/rotation, .tcsym import/export with id-collision handling, built-ins (single/double door, window, north
      arrow, section mark) copied into the drawing on first use
- [x] Doors/windows dropped on a wall become openings drawn by the wall (click side sets the swing, nearer end the
      hinge; mirroring flips the swing); symbol fills render

Not yet: true per-layer magnification on the sheet (see design note below); editing a symbol's contents in place;
flip-door commands on existing openings (data is there: `hingeFlip` / `swingFlip`).

Design:
- **Layer scale stays an annotation/print scale** (decision from M1: one shared model space). True
  "each layer magnified on the sheet" (classic multi-scale paper space) is deferred until the owner's
  reference copy shows exactly how it behaved; it would be a view transform per layer, not a data change.
- **Document properties** (units, standard) become an undoable `docProps` op; applyOps re-syncs
  dimension geometry. Layer edits (add, rename, colour, scale, visible, locked, delete, reorder) are
  `layer` ops; deleting a layer removes its entities in the same patch; the last layer can't go.
- **Layers palette**: rows with visible/locked toggles, colour, name, scale preset (1:1, 1/4"=1'-0",
  1/8", 1", 3", 1:20, 1:50, 1:100, custom), active marker; New / Delete / Move Selection Here.
- **Hatches** (`kernel/hatch.ts`): AutoCAD-style line families (angle, origin, spacing, shift, dashes)
  in paper mm × layer scale × fill scale, clipped to an entity's closed outline with the even-odd
  rule. Patterns: solid, light/dark gray (solid tints), ANSI31 diagonal, crosshatch, steel (ANSI32),
  brick, concrete, insulation (zigzag), wood grain, earth, sand (dots). Applies to closed entities via
  `style.fill` (+ `style.fillScale`) and to walls via `wall.fill` (band outline). Generated per entity
  object + scale and cached; capped (falls back to a gray tint when a pattern would be too dense).
- **Attributes palette**: pen weight (0.13–2.00 mm), dash pattern, fill pattern, colour; edits the
  selection (one undo step) and sets the defaults for new entities.
- **Symbols**: Make Symbol (selection → SymbolDef with origin at the selection's lower-left, replaced by
  an instance), Explode, Symbols palette (previews, click to arm the Symbol tool; scale/rotation in
  the Methods bar), export/import a library as `.tcsym` JSON (browser download/upload until M5's native
  dialogs), and a built-in starter set (single/double door, window, north arrow, section mark).
  Door/window symbols carry `opening: { width }`; placing one on a wall adds a wall opening with that
  symbol, drawn by the wall solver scaled to the opening and aligned to the wall (moves with it).
- **Standards**: Layout ▸ Drafting Standard (ANSI, ISO, DIN, JIS, BS 308), undoable, re-styles all
  dimensions.

### Milestone 5: files, export, desktop (done 2026-11-13)

- [x] Text entity + Text tool (Q): Helvetica metrics shared by canvas, PDF and DXF; double-click to edit; mirrors stay readable
- [x] `.tcad` save/open with validation (damaged objects dropped with a warning; newer files refused); title shows
      the file name and • when unsaved; "unsaved" follows undo; autosave every 30 s while unsaved + restore offer on start
- [x] DXF: R12 writer (inches for imperial drawings, layers/colours/linetypes, blocks, bulges, text) and an R12/R2000+
      reader (LWPOLYLINE, POLYLINE, ARC/CIRCLE incl. mirrored OCS, ELLIPSE, SPLINE, XLINE/RAY, TEXT/MTEXT, SOLID,
      INSERT/BLOCKS, DIMENSION via its block); unknown entities reported, not fatal
- [x] Plot dialog: paper sizes, orientation, plot scale or fit, black and white, pen widths by colour; vector PDF
      (hand-written writer, tiled sheets with labels) and true-size SVG
- [x] Desktop: Tauri dialog + fs plugins with scoped permissions; quit asks to save; shortcuts Ctrl/⌘ N O S ⇧S P

Not done: native OS menu bar (deliberately: the in-window classic menu bar is the look we want, and two menu owners
would fire shortcuts twice; a macOS app-menu bar should be added and tested on a Mac); hatch fills are not written
to DXF (lines only); installers not built yet (`bun run tauri build` downloads WiX/NSIS on first run — ask first).

Design:
- **Text** (gap found while planning M5; DXF/PDF need it): `TextEntity { position, text, height (paper mm),
  rotation, align }`, Text tool (click, type in an inline box), drawn at paper height × layer scale.
- **Display list** (`io/plot.ts`): the drawing as renderer-neutral marks in model mm — strokes (polyline,
  closed, pen width mm, colour, dash), fills (rings, colour), text (pos, angle, string, height). Built from
  the same prims, hatches, dimension geometry and symbol fills the canvas uses. SVG and PDF consume it.
- **SVG** (`io/svgExporter.ts`): true-size paper output at a chosen plot scale (mm units, viewBox), pen
  widths in mm.
- **PDF** (`io/pdfPlotter.ts`): small hand-written PDF 1.4 writer (no dependency): sheet sizes (Letter,
  Legal, Tabloid, ANSI C/D, A4–A1), orientation, plot scale or fit, margins, multi-page tiling with page
  labels, Helvetica text, MacPlot-style pen table (colour → width override).
- **Native file** (`io/nativeJson.ts`): `.tcad` = `{ format, version, savedAt, document }`, validated on
  load, migrations by version. Store gains `filePath`, `fileName`, `savedVersion` (dirty = version ≠ saved).
  Autosave to localStorage every 30 s while dirty; on start, offer to restore a newer recovery copy.
- **DXF** (`io/dxfCodec.ts`): writer = AutoCAD R12 ASCII (widest compatibility): HEADER ($ACADVER,
  $INSUNITS), LTYPE + LAYER tables (ACI colours), BLOCKS for symbols, ENTITIES: LINE, CIRCLE, ARC,
  POLYLINE/VERTEX with bulges, XLINE→long LINE (R12 has none), INSERT, TEXT; ellipses/splines/walls/
  dimensions/hatches exported as geometry (polylines, lines, text). Reader = R12 and R2000+ ASCII:
  LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE/VERTEX, ELLIPSE, SPLINE (control points + knots + weights,
  or fit points), XLINE/RAY, TEXT/MTEXT (plain text), INSERT + BLOCKS, layers + colours, $INSUNITS.
  DIMENSION and HATCH are imported via their anonymous blocks (plain geometry) or skipped with a count.
- **Desktop** (Tauri v2): dialog + fs plugins for Open/Save/Save As/Export; native menu bar built in
  Rust that forwards menu ids to the web UI (one handler table shared with the in-window menus);
  window title shows file name and •unsaved; close asks to save. In a plain browser the same commands
  use the File System Access API or download/upload.
- **Packaging**: `bun run tauri build` makes the Windows installers (WiX/NSIS are downloaded by Tauri on
  first build — ask the owner first). macOS builds must run on a Mac.

### Milestone 6+ (not planned yet)

See `ARCHITECTURE.md` §5.

## Known gaps / notes

Checked against Claris CAD 2.0v3 (release notes and the running program). Still open:

- An object's ruler is the layer's scale, not a scale stored on the object. Claris magnified each object by the ruler it was drawn with; TemariCAD keeps one model space so snaps and intersections work across layers, and the scale sizes the page and the annotations.
- Three or more walls meeting at one point are not mitred. Two-wall L, T and X joints clean themselves up, which is ahead of Claris's manual Clean Up command. The release notes' Open-T / overlapping-intersection clean-up (Command-click) is not a separate command.
- Splines still can't be trimmed, split or offset. Ellipse offset is unsupported. A fillet between two arcs is the minor arc.
- Tangent snap is circles and arcs only, not ellipses or splines.
- A tangential touch between two curves (a double root) can be missed by the Newton intersection path.
- No per-object lock, selection filter, line arrowheads, or in-place editing of a symbol. Groups are one level (grouping a group merges it).
- Hatch lines are not written to DXF. The native menu bar is the in-window one, on purpose.
