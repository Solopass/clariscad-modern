// Modifiers: where a click lands. Point snaps (END, MID, CEN, QUAD, INT, ...)
// are gathered from entities near the cursor and ranked by priority, then
// distance. If none is in range, constraints apply (direction lock, angle
// lock, grid), and otherwise the raw cursor point is used.
import type { Entity, Id } from "./types";
import { type Prim, closestOnPrim, primEnds, primPoint, primsOf } from "./prims";
import { intersectPrims } from "./intersections";
import type { EntityIndex } from "./spatialIndex";
import {
  type Vec2,
  TAU,
  add,
  angleInSweep,
  angleOf,
  dist,
  dot,
  fromAngle,
  mid,
  normalize,
  scale,
  sub,
} from "./vec";

export type SnapKind =
  | "endpoint"
  | "midpoint"
  | "center"
  | "quadrant"
  | "insertion"
  | "intersection"
  | "apparent"
  | "perpendicular"
  | "tangent"
  | "alignment"
  | "nearest"
  | "parallel"
  | "angle"
  | "grid";

export const SNAP_LABEL: Record<SnapKind | "none", string> = {
  endpoint: "END",
  midpoint: "MID",
  center: "CEN",
  quadrant: "QUAD",
  insertion: "INS",
  intersection: "INT",
  apparent: "APP",
  perpendicular: "PERP",
  tangent: "TAN",
  alignment: "ALIGN",
  nearest: "ON",
  parallel: "PAR",
  angle: "ANG",
  grid: "GRID",
  none: "",
};

/** Lower wins. Point snaps only; constraints are applied afterwards. */
const PRIORITY: Partial<Record<SnapKind, number>> = {
  endpoint: 0,
  intersection: 0,
  center: 1,
  midpoint: 1,
  insertion: 1,
  quadrant: 2,
  perpendicular: 3,
  tangent: 3,
  apparent: 4,
  alignment: 5,
  nearest: 6,
};

export type Modifiers = Partial<Record<SnapKind, boolean>>;

export interface SnapSettings {
  modifiers: Modifiers;
  /** Pick radius in world units (screen pixels ÷ zoom). */
  tolerance: number;
  grid?: { spacing: number; origin?: Vec2 };
  /** Angle-lock increment in radians (e.g. 15° = π/12). */
  angleStep?: number;
}

export interface SnapContext {
  /** Previous point of the command in progress (enables PERP, TAN, angle lock, parallel). */
  from?: Vec2;
  /** Recently hovered reference points for alignment guides. */
  anchors?: Vec2[];
  /** Locked direction for the parallel constraint. */
  direction?: Vec2;
  /** Entities to ignore (e.g. the one being edited). */
  exclude?: Set<Id>;
  /** Entity filter (hidden/locked layers, etc.). */
  filter?: (e: Entity) => boolean;
  /** Search radius for apparent intersections (default 40 × tolerance). */
  apparentRange?: number;
}

export interface SnapGuide {
  a: Vec2;
  b: Vec2;
}

export interface SnapResult {
  point: Vec2;
  kind: SnapKind | "none";
  label: string;
  entityIds: Id[];
  /** Dotted guide lines to draw (alignment/angle/parallel). */
  guides: SnapGuide[];
}

interface Candidate {
  point: Vec2;
  kind: SnapKind;
  ids: Id[];
  guides?: SnapGuide[];
}

interface EntityPrims {
  entity: Entity;
  prims: Prim[];
}

const isFull = (sweep: number) => sweep >= TAU - 1e-12;

/** Point-snap candidates that belong to a single primitive. */
function primCandidates(p: Prim, id: Id, m: Modifiers, ctx: SnapContext, out: Candidate[]): void {
  if (m.endpoint) for (const e of primEnds(p)) out.push({ point: e, kind: "endpoint", ids: [id] });
  if (m.midpoint) {
    if (p.t === "seg") out.push({ point: mid(p.a, p.b), kind: "midpoint", ids: [id] });
    else if ((p.t === "arc" || p.t === "ell") && !isFull(p.sweep))
      out.push({ point: primPoint(p, p.start + p.sweep / 2), kind: "midpoint", ids: [id] });
  }
  if (m.center && (p.t === "arc" || p.t === "ell")) out.push({ point: p.c, kind: "center", ids: [id] });
  if (m.quadrant && (p.t === "arc" || p.t === "ell")) {
    // Circle quadrants are the world-axis directions; for an ellipse they are its axis ends
    // (parameter angles 0, π/2, π, 3π/2), which rotate with it.
    for (let k = 0; k < 4; k++) {
      const u = (k * Math.PI) / 2;
      if (angleInSweep(u, p.start, p.sweep)) out.push({ point: primPoint(p, u), kind: "quadrant", ids: [id] });
    }
  }
  const from = ctx.from;
  if (from && m.perpendicular) {
    if (p.t === "seg" || p.t === "xline") {
      const o = p.t === "seg" ? p.a : p.p;
      const d = p.t === "seg" ? sub(p.b, p.a) : p.d;
      const l2 = dot(d, d);
      if (l2 > 0) {
        const t = dot(sub(from, o), d) / l2;
        if (p.t === "xline" || (t >= -1e-12 && t <= 1 + 1e-12)) out.push({ point: add(o, scale(d, t)), kind: "perpendicular", ids: [id] });
      }
    } else if (p.t === "arc") {
      const v = sub(from, p.c);
      if (v.x !== 0 || v.y !== 0) {
        const th = angleOf(v);
        for (const a of [th, th + Math.PI])
          if (angleInSweep(a, p.start, p.sweep)) out.push({ point: add(p.c, fromAngle(a, p.r)), kind: "perpendicular", ids: [id] });
      }
    }
  }
  if (from && m.tangent && p.t === "arc") {
    const d = dist(from, p.c);
    if (d > p.r) {
      const th = angleOf(sub(from, p.c));
      const al = Math.acos(p.r / d);
      for (const a of [th + al, th - al])
        if (angleInSweep(a, p.start, p.sweep)) out.push({ point: add(p.c, fromAngle(a, p.r)), kind: "tangent", ids: [id] });
    }
  }
}

function entityCandidates(e: Entity, m: Modifiers, out: Candidate[]): void {
  if (m.center) {
    if (e.kind === "rect") out.push({ point: e.center, kind: "center", ids: [e.id] });
    else if (e.kind === "polygon") {
      // Vertex average: exact centre for regular polygons, a reasonable one otherwise.
      const c = scale(e.points.reduce(add, { x: 0, y: 0 }), 1 / Math.max(1, e.points.length));
      out.push({ point: c, kind: "center", ids: [e.id] });
    }
  }
  if (m.insertion && (e.kind === "symbol" || e.kind === "text")) out.push({ point: e.position, kind: "insertion", ids: [e.id] });
}

export function gridPoint(p: Vec2, spacing: number, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  return {
    x: origin.x + Math.round((p.x - origin.x) / spacing) * spacing,
    y: origin.y + Math.round((p.y - origin.y) / spacing) * spacing,
  };
}

/** Project `p` onto the ray from `from` at the nearest multiple of `step`. */
export function angleLock(from: Vec2, p: Vec2, step: number): { point: Vec2; angle: number } {
  const ang = Math.round(angleOf(sub(p, from)) / step) * step;
  const d = fromAngle(ang);
  const t = Math.max(0, dot(sub(p, from), d));
  return { point: add(from, scale(d, t)), angle: ang };
}

function better(a: Candidate, b: Candidate, cursor: Vec2): boolean {
  const pa = PRIORITY[a.kind] ?? 9;
  const pb = PRIORITY[b.kind] ?? 9;
  if (pa !== pb) return pa < pb;
  return dist(a.point, cursor) < dist(b.point, cursor);
}

export function snap(cursor: Vec2, index: EntityIndex, settings: SnapSettings, ctx: SnapContext = {}): SnapResult {
  const m = settings.modifiers;
  const tol = settings.tolerance;
  const usable = (e: Entity) => !ctx.exclude?.has(e.id) && (!ctx.filter || ctx.filter(e));
  const near: EntityPrims[] = index
    .around(cursor, tol)
    .filter(usable)
    .map((entity) => ({ entity, prims: primsOf(entity, index.ctx) }));

  const cands: Candidate[] = [];
  for (const { entity, prims } of near) {
    entityCandidates(entity, m, cands);
    for (const p of prims) {
      primCandidates(p, entity.id, m, ctx, cands);
      if (m.nearest) cands.push({ point: closestOnPrim(p, cursor).point, kind: "nearest", ids: [entity.id] });
    }
  }

  if (m.intersection) {
    const flat = near.flatMap(({ entity, prims }) => prims.map((p) => ({ id: entity.id, p })));
    for (let i = 0; i < flat.length; i++)
      for (let j = i + 1; j < flat.length; j++)
        for (const h of intersectPrims(flat[i].p, flat[j].p))
          if (dist(h.point, cursor) <= tol) cands.push({ point: h.point, kind: "intersection", ids: [flat[i].id, flat[j].id] });
  }

  if (m.apparent) {
    const range = ctx.apparentRange ?? tol * 40;
    // Nearest 30 entities only: apparent intersections compare every pair of their primitives.
    const far = index
      .nearest(cursor, range, usable)
      .slice(0, 30)
      .flatMap(({ entity }) => primsOf(entity, index.ctx).map((p) => ({ id: entity.id, p })));
    for (let i = 0; i < far.length; i++)
      for (let j = i + 1; j < far.length; j++) {
        if (far[i].id === far[j].id) continue;
        for (const h of intersectPrims(far[i].p, far[j].p, { extend: true }))
          if (dist(h.point, cursor) <= tol) cands.push({ point: h.point, kind: "apparent", ids: [far[i].id, far[j].id] });
      }
  }

  if (m.alignment) {
    const anchors = [...(ctx.anchors ?? []), ...(ctx.from ? [ctx.from] : [])];
    let ax: Vec2 | undefined;
    let ay: Vec2 | undefined;
    for (const a of anchors) {
      if (Math.abs(cursor.x - a.x) <= tol && (!ax || Math.abs(cursor.x - a.x) < Math.abs(cursor.x - ax.x))) ax = a;
      if (Math.abs(cursor.y - a.y) <= tol && (!ay || Math.abs(cursor.y - a.y) < Math.abs(cursor.y - ay.y))) ay = a;
    }
    if (ax && ay) {
      const pt = { x: ax.x, y: ay.y };
      cands.push({ point: pt, kind: "alignment", ids: [], guides: [{ a: ax, b: pt }, { a: ay, b: pt }] });
    } else {
      const a = ax ?? ay;
      if (a) {
        const vertical = a === ax;
        const pt = vertical ? { x: a.x, y: cursor.y } : { x: cursor.x, y: a.y };
        cands.push({ point: pt, kind: "alignment", ids: [], guides: [{ a, b: pt }] });
        // Where the guide crosses nearby geometry is a stronger alignment point.
        const guide: Prim = { t: "xline", p: a, d: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 } };
        for (const { entity, prims } of near)
          for (const p of prims)
            for (const h of intersectPrims(guide, p))
              if (dist(h.point, cursor) <= tol)
                cands.push({ point: h.point, kind: "alignment", ids: [entity.id], guides: [{ a, b: h.point }] });
      }
    }
  }

  let best: Candidate | undefined;
  for (const c of cands) if (dist(c.point, cursor) <= tol && (!best || better(c, best, cursor))) best = c;
  // A guide/geometry crossing beats a bare guide point when both are in range.
  if (best?.kind === "alignment" && best.ids.length === 0) {
    const crossing = cands.find((c) => c.kind === "alignment" && c.ids.length > 0 && dist(c.point, cursor) <= tol);
    if (crossing) best = crossing;
  }
  if (best) return { point: best.point, kind: best.kind, label: SNAP_LABEL[best.kind], entityIds: best.ids, guides: best.guides ?? [] };

  // Constraints.
  if (ctx.from && m.parallel && ctx.direction) {
    const d = normalize(ctx.direction);
    const t = dot(sub(cursor, ctx.from), d);
    const pt = add(ctx.from, scale(d, t));
    return { point: pt, kind: "parallel", label: SNAP_LABEL.parallel, entityIds: [], guides: [{ a: ctx.from, b: pt }] };
  }
  if (ctx.from && m.angle && settings.angleStep) {
    const r = angleLock(ctx.from, cursor, settings.angleStep);
    const deg = Math.round(((((r.angle * 180) / Math.PI) % 360) + 360) % 360 * 1000) / 1000;
    return { point: r.point, kind: "angle", label: `${deg}°`, entityIds: [], guides: [{ a: ctx.from, b: r.point }] };
  }
  if (m.grid && settings.grid) {
    return { point: gridPoint(cursor, settings.grid.spacing, settings.grid.origin), kind: "grid", label: SNAP_LABEL.grid, entityIds: [], guides: [] };
  }
  return { point: cursor, kind: "none", label: "", entityIds: [], guides: [] };
}

/** Parameter of a point on an entity's nearest primitive (used by trim/split later). */
export function paramOnEntity(e: Entity, p: Vec2, index?: EntityIndex): { primIndex: number; u: number } | null {
  const prims = primsOf(e, index?.ctx);
  let best: { primIndex: number; u: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < prims.length; i++) {
    const h = closestOnPrim(prims[i], p);
    if (h.distance < bestD) {
      bestD = h.distance;
      best = { primIndex: i, u: h.u };
    }
  }
  return best;
}
