// Tool runtime: plain objects driven by snapped pointer events. Tools hold
// entity ids, never entity objects (objects go stale after undo), and talk to
// the document only through ToolContext, so they run headless in tests.
import type { CadDocument, Entity, Id } from "../kernel/types";
import type { EntityIndex } from "../kernel/spatialIndex";
import { type Prim, flattenPrim, primsOf, closestOnPrim } from "../kernel/prims";
import { intersectPrims } from "../kernel/intersections";
import { translateEntity } from "../kernel/edit";
import { simplifyPolyline } from "../kernel/simplify";
import { type Vec2, dist, sub } from "../kernel/vec";
import type { BBox } from "../kernel/types";
import { type Patch, addPatch, removePatch, replacePatch } from "../state/ops";
import type { ToolSettings } from "../state/useToolStore";
import type { MethodDef, Shape } from "./defs";

export interface ToolContext {
  doc(): CadDocument;
  index(): EntityIndex;
  commit(p: Patch): void;
  selection(): ReadonlySet<Id>;
  setSelection(ids: Iterable<Id>): void;
  settings(): ToolSettings;
  /** Pick radius in world units. */
  tolerance(): number;
  newId(): string;
}

export interface PointerInfo {
  /** Snapped world point. */
  p: Vec2;
  /** Raw world point under the cursor. */
  raw: Vec2;
  /** Screen position (CSS px). */
  screen: Vec2;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface Overlay {
  shapes: Shape[];
  /** Already-placed construction points. */
  points: Vec2[];
  marquee?: { a: Vec2; b: Vec2; crossing: boolean };
}

export interface Tool {
  prompt(): string;
  /** Previous point of the command (for PERP/TAN/angle lock and the HUD's Δ values). */
  from(): Vec2 | undefined;
  /** Entities snapping should ignore right now. */
  snapExclude(): ReadonlySet<Id> | undefined;
  /** True while a command is part-way through. */
  busy(): boolean;
  down(e: PointerInfo): void;
  move(e: PointerInfo): void;
  up(e: PointerInfo): void;
  dblclick(e: PointerInfo): void;
  /** Returns true if the key was used. */
  key(key: string, e: { shift: boolean; ctrl: boolean }): boolean;
  /** A point typed into the Coordinates HUD. */
  typed(p: Vec2): void;
  cancel(): void;
  overlay(cursor: PointerInfo | null): Overlay;
}

const DRAG_PX = 4;

// ---------------------------------------------------------------- drawing tools

export class DrawTool implements Tool {
  private pts: Vec2[] = [];
  private downScreen: Vec2 | null = null;
  private drawing = false;

  constructor(
    private method: MethodDef,
    private ctx: ToolContext,
  ) {}

  private buildCtx() {
    const index = this.ctx.index();
    const tol = this.ctx.tolerance();
    return {
      settings: this.ctx.settings(),
      primAt: (p: Vec2): Prim | null => {
        const hit = index.nearest(p, tol * 2)[0];
        if (!hit) return null;
        let best: Prim | null = null;
        let bd = Infinity;
        for (const prim of primsOf(hit.entity, index.ctx)) {
          const d = closestOnPrim(prim, p).distance;
          if (d < bd) {
            bd = d;
            best = prim;
          }
        }
        return best;
      },
    };
  }

  prompt() {
    const n = Math.min(this.pts.length, this.method.prompts.length - 1);
    return this.method.prompts[n] ?? "";
  }
  from() {
    return this.pts[this.pts.length - 1];
  }
  snapExclude() {
    return undefined;
  }
  busy() {
    return this.pts.length > 0;
  }

  private place(p: Vec2) {
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, p) <= 1e-12) return; // second click of a double-click
    this.pts.push(p);
    if (typeof this.method.points === "number" && this.pts.length >= this.method.points) this.complete(this.pts);
  }

  private complete(pts: Vec2[], closed = false) {
    let shape = this.method.build(pts, this.buildCtx());
    this.pts = [];
    if (!shape) return;
    if (closed && shape.kind === "polyline") shape = { ...shape, closed: true };
    if (closed && shape.kind === "spline") shape = { ...shape, closed: true };
    const s = this.ctx.settings();
    const doc = this.ctx.doc();
    const entity = {
      ...shape,
      id: this.ctx.newId(),
      layerId: doc.activeLayerId,
      ...(shape.kind === "guide" ? {} : { style: { penWeight: s.penWeight, dash: s.dash === "solid" ? undefined : s.dash } }),
    } as Entity;
    this.ctx.commit(addPatch(doc, `New ${shape.kind}`, [entity]));
  }

  private finish(closed = false) {
    const min = this.method.min ?? 2;
    if (this.method.points === "many" && this.pts.length >= min) this.complete(this.pts, closed);
    else this.pts = [];
  }

  down(e: PointerInfo) {
    if (this.method.freehand) {
      this.drawing = true;
      this.pts = [e.raw];
      return;
    }
    this.downScreen = e.screen;
    this.place(e.p);
  }

  move(e: PointerInfo) {
    if (this.method.freehand && this.drawing) {
      const last = this.pts[this.pts.length - 1];
      if (dist(last, e.raw) > this.ctx.tolerance() / 4) this.pts.push(e.raw);
    }
  }

  up(e: PointerInfo) {
    if (this.method.freehand) {
      if (!this.drawing) return;
      this.drawing = false;
      this.pts.push(e.raw);
      const pts = simplifyPolyline(this.pts, this.ctx.tolerance() / 4);
      this.pts = [];
      if (pts.length >= 2) this.complete(pts);
      return;
    }
    // Press-drag-release places the next point too (classic Mac drawing).
    if (this.downScreen && this.pts.length > 0 && dist(e.screen, this.downScreen) > DRAG_PX) this.place(e.p);
    this.downScreen = null;
  }

  dblclick() {
    if (this.method.points === "many") this.finish();
  }

  key(key: string) {
    if (key === "Escape") {
      if (!this.busy()) return false;
      this.cancel();
      return true;
    }
    if (key === "Enter") {
      this.finish();
      return true;
    }
    if (key === "Backspace" && this.pts.length) {
      this.pts.pop();
      return true;
    }
    if ((key === "c" || key === "C") && this.method.points === "many" && this.pts.length >= 3) {
      this.finish(true);
      return true;
    }
    return false;
  }

  typed(p: Vec2) {
    this.place(p);
  }

  cancel() {
    this.pts = [];
    this.drawing = false;
    this.downScreen = null;
  }

  overlay(cursor: PointerInfo | null): Overlay {
    const shapes: Shape[] = [];
    if (this.method.freehand) {
      if (this.pts.length >= 2) shapes.push({ kind: "polyline", points: this.pts, closed: false });
      return { shapes, points: [] };
    }
    const live = cursor ? [...this.pts, cursor.p] : this.pts;
    if (live.length && (this.pts.length > 0 || this.method.points === 1)) {
      const s = this.method.build(live, this.buildCtx());
      if (s) shapes.push(s);
    }
    return { shapes, points: this.pts };
  }
}

// ---------------------------------------------------------------- selection

/** Does an entity's geometry touch the box (crossing selection)? */
export function entityTouchesBox(e: Entity, box: BBox, index: EntityIndex): boolean {
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  const edges: Prim[] = corners.map((a, i) => ({ t: "seg", a, b: corners[(i + 1) % 4] }));
  const inside = (p: Vec2) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  for (const prim of primsOf(e, index.ctx)) {
    if (prim.t !== "xline" && inside(flattenPrim(prim).pts[0])) return true;
    for (const edge of edges) if (intersectPrims(prim, edge).length) return true;
  }
  return false;
}

export class SelectTool implements Tool {
  private mode: "idle" | "pending" | "move" | "marquee" = "idle";
  private base: Vec2 = { x: 0, y: 0 };
  private delta: Vec2 = { x: 0, y: 0 };
  private downScreen: Vec2 = { x: 0, y: 0 };
  private a: Vec2 = { x: 0, y: 0 };
  private b: Vec2 = { x: 0, y: 0 };
  private additive = false;

  constructor(private ctx: ToolContext) {}

  prompt() {
    if (this.mode === "move") return "Drag to move; release to drop";
    if (this.mode === "marquee") return this.b.x < this.a.x ? "Crossing: selects anything the box touches" : "Inside: selects what the box fully encloses";
    return "Click to select (Shift adds), drag a box, or drag a selection to move it";
  }
  from() {
    return this.mode === "move" ? this.base : undefined;
  }
  snapExclude() {
    return this.mode === "move" || this.mode === "pending" ? this.ctx.selection() : undefined;
  }
  busy() {
    return this.mode !== "idle";
  }

  private hit(p: Vec2): Id | null {
    const index = this.ctx.index();
    const doc = this.ctx.doc();
    const layers = new Map(doc.layers.map((l) => [l.id, l]));
    const hits = index.nearest(p, this.ctx.tolerance(), (e) => {
      const l = layers.get(e.layerId);
      return !l || (l.visible && !l.locked);
    });
    return hits[0]?.entity.id ?? null;
  }

  down(e: PointerInfo) {
    this.downScreen = e.screen;
    const id = this.hit(e.raw);
    const sel = new Set(this.ctx.selection());
    if (id) {
      if (e.shift) {
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
        this.ctx.setSelection(sel);
      } else if (!sel.has(id)) this.ctx.setSelection([id]);
      this.mode = this.ctx.selection().has(id) ? "pending" : "idle";
      this.base = e.p;
      this.delta = { x: 0, y: 0 };
    } else {
      this.additive = e.shift;
      if (!e.shift) this.ctx.setSelection([]);
      this.mode = "marquee";
      this.a = this.b = e.raw;
    }
  }

  move(e: PointerInfo) {
    if (this.mode === "pending" && dist(e.screen, this.downScreen) > DRAG_PX) this.mode = "move";
    if (this.mode === "move") this.delta = sub(e.p, this.base);
    if (this.mode === "marquee") this.b = e.raw;
  }

  up(e: PointerInfo) {
    if (this.mode === "move") {
      this.delta = sub(e.p, this.base);
      this.commitMove(this.delta, "Move");
    } else if (this.mode === "marquee" && dist(e.screen, this.downScreen) > DRAG_PX) {
      this.b = e.raw;
      const box: BBox = {
        minX: Math.min(this.a.x, this.b.x),
        minY: Math.min(this.a.y, this.b.y),
        maxX: Math.max(this.a.x, this.b.x),
        maxY: Math.max(this.a.y, this.b.y),
      };
      const crossing = this.b.x < this.a.x;
      const index = this.ctx.index();
      const layers = new Map(this.ctx.doc().layers.map((l) => [l.id, l]));
      const ok = (id: Id) => {
        const ent = index.get(id);
        const l = ent && layers.get(ent.layerId);
        return !!ent && (!l || (l.visible && !l.locked));
      };
      const ids = crossing
        ? index.spatial.search(box).filter((id) => ok(id) && entityTouchesBox(index.get(id)!, box, index))
        : index.spatial.searchInside(box).filter(ok);
      const sel = new Set(this.additive ? this.ctx.selection() : []);
      for (const id of ids) sel.add(id);
      this.ctx.setSelection(sel);
    }
    this.mode = "idle";
  }

  private commitMove(d: Vec2, label: string) {
    if (d.x === 0 && d.y === 0) return;
    const index = this.ctx.index();
    const pairs: [Entity, Entity][] = [];
    for (const id of this.ctx.selection()) {
      const ent = index.get(id);
      if (ent) pairs.push([ent, translateEntity(ent, d)]);
    }
    this.ctx.commit(replacePatch(label, pairs));
  }

  dblclick() {}

  key(key: string, e: { shift: boolean; ctrl: boolean }) {
    if (key === "Escape") {
      if (this.mode !== "idle") {
        this.cancel();
        return true;
      }
      if (this.ctx.selection().size) {
        this.ctx.setSelection([]);
        return true;
      }
      return false;
    }
    if ((key === "Delete" || key === "Backspace") && this.ctx.selection().size) {
      this.ctx.commit(removePatch(this.ctx.doc(), "Delete", this.ctx.selection()));
      this.ctx.setSelection([]);
      return true;
    }
    const arrows: Record<string, Vec2> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 } };
    if (arrows[key] && this.ctx.selection().size) {
      const step = this.ctx.settings().gridSpacing * (e.shift ? 10 : 1);
      this.commitMove({ x: arrows[key].x * step, y: arrows[key].y * step }, "Nudge");
      return true;
    }
    return false;
  }

  typed() {}

  cancel() {
    this.mode = "idle";
  }

  overlay(): Overlay {
    if (this.mode === "marquee") return { shapes: [], points: [], marquee: { a: this.a, b: this.b, crossing: this.b.x < this.a.x } };
    if (this.mode === "move") {
      const index = this.ctx.index();
      const shapes: Shape[] = [];
      for (const id of this.ctx.selection()) {
        const ent = index.get(id);
        if (ent) {
          const { id: _id, layerId: _l, ...shape } = translateEntity(ent, this.delta);
          shapes.push(shape as Shape);
        }
      }
      return { shapes, points: [] };
    }
    return { shapes: [], points: [] };
  }
}
