# TemariCad Complete User Guide

## Getting Started

### Workspace Overview
TemariCad is a precision 2D CAD program modeled on classic Macintosh drafting workstations, enhanced with modern float64 geometry, smart walls, associative dimensions, and full DXF/PDF/SVG support.

- **Menu Bar (top)**: `File`, `Edit`, `View`, `Arrange`, `Layout`, `Window`, and `Guide`.
- **Methods Bar**: Context-sensitive bar below the menu bar showing the active tool's **Methods** (how clicks construct the shape) and live parameters (wall thickness, corner radius, polygon sides, fillet radius, etc.).
- **Tools Palette (left)**: 2-column tool grid. Press and hold (or **right-click**) any tool with a corner triangle to pop out its Methods, or press the tool's letter key again to cycle Methods.
- **Modifiers Palette (top-right)**: Toggle point snaps (`END`, `MID`, `CEN`, `QUAD`, `INT`, `APP`, `PERP`, `TAN`, `ON`), `ALIGN` guides, `ANG` angle lock, and `GRID` snap, plus Grid spacing and Angle step fields.
- **Layers & Attributes Palettes**: Manage layers, per-layer print scales, pen weights, dash styles, colours, hatch fills, and line endings.
- **Coordinates HUD (bottom)**: Live `X`, `Y`, `ΔX`, `ΔY`, `Length`, `Angle`, snap badge, zoom percentage (`100%` = true paper size), and tool prompts.

### Navigating the Canvas
- **Zoom**: Mouse wheel or `Ctrl+Pinch` zooms centred on the cursor. Use `Ctrl++` / `Ctrl+-`, `F` (**Fit to Drawing**), `Shift+F` (**Fit Page**), `Alt+F` (**Zoom to Selection**), or `Alt+Left` (**Previous View**).
- **Pan**: Hold `Space` and drag, middle-mouse drag, or two-finger trackpad slide.

### Precision Input (Tab-to-Type)
While any drawing or editing tool is active:
1. Move the cursor in the direction you want, or start a line/wall/rect.
2. Press `Tab` to jump into the **Coordinates HUD** fields (`Length` when a base point is active, otherwise `X`).
3. Type any unit expression—such as `12'-4 3/8"`, `24 + 3/16`, `1.5m - 20cm`, or `45°`—and press `Enter` to place the exact point.
4. Press `Esc` in a HUD field to clear the typed override and return to the canvas.

> **Tip:** Hold `Shift` while drawing to temporarily lock to 45° increments without turning on `ANG`.

---

## Drawing Tools

Press a tool's letter key to select it; press the **same key again** to cycle through its Methods.

| Tool | Key | Methods & Usage |
| :--- | :--- | :--- |
| **Selection** | `V` | **Pick / Marquee** (drag Left→Right to select enclosed only; Right→Left for crossing), **Lasso**, **Polygon**. `Shift+Click` toggles selection. Drag any blue grip handle to reshape. Use **Filter** in the Methods bar to restrict `Select All` (`Ctrl+A`) to one entity kind. |
| **Single Line** | `L` | **Two-Point**, **Continuous** (press `C` to close loop, `Backspace` to undo last vertex, `Enter`/right-click to finish), **Polar** (length + angle). |
| **Double Line** | `D` | **Center**, **Left**, or **Right** justified parallel lines with custom **Width** and optional **End caps**. |
| **Rectangle** | `R` | **Corner-Corner**, **Center-Corner**, **3-Point Rotated**, **Rounded** (uses **Corner radius** in Methods bar). |
| **Circle** | `C` | **Center-Radius**, **2-Point Diameter**, **3-Point**, **Tangent-Tangent-Radius (TTR)** (pick two lines/arcs/circles + set radius). |
| **Arc** | `A` | **Center-Start-End**, **3-Point**, **Start-End-Radius**, **Tangent to Entity** (starts tangent to an existing curve). |
| **Ellipse** | `E` | **Bounding Box**, **Center + Axes** (rotated). |
| **Regular Polygon** | `G` | **Center-Vertex** (inscribed), **Center-Side** (circumscribed), **Edge Length**; 3–64 sides. |
| **Spline / Freehand** | `S` | **Control Points** (clamped B-spline), **Interpolated** (passes through every clicked point), **Freehand** (press-drag-release with automatic RDP smoothing). |
| **Graphic Guide** | `U` | Infinite construction lines (never printed/plotted): **Horizontal**, **Vertical**, **Angled**, **Through Two Points**, **Perpendicular**, **Parallel**. |

---

## Editing & Booleans

### Geometry Editing Tools
- **Trim (`T`)**: Hover over any segment between intersections to preview the cut piece in highlight, then click to remove it. Works on lines, arcs, circles, rectangles, polygons, polylines, ellipses, and splines.
- **Extend (`X`)**: Click near the end of a line, arc, or open polyline to extend it to the nearest crossing boundary.
- **Split (`K`)**: Click any point on an entity (with full snapping) to split it into two separate entities.
- **Offset (`O`)**: Pick an object and click the side to offset. Set **Distance** in the Methods bar (`0` = offset through the picked point).
- **Fillet (`I`)**: Click two lines, arcs, or circles to round their corner with **Radius** (`0` creates a sharp corner). Choose **Trim Both / First / None** in the Methods bar.
- **Chamfer (`H`)**: Bevel a corner using **Distance × Distance** or **Distance + Angle**.

### Boolean Operations (`Arrange` Menu)
Select two or more closed shapes (rectangles, circles, polygons, ellipses, or closed polylines) and choose:
- **Union**: Merges all selected shapes into their combined outer boundary.
- **Subtract (First − Rest)**: Cuts the second and subsequent selected shapes out of the **first** selected shape.
- **Intersect**: Keeps only the overlapping area shared by all selected shapes.

### Transform, Arrange & Organize
- **Duplicate (`Ctrl+D`)**, **Step and Repeat (`Ctrl+Alt+D`)**, **Polar Array (`Ctrl+Alt+P`)**: Create linear or circular pattern copies.
- **Rotate (`Ctrl+Alt+R`)**, **Scale (`Ctrl+Alt+S`)**, **Flip Horizontal (`Alt+H`)**, **Flip Vertical (`Alt+V`)**.
- **Align**: Align Left/Right/Top/Bottom (`Ctrl+Alt+Arrows`), Horizontal Centers (`Ctrl+Alt+H`), Vertical Centers (`Ctrl+Alt+J`).
- **Grouping & Locking**: `Group` (`Ctrl+G`), `Ungroup` (`Ctrl+Shift+G`), `Lock` (`Ctrl+Shift+K`), `Unlock` (`Ctrl+Alt+K`), `Bring to Front` (`Ctrl+Shift+]`), `Send to Back` (`Ctrl+Shift+[`).

---

## Walls & Symbols

### Smart Walls (`W`)
- Draw walls using **Center**, **Left face**, or **Right face** justification and set **Thickness** in the Methods bar.
- **Auto-Healing Junctions**: Walls automatically clean up **L corners**, **T joins**, **X crossings**, and **3+ wall mitres**.
- **Opening Method**: Switch the Wall tool to **Opening** to punch a clean framed opening into any wall.
- **Clean Up Tool (`B`)**:
  - **Open T**: Cleanly open a T-junction.
  - **Extend to Bar**: Extend stem walls to stop cleanly against a cross wall without mitring through.
  - **Break**: Break a crossing wall into an opening.

### Symbols & Openings (`Y`)
- **Built-in Starter Library**: Open `Window ▸ Symbols` (`Alt+4`) for architectural doors (single/double), windows, north arrow, and section mark.
- **Dropping Doors/Windows on Walls**: Placing a door or window symbol onto a wall automatically inserts a wall opening sized to the symbol. Click side sets the swing; nearer end sets the hinge.
- **Opening Grips**: Select a wall with openings to drag the **centre** (slide along wall), **jamb** (resize width), or **swing** grip. Press `Alt+Shift+S` to flip the door swing.
- **Custom Symbols**: Select objects and run `Arrange ▸ Make Symbol` (`Ctrl+Shift+Y`). Export/import `.tcsym` symbol libraries from the Symbols palette.
- **Edit Symbol in Place**: Double-click a symbol (or press `Alt+Shift+E`) to edit its geometry directly—every instance updates live in the same undo step. Press `Alt+Shift+E` again to exit.

---

## Dimensions, Text & Measure

### Associative Dimensions (`M`)
- **Methods**: **Horizontal**, **Vertical**, **Aligned**, **Chain**, **Baseline**, **Angular**, **Radius**, **Diameter**, and **Center Mark**.
- Dimensions attach to entity handles (`END`, `MID`, `CEN`, `QUAD`, vertices) and automatically update when you move, stretch, rotate, or trim the measured geometry.
- **Editing Dimensions**:
  - Drag the text grip to reposition the label.
  - Double-click a dimension (or press `Alt+Shift+T`) to enter or clear a custom **text override** while keeping associativity.
  - Press `Alt+Shift+F` to **flip** the dimension line/arrows to the opposite side.
- **Drafting Standards**: Switch between `ANSI Y14.5`, `ISO`, `DIN`, `JIS`, and `BS 308` under `Layout ▸ Standard`.

### Text & Leader Callouts (`Q`)
- **Click to Type**: Place single or multi-line text (use `\n` in text edits for multiple lines). Double-click any text entity to edit its contents; use the Methods bar for paper height, alignment, and rotation.
- **Leader Callout**: Switch the Text tool to **Leader Callout**, click the arrow tip, click one or more elbow/landing points, press `Enter` (or right-click), and type the callout label.

### Measure (`J`) & Get Info (`Ctrl+I`)
- **Measure (`J`)**:
  - **Distance / Path**: Click points with full snapping to measure total path length, direct distance, and segment angle.
  - **Area / Perimeter**: Click 3+ corners (or close the loop) to measure enclosed **Area** and **Perimeter** in current drawing units.
- **Get Info (`Ctrl+I`)**: Inspect and numerically edit coordinates, dimensions, and radii; closed shapes and multi-selections also display **Area** and **Perimeter**.

---

## Layers, Hatches & Styles

### Layers Palette (`Alt+2`)
- Toggle **Visible** (eye), **Locked** (padlock), **Color**, and **Scale** per layer (`1:1`, `1/4" = 1'-0"`, `1/8"`, `1"`, `1:20`, `1:50`, `1:100`, or custom).
- Double-click a layer name to rename it. Use **New**, **Delete**, **▲/▼** reorder, and **Move Selection Here**.
- *Note*: All layers share one millimeter model space so snaps and intersections work seamlessly across layers; each layer's **Scale** controls its annotation paper size and sheet scale.

### Attributes Palette (`Alt+3`)
- Sets **Pen Weight** (`0.13 mm` – `2.00 mm`), **Line Type** (Solid, Dashed, Dotted, Dash-Dot, Center, Hidden), **Colour**, **Fill Pattern**, and **Start/End Line Endings** (arrows, ticks, dots).
- When objects are selected, changing an attribute edits the selection in one undo step; when nothing is selected, it sets the defaults for new objects.

### Hatches & Boundary Hatch (`Z`)
- **13 Patterns**: Solid, Light/Dark Gray, ANSI31, Crosshatch, Steel, Brick, Concrete, Insulation, Wood, Earth, and Sand.
- **Boundary Hatch (`Z`)**: Click **inside any enclosed region** bounded by lines, arcs, walls, or shapes—TemariCad traces the minimal closed boundary and fills it with the active hatch pattern.

### Match Properties Eyedropper (`N`)
- Click a source object to copy its **Pen**, **Dash**, **Endings**, **Fill**, and/or **Layer** (filtered by the checkboxes in the Methods bar) onto the current selection or onto target objects you click.

---

## Files, DXF & Plotting

### Native `.tcad` Files & Auto-Recovery
- `File ▸ New` (`Ctrl+N`), `Open` (`Ctrl+O`), `Save` (`Ctrl+S`), `Save As` (`Ctrl+Shift+S`).
- Unsaved changes show a `•` in the title bar and trigger an automatic crash-recovery backup every 30 seconds.

### DXF Import & Export (`Ctrl+Shift+E`)
- **Export DXF**: Writes AutoCAD R12/2000-compatible ASCII DXF with layers, ACI colours, linetypes, blocks, bulges, line endings, `HATCH` entities, and real `DIMENSION` entities.
- **Open DXF**: Reads `LINE`, `CIRCLE`, `ARC`, `LWPOLYLINE`, `POLYLINE`, `ELLIPSE`, `SPLINE`, `XLINE`/`RAY`, `TEXT`/`MTEXT`, `INSERT`/`BLOCKS`, `HATCH`, and `DIMENSION`.

### Sheet Setup, Title Block & Plotting (`Ctrl+P`)
- **Rulers & Drawing Size (`Ctrl+Alt+R`)**: Configure paper size (Letter, Legal, Tabloid, ANSI C/D, A4–A1), orientation, multi-page sheet grid (`Pages across × up`), and ruler scale.
- **Title Block (`Alt+Shift+B`)**: Set **Title**, **Drawn by**, **Date**, **Scale**, and **Sheet no.**—rendered live on the sheet and in PDF plots.
- **Plot (`Ctrl+P`)**: Preview the sheet, choose plot scale or **Fit to one sheet**, toggle **Black and white** or **Pen widths by colour** (MacPlot-style), and export **Vector PDF** (with automatic multi-page tiling) or **True-size SVG**.
- **Export PNG (`Ctrl+Alt+E`)**: Save a crisp raster image of the drawing.

---

## Shortcuts & Pro Tips

### Essential Keys
- **Tool Letters**: `V` Select, `L` Line, `D` Double Line, `W` Wall, `B` Clean Up, `R` Rect, `C` Circle, `A` Arc, `E` Ellipse, `G` Polygon, `S` Spline, `U` Guide, `M` Dimension, `T` Trim, `X` Extend, `K` Split, `O` Offset, `I` Fillet, `H` Chamfer, `Y` Symbol, `Q` Text, `N` Match, `Z` Boundary Hatch, `J` Measure.
- **Drawing Control**: `Tab` type in HUD, `Shift` (hold) 45° lock, `Space` (hold) pan, `Enter` or Right-click finish, `Backspace` remove last vertex, `C` close continuous line/wall, `Esc` cancel / return to Select.
- **View & Window**: `F` Fit Drawing, `Shift+F` Fit Page, `Alt+F` Zoom Selection, `Alt+Left` Previous View, `Alt+G` Grid, `Alt+W` Line Weights, `Ctrl+/` Toggle Shortcut Bar, `Alt+1..4` Toggle Palettes.

### Pro Drafting Tips
1. **Press-and-drag OR click-click**: Every 2-point tool supports both classic Mac press-drag-release and click-move-click.
2. **Double-click to edit**: Double-click **Text** to edit words, **Dimensions** to override text, or **Symbols** to edit the definition in place.
3. **Crossing vs. Window Select**: Dragging Left→Right selects only objects **completely inside** the box; dragging Right→Left selects anything **crossed** by the box.
4. **Use Graphic Guides (`U`) + `Z` Boundary Hatch**: Lay out construction grids with Guides, draw walls/lines, then click inside rooms with `Z` to hatch floor areas in one click.
