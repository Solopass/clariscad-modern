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

### Milestone 2: workspace (next)

- [ ] Camera and adaptive grid
- [ ] Tools palette, Methods bar, Modifiers palette, Coordinates HUD (Tab-to-type)
- [ ] Creation tools with rubber band and snap badges
- [ ] Command stack (undo/redo)

### Milestones 3–5

See `ARCHITECTURE.md` §5.

## Known gaps / notes

- Tangent snap works on circles/arcs only (not ellipses or splines).
- Intersections that touch tangentially between two curves (double roots) may be missed by the Newton path.
- Walls are capped bands until the wall solver lands (M3).
