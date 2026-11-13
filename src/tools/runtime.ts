// Tool runtime: plain objects driven by snapped pointer events. Tools hold
// entity ids, never entity objects (objects go stale after undo), and talk to
// the document only through ToolContext, so they run headless in tests.
import type { BBox, CadDocument, Entity, Id } from "../kernel/types";
import type { EntityIndex } from "../kernel/spatialIndex";
import { type Prim, flattenPrim, primsOf, closestOnPrim } from "../kernel/prims";
import { intersectPrims } from "../kernel/intersections";
import { translateEntity } from "../kernel/edit";
import { translation } from "../kernel/transform";
import { type GripCtx, gripsOf, moveHandle } from "../kernel/handles";
import { simplifyPolyline } from "../kernel/simplify";
import { type Vec2, dist, sub } from "../kernel/vec";
import { expandSelection } from "../state/groups";
import { canSelect } from "../state/selection";
import { type Patch, addPatch, removePatch, replacePatch } from "../state/ops";
import type { ToolSettings } from "../state/useToolStore";
import type { BuildCtx, MethodDef, Shape } from "./defs";

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
  /** Ask the user for a line of text (null = cancelled). */
  ask?(question: string, initial: string): string | null;
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
  /** Entities the snap came from (for associative dimensions). */
  ids?: Id[];
}

export interface Overlay {
  shapes: Shape[];
  /** Shapes to emphasise (the piece Trim would remove, the wall under Opening, ...). */
  highlight: Shape[];
  /** Already-placed construction points. */
  points: Vec2[];
  marquee?: { a: Vec2; b: Vec2; crossing: boolean };
  /** Lasso / polygon selection outline. */
  outline?: Vec2[];
}

export interface Tool {
  prompt(): string;
  /** Previous point of the command (for PERP/TAN/angle lock and the HUD's Δ values). */
  from(): Vec2 | undefined;
  /** Entities snapping should ignore right now. */
  snapExclude(): ReadonlySet<Id> | undefined;
  /** True while a command is part-way through. */
  busy(): boolean;
  /** Does the next click want the snapped point (false = picking an entity with the raw cursor)? */
  wantsSnap(): boolean;
  down(e: PointerInfo): void;
  move(e: PointerInfo): void;
  up(e: PointerInfo): void;
  dblclick(e?: PointerInfo): void;
  /** Returns true if the key was used. */
  key(key: string, e?: { shift: boolean; ctrl: boolean }): boolean;
  /** A point typed into the Coordinates HUD. */
  typed(p: Vec2): void;
  cancel(): void;
  overlay(cursor: PointerInfo | null): Overlay;
}

const DRAG_PX = 4;

/** Kinds that can take a fill pattern. */
const FILLABLE = new Set(["rect", "circle", "ellipse", "polygon", "wall"]);

/** Style for a new entity from the current attribute defaults (only the fields that differ from plain). */
function newStyle(s: ToolSettings, kind: string): Entity["style"] {
  const st: NonNullable<Entity["style"]> = { penWeight: s.penWeight };
  if (s.dash && s.dash !== "solid") st.dash = s.dash;
  if (s.color) st.color = s.color;
  if (s.fill && FILLABLE.has(kind)) st.fill = s.fill;
  if (s.startEnding) st.startEnding = s.startEnding;
  if (s.endEnding) st.endEnding = s.endEnding;
  return st;
}
const empty = (): Overlay => ({ shapes: [], highlight: [], points: [] });

function layerOk(doc: CadDocument, allowLocked = false) {
  return (e: Entity) => canSelect(doc, e, { allowLocked });
}

// ---------------------------------------------------------------- drawing & editing tools

export class DrawTool implements Tool {
  private pts: Vec2[] = [];
  private ids: (Id[] | undefined)[] = [];
  private downScreen: Vec2 | null = null;
  private drawing = false;

  constructor(
    private method: MethodDef,
    private ctx: ToolContext,
  ) {}

  buildCtx(pickIds = this.ids): BuildCtx {
    const index = this.ctx.index();
    const tol = this.ctx.tolerance();
    const ok = layerOk(this.ctx.doc());
    const entityAt = (p: Vec2) => index.nearest(p, tol, ok)[0]?.entity ?? null;
    return {
      settings: this.ctx.settings(),
      pickIds,
      doc: () => this.ctx.doc(),
      index: () => this.ctx.index(),
      newId: () => this.ctx.newId(),
      ask: (q, init) => (this.ctx.ask ? this.ctx.ask(q, init) : null),
      tolerance: tol,
      entityAt,
      primAt: (p: Vec2): Prim | null => {
        const hit = index.nearest(p, tol * 2, ok)[0];
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

  private isPick(i: number) {
    return !!this.method.rawPicks?.includes(i);
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
    return this.pts.length > 0 || this.drawing;
  }
  wantsSnap() {
    return !this.isPick(this.pts.length);
  }

  private place(e: { p: Vec2; raw: Vec2; ids?: Id[]; screen?: Vec2 }) {
    const i = this.pts.length;
    const p = this.isPick(i) ? e.raw : e.p;
    // An entity pick must land on something.
    if (this.isPick(i) && !this.buildCtx().entityAt(p)) return;
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, p) <= 1e-9) return;
    if (this.method.closes && this.pts.length >= (this.method.min ?? 3) && dist(p, this.pts[0]) <= this.ctx.tolerance()) {
      this.complete(this.pts, true);
      return;
    }
    this.pts.push(p);
    this.ids.push(e.ids);
    if (typeof this.method.points === "number" && this.pts.length >= this.method.points) this.complete(this.pts);
  }

  private complete(pts: Vec2[], closed = false) {
    const ids = this.ids;
    this.pts = [];
    this.ids = [];
    const bctx = this.buildCtx(ids);
    if (this.method.edit) {
      const patch = this.method.edit(pts, bctx);
      if (patch && patch.ops.length) this.ctx.commit(patch);
      return;
    }
    const built = this.method.build?.(closed ? [...pts, pts[0]] : pts, bctx);
    if (!built) return;
    let shapes = Array.isArray(built) ? built : [built];
    if (closed) {
      // Closing a continuous line/curve: polylines and splines close themselves; a polygon is already closed.
      const base = this.method.build?.(pts, bctx);
      const single = base && !Array.isArray(base) ? base : null;
      if (single && (single.kind === "polyline" || single.kind === "spline")) shapes = [{ ...single, closed: true }];
      else if (single && single.kind === "polygon") shapes = [single];
    }
    const s = this.ctx.settings();
    const doc = this.ctx.doc();
    const entities = shapes.map(
      (shape) =>
        ({
          ...shape,
          id: this.ctx.newId(),
          layerId: doc.activeLayerId,
          ...(shape.kind === "guide" || shape.kind === "dimension" || shape.kind === "symbol" ? {} : { style: newStyle(s, shape.kind) }),
        }) as Entity,
    );
    this.ctx.commit(addPatch(doc, `New ${shapes[0].kind}`, entities));
  }

  private finish(closed = false) {
    const min = this.method.min ?? 2;
    if (this.method.points === "many" && this.pts.length >= min) this.complete(this.pts, closed);
    else {
      this.pts = [];
      this.ids = [];
    }
  }

  down(e: PointerInfo) {
    if (this.method.freehand) {
      this.drawing = true;
      this.pts = [e.raw];
      return;
    }
    this.downScreen = e.screen;
    this.place(e);
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
    if (this.downScreen && this.pts.length > 0 && dist(e.screen, this.downScreen) > DRAG_PX && !this.isPick(this.pts.length)) this.place(e);
    this.downScreen = null;
  }

  dblclick() {
    if (this.method.points !== "many") return;
    // A double-click's second press can land a hair off the vertex just placed. Drop that extra point.
    const n = this.pts.length;
    if (n >= 2 && dist(this.pts[n - 1], this.pts[n - 2]) <= this.ctx.tolerance()) {
      this.pts.pop();
      this.ids.pop();
    }
    this.finish();
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
      this.ids.pop();
      return true;
    }
    if ((key === "c" || key === "C") && this.method.points === "many" && this.pts.length >= 3) {
      this.finish(true);
      return true;
    }
    return false;
  }

  typed(p: Vec2) {
    this.place({ p, raw: p });
  }

  cancel() {
    this.pts = [];
    this.ids = [];
    this.drawing = false;
    this.downScreen = null;
  }

  overlay(cursor: PointerInfo | null): Overlay {
    const out = empty();
    if (this.method.freehand) {
      if (this.pts.length >= 2) out.shapes.push({ kind: "polyline", points: this.pts, closed: false });
      return out;
    }
    out.points = this.pts;
    const i = this.pts.length;
    const cur = cursor ? (this.isPick(i) ? cursor.raw : cursor.p) : null;
    const live = cur ? [...this.pts, cur] : this.pts;
    const ids = cursor ? [...this.ids, cursor.ids] : this.ids;
    if (!live.length) return out;
    const bctx = this.buildCtx(ids);
    if (this.method.preview) {
      const pv = this.method.preview(live, bctx);
      out.shapes.push(...(pv.shapes ?? []));
      out.highlight.push(...(pv.highlight ?? []));
      return out;
    }
    if (this.method.build && (this.pts.length > 0 || this.method.points === 1)) {
      const s = this.method.build(live, bctx);
      if (s) out.shapes.push(...(Array.isArray(s) ? s : [s]));
    }
    return out;
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

/** Point-in-polygon (even-odd). */
export function inPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Entities wholly inside a polygon (sampled along their geometry). */
export function entitiesInPolygon(poly: Vec2[], index: EntityIndex, ok: (e: Entity) => boolean): Id[] {
  if (poly.length < 3) return [];
  const box: BBox = {
    minX: Math.min(...poly.map((p) => p.x)),
    minY: Math.min(...poly.map((p) => p.y)),
    maxX: Math.max(...poly.map((p) => p.x)),
    maxY: Math.max(...poly.map((p) => p.y)),
  };
  return index.spatial.searchInside(box).filter((id) => {
    const e = index.get(id);
    if (!e || !ok(e)) return false;
    return primsOf(e, index.ctx).every((prim) => prim.t !== "xline" && flattenPrim(prim, 1e-3).pts.every((q) => inPolygon(q, poly)));
  });
}

export class SelectTool implements Tool {
  private mode: "idle" | "pending" | "move" | "marquee" | "grip" | "lasso" | "polygon" = "idle";
  private base: Vec2 = { x: 0, y: 0 };
  private delta: Vec2 = { x: 0, y: 0 };
  private downScreen: Vec2 = { x: 0, y: 0 };
  private a: Vec2 = { x: 0, y: 0 };
  private b: Vec2 = { x: 0, y: 0 };
  private additive = false;
  private grip: { id: Id; handle: string; p: Vec2 } | null = null;
  private gripTarget: Vec2 | null = null;
  private path: Vec2[] = [];
  private cursor: Vec2 | null = null;

  constructor(
    private ctx: ToolContext,
    private method: "pick" | "lasso" | "polygon" = "pick",
  ) {}

  prompt() {
    if (this.mode === "move") return "Drag to move; release to drop";
    if (this.mode === "grip") return "Drag the handle; snaps apply";
    if (this.mode === "marquee") return this.b.x < this.a.x ? "Crossing: selects anything the box touches" : "Inside: selects what the box fully encloses";
    if (this.method === "lasso") return "Drag a loop around what to select (Shift adds)";
    if (this.method === "polygon") return this.path.length ? "Next corner; Enter or double-click selects what is inside" : "Click the corners of an area";
    return this.note || "Click to select (Shift adds), drag a box, drag a selection to move it, or drag a handle to reshape. Alt-click selects a locked object";
  }
  from() {
    if (this.mode === "move") return this.base;
    if (this.mode === "grip") return this.grip?.p;
    return undefined;
  }
  snapExclude() {
    if (this.mode === "grip" && this.grip) return new Set([this.grip.id]);
    return this.mode === "move" || this.mode === "pending" ? this.ctx.selection() : undefined;
  }
  busy() {
    return this.mode !== "idle";
  }
  wantsSnap() {
    return this.mode === "move" || this.mode === "pending" || this.mode === "grip";
  }

  private note = "";

  private ok(alt = false) {
    const filter = this.ctx.settings().selectFilter;
    return (e: Entity) => canSelect(this.ctx.doc(), e, { allowLocked: alt, filter });
  }

  /** Drop members the current filter or lock state will not take. */
  private keep(ids: Id[], alt = false): Id[] {
    const ok = this.ok(alt);
    return ids.filter((id) => {
      const ent = this.ctx.doc().entities.find((x) => x.id === id);
      return !!ent && ok(ent);
    });
  }

  private hit(p: Vec2, alt = false): Id | null {
    return this.ctx.index().nearest(p, this.ctx.tolerance(), this.ok(alt))[0]?.entity.id ?? null;
  }

  private gripCtx(e: Entity): GripCtx {
    const doc = this.ctx.doc();
    return { scale: doc.layers.find((l) => l.id === e.layerId)?.scale ?? 1, units: doc.units, standard: doc.standard };
  }

  /** A handle of a selected entity under the cursor. */
  private handleHit(p: Vec2): { id: Id; handle: string; p: Vec2 } | null {
    const index = this.ctx.index();
    const tol = this.ctx.tolerance();
    let best: { id: Id; handle: string; p: Vec2; d: number } | null = null;
    for (const id of this.ctx.selection()) {
      const e = index.get(id);
      if (!e || !this.ok()(e)) continue;
      for (const h of gripsOf(e, this.gripCtx(e))) {
        const d = dist(h.p, p);
        if (d <= tol && (!best || d < best.d)) best = { id, handle: h.name, p: h.p, d };
      }
    }
    return best;
  }

  down(e: PointerInfo) {
    this.downScreen = e.screen;
    if (this.method === "polygon") {
      if (!this.path.length) {
        this.additive = e.shift;
        if (!e.shift) this.ctx.setSelection([]);
      }
      this.mode = "polygon";
      const last = this.path[this.path.length - 1];
      if (!last || dist(last, e.raw) > 1e-12) this.path.push(e.raw);
      return;
    }
    const visible = (ent: Entity) => {
      const l = this.ctx.doc().layers.find((x) => x.id === ent.layerId);
      return !l || (l.visible && !l.locked);
    };
    const top = this.ctx.index().nearest(e.raw, this.ctx.tolerance(), visible)[0]?.entity;
    const filter = this.ctx.settings().selectFilter;
    if (top?.locked && !e.alt && (!filter || filter === "all" || top.kind === filter)) {
      this.note = "Locked — Alt-click to select it";
      this.mode = "idle";
      return;
    }
    this.note = "";
    const id = this.hit(e.raw, e.alt);
    const members = id ? this.keep(expandSelection(this.ctx.doc(), [id], "click"), e.alt) : [];
    // A group is one object: reshape it after Ungroup.
    const grouped = members.length > 1;
    const grip = e.shift || grouped ? null : this.handleHit(e.raw);
    if (grip) {
      this.mode = "grip";
      this.grip = grip;
      this.gripTarget = null;
      return;
    }
    if (id) {
      if (e.shift) {
        const sel = new Set(this.ctx.selection());
        const allIn = members.every((m) => sel.has(m));
        for (const m of members) {
          if (allIn) sel.delete(m);
          else sel.add(m);
        }
        this.ctx.setSelection(sel);
      } else if (!members.every((m) => this.ctx.selection().has(m))) this.ctx.setSelection(members);
      this.mode = members.some((m) => this.ctx.selection().has(m)) ? "pending" : "idle";
      this.base = e.p;
      this.delta = { x: 0, y: 0 };
    } else {
      this.additive = e.shift;
      if (!e.shift) this.ctx.setSelection([]);
      if (this.method === "lasso") {
        this.mode = "lasso";
        this.path = [e.raw];
      } else {
        this.mode = "marquee";
        this.a = this.b = e.raw;
      }
    }
  }

  move(e: PointerInfo) {
    this.cursor = e.raw;
    if (this.mode === "pending" && dist(e.screen, this.downScreen) > DRAG_PX) this.mode = "move";
    if (this.mode === "move") this.delta = sub(e.p, this.base);
    if (this.mode === "grip") this.gripTarget = e.p;
    if (this.mode === "marquee") this.b = e.raw;
    if (this.mode === "lasso" && dist(this.path[this.path.length - 1], e.raw) > this.ctx.tolerance() / 4) this.path.push(e.raw);
  }

  up(e: PointerInfo) {
    if (this.mode === "polygon") return;
    if (this.mode === "grip" && this.grip) {
      if (dist(e.screen, this.downScreen) > DRAG_PX) {
        const ent = this.ctx.index().get(this.grip.id);
        if (ent) {
          const after = moveHandle(ent, this.grip.handle, e.p, this.gripCtx(ent));
          if (after !== ent) this.ctx.commit(replacePatch("Reshape", [[ent, after]], { grip: { handle: this.grip.handle, to: e.p } }));
        }
      }
      this.grip = null;
    } else if (this.mode === "move") {
      this.delta = sub(e.p, this.base);
      this.commitMove(this.delta, "Move");
    } else if (this.mode === "lasso") {
      this.path.push(e.raw);
      this.finishArea();
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
      const ok = this.ok();
      const usable = (id: Id) => {
        const ent = index.get(id);
        return !!ent && ok(ent);
      };
      const rawIds = crossing
        ? index.spatial.search(box).filter((id) => usable(id) && entityTouchesBox(index.get(id)!, box, index))
        : index.spatial.searchInside(box).filter(usable);
      const ids = this.keep(expandSelection(this.ctx.doc(), rawIds, crossing ? "crossing" : "inside"));
      const sel = new Set(this.additive ? this.ctx.selection() : []);
      for (const id of ids) sel.add(id);
      this.ctx.setSelection(sel);
    }
    this.mode = "idle";
  }

  private finishArea() {
    const ids = this.keep(expandSelection(this.ctx.doc(), entitiesInPolygon(this.path, this.ctx.index(), this.ok()), "inside"));
    const sel = new Set(this.additive ? this.ctx.selection() : []);
    for (const id of ids) sel.add(id);
    this.ctx.setSelection(sel);
    this.path = [];
    this.mode = "idle";
  }

  private commitMove(d: Vec2, label: string) {
    if (d.x === 0 && d.y === 0) return;
    const index = this.ctx.index();
    const pairs: [Entity, Entity][] = [];
    const ok = this.ok();
    for (const id of this.ctx.selection()) {
      const ent = index.get(id);
      if (ent && ok(ent)) pairs.push([ent, translateEntity(ent, d)]);
    }
    this.ctx.commit(replacePatch(label, pairs, { transform: translation(d.x, d.y) }));
  }

  dblclick() {
    if (this.mode === "polygon") this.finishArea();
  }

  key(key: string, e: { shift: boolean; ctrl: boolean } = { shift: false, ctrl: false }) {
    if (key === "Enter" && this.mode === "polygon") {
      this.finishArea();
      return true;
    }
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
    this.grip = null;
    this.path = [];
  }

  overlay(): Overlay {
    const out = empty();
    if (this.mode === "marquee") out.marquee = { a: this.a, b: this.b, crossing: this.b.x < this.a.x };
    if (this.mode === "lasso") out.outline = this.path;
    if (this.mode === "polygon") out.outline = this.cursor ? [...this.path, this.cursor] : this.path;
    const index = this.ctx.index();
    if (this.mode === "move") {
      for (const id of this.ctx.selection()) {
        const ent = index.get(id);
        if (ent) out.shapes.push(stripId(translateEntity(ent, this.delta)));
      }
    }
    if (this.mode === "grip" && this.grip && this.gripTarget) {
      const ent = index.get(this.grip.id);
      if (ent) out.shapes.push(stripId(moveHandle(ent, this.grip.handle, this.gripTarget, this.gripCtx(ent))));
    }
    return out;
  }
}

function stripId(e: Entity): Shape {
  const { id: _id, layerId: _l, ...shape } = e;
  return shape as Shape;
}
