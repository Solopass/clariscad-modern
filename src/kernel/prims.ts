// Every entity is broken into a few geometric primitives. Intersections,
// snapping, hit-testing and bounding boxes all work on primitives, so new
// entity kinds only need a toPrims() case.
import type { BBox, Entity, Id, SymbolDef, WallOpening } from "./types";
import { type Transform2D, apply, applyDir, multiply, rotation, scaling, translation } from "./transform";
import {
  type Vec2,
  TAU,
  add,
  angleInSweep,
  angleOf,
  dist,
  dot,
  fromAngle,
  lerp,
  normalize,
  normAngle,
  perp,
  rotate,
  scale,
  sub,
} from "./vec";

export interface SegPrim {
  t: "seg";
  a: Vec2;
  b: Vec2;
}
/** Circular arc, CCW from `start` through `sweep` radians (0 < sweep ≤ 2π). Full circle when sweep = 2π. */
export interface ArcPrim {
  t: "arc";
  c: Vec2;
  r: number;
  start: number;
  sweep: number;
}
/** Infinite line through `p` with unit direction `d`. */
export interface XLinePrim {
  t: "xline";
  p: Vec2;
  d: Vec2;
}
/** Elliptical arc by parametric angle: P(u) = c + R(rot)·(rx cos u, ry sin u). */
export interface EllPrim {
  t: "ell";
  c: Vec2;
  rx: number;
  ry: number;
  rot: number;
  start: number;
  sweep: number;
}
/** Free-form parametric curve (splines). Carries its own evaluator and a flattened polyline. */
export interface CurvePrim {
  t: "curve";
  ev: (u: number) => Vec2;
  u0: number;
  u1: number;
  closed: boolean;
  pts: Vec2[];
  params: number[];
}

export type Prim = SegPrim | ArcPrim | XLinePrim | EllPrim | CurvePrim;

/** One wall's solved geometry. */
export interface WallSolveEntry {
  entity: Entity;
  /** Faces, caps and jambs. */
  prims: Prim[];
  /** Closed outlines of the wall's solid parts (for fills); openings excluded. */
  fill: Vec2[][];
  /** Where each opening's symbol goes: maps symbol space (opening centred on the origin, along +x, swing +y) to the drawing. */
  frames: { opening: WallOpening; T: Transform2D }[];
}

/**
 * Shared, document-level inputs to geometry. Owned by the EntityIndex and
 * updated field by field (never replaced wholesale) as the document changes.
 */
export interface PrimContext {
  symbols?: Map<Id, SymbolDef> | Record<Id, SymbolDef>;
  /** Wall solver output. Used only while `entity` is the exact object being drawn. */
  wallPrims?: Map<Id, WallSolveEntry>;
  /** Dimension geometry builder (depends on layer scale, drafting standard and units). */
  dimPrims?: (e: Extract<Entity, { kind: "dimension" }>) => Prim[];
}

const isFull = (sweep: number) => sweep >= TAU - 1e-12;

// ---------------------------------------------------------------- evaluation

/** Parameter range of a primitive. seg: [0,1]; arc/ell: [start, start+sweep]; xline: ℝ. */
export function primRange(p: Prim): [number, number] {
  switch (p.t) {
    case "seg":
      return [0, 1];
    case "arc":
    case "ell":
      return [p.start, p.start + p.sweep];
    case "xline":
      return [-Infinity, Infinity];
    case "curve":
      return [p.u0, p.u1];
  }
}

export function primPoint(p: Prim, u: number): Vec2 {
  switch (p.t) {
    case "seg":
      return lerp(p.a, p.b, u);
    case "arc":
      return add(p.c, fromAngle(u, p.r));
    case "xline":
      return add(p.p, scale(p.d, u));
    case "ell":
      return add(p.c, rotate({ x: p.rx * Math.cos(u), y: p.ry * Math.sin(u) }, p.rot));
    case "curve":
      return p.ev(u);
  }
}

export function primDeriv(p: Prim, u: number): Vec2 {
  switch (p.t) {
    case "seg":
      return sub(p.b, p.a);
    case "arc":
      return { x: -p.r * Math.sin(u), y: p.r * Math.cos(u) };
    case "xline":
      return p.d;
    case "ell":
      return rotate({ x: -p.rx * Math.sin(u), y: p.ry * Math.cos(u) }, p.rot);
    case "curve": {
      const h = 1e-6 * Math.max(1, p.u1 - p.u0);
      const lo = Math.max(p.u0, u - h);
      const hi = Math.min(p.u1, u + h);
      const a = p.ev(lo);
      const b = p.ev(hi);
      return scale(sub(b, a), 1 / (hi - lo));
    }
  }
}

/** Convert a point that lies on the primitive to its parameter (no projection beyond the obvious). */
export function primParamOf(p: Prim, q: Vec2): number {
  switch (p.t) {
    case "seg": {
      const d = sub(p.b, p.a);
      const l2 = dot(d, d);
      return l2 === 0 ? 0 : dot(sub(q, p.a), d) / l2;
    }
    case "arc":
      return p.start + normAngle(angleOf(sub(q, p.c)) - p.start);
    case "xline":
      return dot(sub(q, p.p), p.d);
    case "ell": {
      const l = rotate(sub(q, p.c), -p.rot);
      return p.start + normAngle(Math.atan2(l.y / p.ry, l.x / p.rx) - p.start);
    }
    case "curve":
      return closestOnPrim(p, q).u;
  }
}

/** Is parameter `u` inside the primitive's range (with tolerance)? Angles are compared modulo 2π. */
export function primContains(p: Prim, u: number, eps = 1e-9): boolean {
  switch (p.t) {
    case "seg": {
      const l = dist(p.a, p.b) || 1;
      return u >= -eps / l && u <= 1 + eps / l;
    }
    case "arc":
      return angleInSweep(u, p.start, p.sweep, eps / Math.max(p.r, 1e-12));
    case "ell":
      return angleInSweep(u, p.start, p.sweep, eps / Math.max(Math.min(p.rx, p.ry), 1e-12));
    case "xline":
      return true;
    case "curve":
      return u >= p.u0 - 1e-12 && u <= p.u1 + 1e-12;
  }
}

/** Endpoints of an open primitive (none for closed ones and infinite lines). */
export function primEnds(p: Prim): Vec2[] {
  switch (p.t) {
    case "seg":
      return [p.a, p.b];
    case "arc":
    case "ell":
      return isFull(p.sweep) ? [] : [primPoint(p, p.start), primPoint(p, p.start + p.sweep)];
    case "xline":
      return [];
    case "curve":
      return p.closed ? [] : [p.ev(p.u0), p.ev(p.u1)];
  }
}

// ---------------------------------------------------------------- flattening

/** Polyline approximation with chord error ≤ tol, plus the parameter of each vertex. */
export function flattenPrim(p: Prim, tol = 1e-3): { pts: Vec2[]; params: number[] } {
  switch (p.t) {
    case "seg":
      return { pts: [p.a, p.b], params: [0, 1] };
    case "xline":
      // Callers clip infinite lines themselves; give a long finite stand-in.
      return { pts: [primPoint(p, -1e7), primPoint(p, 1e7)], params: [-1e7, 1e7] };
    case "arc":
    case "ell": {
      const r = p.t === "arc" ? p.r : Math.max(p.rx, p.ry);
      const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 4;
      const n = Math.max(8, Math.min(4096, Math.ceil(p.sweep / step)));
      const pts: Vec2[] = [];
      const params: number[] = [];
      for (let i = 0; i <= n; i++) {
        const u = p.start + (p.sweep * i) / n;
        params.push(u);
        pts.push(primPoint(p, u));
      }
      return { pts, params };
    }
    case "curve":
      return { pts: p.pts, params: p.params };
  }
}

// ---------------------------------------------------------------- closest point

export interface ClosestHit {
  point: Vec2;
  u: number;
  distance: number;
}

export function closestOnPrim(p: Prim, q: Vec2): ClosestHit {
  switch (p.t) {
    case "seg": {
      const d = sub(p.b, p.a);
      const l2 = dot(d, d);
      const u = l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(q, p.a), d) / l2));
      const pt = lerp(p.a, p.b, u);
      return { point: pt, u, distance: dist(pt, q) };
    }
    case "xline": {
      const u = dot(sub(q, p.p), p.d);
      const pt = add(p.p, scale(p.d, u));
      return { point: pt, u, distance: dist(pt, q) };
    }
    case "arc": {
      const v = sub(q, p.c);
      const th = v.x === 0 && v.y === 0 ? p.start : angleOf(v);
      if (angleInSweep(th, p.start, p.sweep)) {
        const pt = add(p.c, fromAngle(th, p.r));
        return { point: pt, u: p.start + normAngle(th - p.start), distance: dist(pt, q) };
      }
      const a = primPoint(p, p.start);
      const b = primPoint(p, p.start + p.sweep);
      return dist(a, q) <= dist(b, q)
        ? { point: a, u: p.start, distance: dist(a, q) }
        : { point: b, u: p.start + p.sweep, distance: dist(b, q) };
    }
    case "ell":
    case "curve": {
      // Coarse search on the flattened polyline, then Newton on (P(u)-q)·P'(u) = 0.
      const { pts, params } = flattenPrim(p, p.t === "ell" ? Math.max(p.rx, p.ry) * 1e-3 : 1e-3);
      let best = { u: params[0], d: Infinity };
      for (let i = 0; i + 1 < pts.length; i++) {
        const h = closestOnPrim({ t: "seg", a: pts[i], b: pts[i + 1] }, q);
        if (h.distance < best.d) best = { u: params[i] + (params[i + 1] - params[i]) * h.u, d: h.distance };
      }
      const [lo, hi] = primRange(p);
      let u = best.u;
      for (let it = 0; it < 30; it++) {
        const f = (x: number) => dot(sub(primPoint(p, x), q), primDeriv(p, x));
        const h = 1e-7 * Math.max(1, Math.abs(hi - lo));
        const fu = f(u);
        const df = (f(u + h) - f(u - h)) / (2 * h);
        if (df === 0 || !Number.isFinite(df)) break;
        const next = Math.min(hi, Math.max(lo, u - fu / df));
        if (Math.abs(next - u) < 1e-15) break;
        u = next;
      }
      const pt = primPoint(p, u);
      const dd = dist(pt, q);
      if (dd > best.d) {
        const pb = primPoint(p, best.u);
        return { point: pb, u: best.u, distance: dist(pb, q) };
      }
      return { point: pt, u, distance: dd };
    }
  }
}

// ---------------------------------------------------------------- bounding boxes

export const emptyBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

function grow(b: BBox, p: Vec2) {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}

/** Bounding box of a primitive; null for infinite lines. */
export function primBBox(p: Prim): BBox | null {
  const b = emptyBox();
  switch (p.t) {
    case "xline":
      return null;
    case "seg":
      grow(b, p.a);
      grow(b, p.b);
      return b;
    case "arc":
      for (const e of primEnds(p)) grow(b, e);
      for (let k = 0; k < 4; k++) {
        const th = (k * Math.PI) / 2;
        if (angleInSweep(th, p.start, p.sweep)) grow(b, add(p.c, fromAngle(th, p.r)));
      }
      return b;
    case "ell": {
      // Extremes of an ellipse along x and y have closed forms; partial arcs add their ends.
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const ux = Math.atan2(-p.ry * s, p.rx * c);
      const uy = Math.atan2(p.ry * c, p.rx * s);
      for (const u of [ux, ux + Math.PI, uy, uy + Math.PI]) if (angleInSweep(u, p.start, p.sweep)) grow(b, primPoint(p, u));
      for (const e of primEnds(p)) grow(b, e);
      return b;
    }
    case "curve":
      for (const q of p.pts) grow(b, q);
      return b;
  }
}

export function unionBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Guides are infinite: they have no box and match every spatial query. */
export const isUnbounded = (e: Entity): boolean => e.kind === "guide";

/** Bounding box of an entity's finite geometry; null if it has none (guides, empty or broken symbols). */
export function entityBBox(e: Entity, ctx?: PrimContext): BBox | null {
  let out: BBox | null = null;
  if (e.kind === "dimension") {
    const b = emptyBox();
    for (const p of e.points) grow(b, p);
    grow(b, e.linePoint);
    out = b.minX <= b.maxX ? b : null;
  }
  if (e.kind === "wall" && ctx?.wallPrims?.get(e.id)?.entity === e) {
    // Solved: the real outline, including mitres and door swings.
    for (const p of toPrims(e, ctx)) {
      const b = primBBox(p);
      if (b) out = out ? unionBox(out, b) : b;
    }
    return out;
  }
  if (e.kind === "wall") {
    // Unsolved: a padded box (mitres reach at most 2× the thickness past the band).
    const b = emptyBox();
    for (const p of bandPrims(e.a, e.b, e.thickness, e.justify, true, true)) {
      grow(b, p.a);
      grow(b, p.b);
    }
    const pad = e.thickness * 4;
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }
  for (const p of primsOf(e, ctx)) {
    const b = primBBox(p);
    if (b) out = out ? unionBox(out, b) : b;
  }
  return out;
}

// Entities are immutable values, so primitives can be cached per object. Symbols,
// walls and dimensions are not cached: their geometry also depends on document-level
// context (symbol definitions, neighbouring walls, layer scale / standard / units).
const primCache = new WeakMap<Entity, Prim[]>();

/** Cached toPrims() for hot paths (snapping, hit-testing). */
export function primsOf(e: Entity, ctx?: PrimContext): Prim[] {
  if (e.kind === "symbol" || e.kind === "wall" || e.kind === "dimension") return toPrims(e, ctx);
  let p = primCache.get(e);
  if (!p) {
    p = toPrims(e, ctx);
    primCache.set(e, p);
  }
  return p;
}

// ---------------------------------------------------------------- splines

const catmullSeg = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
};

const SPLINE_STEPS = 24;

export interface SplineDef {
  points: Vec2[];
  mode: "bspline" | "interpolated";
  closed: boolean;
  degree?: number;
  knots?: number[];
  weights?: number[];
}

/** NURBS by de Boor's algorithm (homogeneous coordinates). */
function nurbs(ctrl: Vec2[], w: number[], knots: number[], p: number) {
  const m = ctrl.length;
  const lo = knots[p];
  const hi = knots[m];
  const ev = (u: number): Vec2 => {
    u = Math.min(hi, Math.max(lo, u));
    let k = p;
    while (k < m - 1 && u >= knots[k + 1]) k++;
    const d: { x: number; y: number; w: number }[] = [];
    for (let j = 0; j <= p; j++) {
      const q = ctrl[j + k - p];
      const wt = w[j + k - p];
      d.push({ x: q.x * wt, y: q.y * wt, w: wt });
    }
    for (let r = 1; r <= p; r++)
      for (let j = p; j >= r; j--) {
        const den = knots[j + 1 + k - r] - knots[j + k - p];
        const a = den === 0 ? 0 : (u - knots[j + k - p]) / den;
        d[j] = {
          x: (1 - a) * d[j - 1].x + a * d[j].x,
          y: (1 - a) * d[j - 1].y + a * d[j].y,
          w: (1 - a) * d[j - 1].w + a * d[j].w,
        };
      }
    return { x: d[p].x / d[p].w, y: d[p].y / d[p].w };
  };
  // Sample each non-empty knot span.
  const params: number[] = [];
  for (let k = p; k < m; k++) {
    const a = knots[k];
    const b = knots[k + 1];
    if (b <= a) continue;
    for (let i = 0; i < SPLINE_STEPS; i++) params.push(a + ((b - a) * i) / SPLINE_STEPS);
  }
  params.push(hi);
  return { ev, lo, hi, params };
}

/**
 * Curve primitive for a spline.
 *  bspline:      NURBS, degree 3 by default. Open curves use a clamped uniform knot
 *                vector (the curve starts/ends on the end control points with the
 *                control-polygon tangents); closed curves are uniform periodic.
 *                An explicit knot vector (DXF) overrides both.
 *  interpolated: Catmull-Rom through every fit point.
 */
export function splinePrim(def: SplineDef): CurvePrim | null;
export function splinePrim(points: Vec2[], mode: "bspline" | "interpolated", closed: boolean): CurvePrim | null;
export function splinePrim(a: SplineDef | Vec2[], mode?: "bspline" | "interpolated", closed?: boolean): CurvePrim | null {
  const def: SplineDef = Array.isArray(a) ? { points: a, mode: mode!, closed: closed! } : a;
  const points = def.points;
  const n = points.length;
  if (n < 2) return null;
  const isClosed = def.closed && n >= 3;

  if (def.mode === "bspline") {
    const p = Math.max(1, Math.min(def.degree ?? 3, n - 1));
    let ctrl = points;
    let w = def.weights && def.weights.length === n ? def.weights : points.map(() => 1);
    let knots = def.knots;
    if (!knots || knots.length !== ctrl.length + p + 1) {
      if (isClosed) {
        ctrl = [...points, ...points.slice(0, p)];
        w = [...w, ...w.slice(0, p)];
        knots = Array.from({ length: ctrl.length + p + 1 }, (_, i) => i);
      } else {
        knots = [];
        for (let i = 0; i <= p; i++) knots.push(0);
        for (let i = 1; i < n - p; i++) knots.push(i);
        for (let i = 0; i <= p; i++) knots.push(n - p);
      }
    }
    const { ev, lo, hi, params } = nurbs(ctrl, w, knots, p);
    return { t: "curve", ev, u0: lo, u1: hi, closed: isClosed, pts: params.map(ev), params };
  }

  const at = (i: number) => points[((i % n) + n) % n];
  const quads: [Vec2, Vec2, Vec2, Vec2][] = [];
  if (isClosed) {
    for (let i = 0; i < n; i++) quads.push([at(i - 1), at(i), at(i + 1), at(i + 2)]);
  } else {
    const first = sub(scale(points[0], 2), points[1]);
    const last = sub(scale(points[n - 1], 2), points[n - 2]);
    const q = [first, ...points, last];
    for (let i = 0; i + 3 < q.length; i++) quads.push([q[i], q[i + 1], q[i + 2], q[i + 3]]);
  }
  const nseg = quads.length;
  const ev = (u: number): Vec2 => {
    const i = Math.min(nseg - 1, Math.max(0, Math.floor(u)));
    const [p0, p1, p2, p3] = quads[i];
    return catmullSeg(p0, p1, p2, p3, u - i);
  };
  const pts: Vec2[] = [];
  const params: number[] = [];
  for (let i = 0; i <= nseg * SPLINE_STEPS; i++) {
    const u = i / SPLINE_STEPS;
    params.push(u);
    pts.push(ev(u));
  }
  return { t: "curve", ev, u0: 0, u1: nseg, closed: isClosed, pts, params };
}

// ---------------------------------------------------------------- entities → prims

/** Arc from a to b with a DXF bulge (tan of a quarter of the included angle; > 0 = CCW). */
export function bulgeArc(a: Vec2, b: Vec2, bulge: number): ArcPrim {
  const theta = 4 * Math.atan(bulge);
  const c = dist(a, b);
  const m = lerp(a, b, 0.5);
  const n = perp(normalize(sub(b, a)));
  const center = add(m, scale(n, c / 2 / Math.tan(theta / 2)));
  const r = c / 2 / Math.abs(Math.sin(theta / 2));
  // CCW arcs run a → b; CW arcs are stored CCW from b → a.
  const from = bulge > 0 ? a : b;
  return { t: "arc", c: center, r, start: normAngle(angleOf(sub(from, center))), sweep: Math.abs(theta) };
}

function polySegs(points: Vec2[], closed: boolean, bulges?: number[]): Prim[] {
  const out: Prim[] = [];
  const edge = (i: number, j: number) => {
    const bl = bulges?.[i] ?? 0;
    if (bl !== 0 && dist(points[i], points[j]) > 0) out.push(bulgeArc(points[i], points[j], bl));
    else out.push({ t: "seg", a: points[i], b: points[j] });
  };
  for (let i = 0; i + 1 < points.length; i++) edge(i, i + 1);
  if (closed && points.length > 2) edge(points.length - 1, 0);
  return out;
}

/** Offsets (left-normal distances) of the two faces of a double line / wall. */
export function bandOffsets(width: number, justify: "center" | "left" | "right"): [number, number] {
  if (justify === "left") return [0, width];
  if (justify === "right") return [-width, 0];
  return [-width / 2, width / 2];
}

export function bandPrims(a: Vec2, b: Vec2, width: number, justify: "center" | "left" | "right", capA: boolean, capB: boolean): SegPrim[] {
  const n = perp(normalize(sub(b, a)));
  const [o1, o2] = bandOffsets(width, justify);
  const a1 = add(a, scale(n, o1));
  const b1 = add(b, scale(n, o1));
  const a2 = add(a, scale(n, o2));
  const b2 = add(b, scale(n, o2));
  const out: SegPrim[] = [
    { t: "seg", a: a1, b: b1 },
    { t: "seg", a: a2, b: b2 },
  ];
  if (capA) out.push({ t: "seg", a: a1, b: a2 });
  if (capB) out.push({ t: "seg", a: b1, b: b2 });
  return out;
}

/** Corner points of a (rotated) rectangle, CCW from bottom-left. */
export function rectCorners(c: Vec2, w: number, h: number, rot: number): Vec2[] {
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => add(c, rotate(p, rot)));
}

function rectPrims(c: Vec2, w: number, h: number, rot: number, radius: number): Prim[] {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r === 0) return polySegs(rectCorners(c, w, h, rot), true);
  const hw = Math.abs(w) / 2;
  const hh = Math.abs(h) / 2;
  const L = (x: number, y: number) => add(c, rotate({ x, y }, rot));
  const out: Prim[] = [];
  const seg = (a: Vec2, b: Vec2) => {
    if (dist(a, b) > 1e-12) out.push({ t: "seg", a, b });
  };
  const arc = (cx: number, cy: number, start: number) =>
    out.push({ t: "arc", c: L(cx, cy), r, start: normAngle(start + rot), sweep: Math.PI / 2 });
  seg(L(-hw + r, -hh), L(hw - r, -hh));
  arc(hw - r, -hh + r, -Math.PI / 2);
  seg(L(hw, -hh + r), L(hw, hh - r));
  arc(hw - r, hh - r, 0);
  seg(L(hw - r, hh), L(-hw + r, hh));
  arc(-hw + r, hh - r, Math.PI / 2);
  seg(L(-hw, hh - r), L(-hw, -hh + r));
  arc(-hw + r, -hh + r, Math.PI);
  return out;
}

function symbolLookup(ctx: PrimContext | undefined, id: Id): SymbolDef | undefined {
  const s = ctx?.symbols;
  if (!s) return undefined;
  return s instanceof Map ? s.get(id) : s[id];
}

/** Symbol placement: translate(pos) · rotate(rot) · scale(sx, sy) · translate(-origin). */
export function symbolTransform(origin: Vec2, pos: Vec2, rot: number, sx: number, sy: number): Transform2D {
  return multiply(translation(pos.x, pos.y), multiply(rotation(rot), multiply(scaling(sx, sy), translation(-origin.x, -origin.y))));
}

/**
 * Apply any affine transform. Circles/arcs stay exact under similarity transforms
 * (including mirroring); ellipses stay exact under rotation + uniform scale. Anything
 * else (non-uniform scale, mirrored ellipses) becomes a parametric curve.
 */
export function transformPrim(p: Prim, T: Transform2D): Prim {
  const m = (q: Vec2) => apply(T, q);
  const det = T.a * T.d - T.b * T.c;
  const sx = Math.hypot(T.a, T.b);
  const sy = Math.hypot(T.c, T.d);
  const conformal = Math.abs(sx - sy) <= 1e-12 * Math.max(sx, sy) && Math.abs(T.a * T.c + T.b * T.d) <= 1e-12 * sx * sy;
  const asCurve = (): CurvePrim => {
    const [lo, hi] = primRange(p);
    const { pts, params } = flattenPrim(p, 1e-4 * Math.max(1e-9, primBBox(p) ? boxSize(primBBox(p)!) : 1));
    const closed = (p.t === "arc" || p.t === "ell") && isFull(p.sweep);
    return { t: "curve", ev: (u) => m(primPoint(p, u)), u0: lo, u1: hi, closed, pts: pts.map(m), params };
  };
  switch (p.t) {
    case "seg":
      return { t: "seg", a: m(p.a), b: m(p.b) };
    case "xline":
      return { t: "xline", p: m(p.p), d: normalize(applyDir(T, p.d)) };
    case "arc": {
      if (!conformal) return asCurve();
      const c = m(p.c);
      // A mirror reverses direction: the old end becomes the new CCW start.
      const s = m(primPoint(p, det > 0 ? p.start : p.start + p.sweep));
      return { t: "arc", c, r: p.r * sx, start: normAngle(angleOf(sub(s, c))), sweep: p.sweep };
    }
    case "ell": {
      if (!conformal || det < 0) return asCurve();
      return { ...p, c: m(p.c), rx: p.rx * sx, ry: p.ry * sx, rot: p.rot + Math.atan2(T.b, T.a) };
    }
    case "curve":
      return { ...p, ev: (u) => m(p.ev(u)), pts: p.pts.map(m) };
  }
}

const boxSize = (b: BBox) => Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);

export function toPrims(e: Entity, ctx?: PrimContext, depth = 0): Prim[] {
  switch (e.kind) {
    case "line":
      return [{ t: "seg", a: e.a, b: e.b }];
    case "polyline":
      return polySegs(e.points, e.closed, e.bulges);
    case "polygon":
      return polySegs(e.points, true);
    case "doubleLine":
      return bandPrims(e.a, e.b, e.width, e.justify, e.capStart, e.capEnd);
    case "wall": {
      // Solved geometry (junctions, openings) when the solver has seen this exact object;
      // otherwise (previews, drags, no solver) a plain capped band.
      const solved = ctx?.wallPrims?.get(e.id);
      if (!solved || solved.entity !== e) return bandPrims(e.a, e.b, e.thickness, e.justify, true, true);
      if (!solved.frames.length) return solved.prims;
      // Door and window symbols drawn in their openings, sized to the opening.
      const out = solved.prims.slice();
      for (const { opening, T } of solved.frames) {
        const def = opening.symbolId ? symbolLookup(ctx, opening.symbolId) : undefined;
        if (!def || depth > 16) continue;
        const k = def.opening?.width ? opening.width / def.opening.width : 1;
        const M = multiply(T, multiply(scaling(k), translation(-def.origin.x, -def.origin.y)));
        for (const child of def.entities) for (const p of toPrims(child, ctx, depth + 1)) out.push(transformPrim(p, M));
      }
      return out;
    }
    case "rect":
      return rectPrims(e.center, e.width, e.height, e.rotation, e.cornerRadius);
    case "circle":
      return [{ t: "arc", c: e.center, r: e.r, start: 0, sweep: TAU }];
    case "arc": {
      let sweep = normAngle(e.end - e.start);
      if (sweep === 0) sweep = TAU;
      return [{ t: "arc", c: e.center, r: e.r, start: normAngle(e.start), sweep }];
    }
    case "ellipse": {
      let start = 0;
      let sweep = TAU;
      if (e.start !== undefined && e.end !== undefined) {
        start = normAngle(e.start);
        sweep = normAngle(e.end - e.start) || TAU;
      }
      return [{ t: "ell", c: e.center, rx: e.rx, ry: e.ry, rot: e.rotation, start, sweep }];
    }
    case "spline": {
      const c = splinePrim(e);
      return c ? [c] : [];
    }
    case "guide":
      return [{ t: "xline", p: e.point, d: normalize(e.dir) }];
    case "dimension":
      // Lines, arrows and a text box, for hit-testing; built by kernel/dimensions via ctx.
      return ctx?.dimPrims ? ctx.dimPrims(e) : [];
    case "symbol": {
      const def = symbolLookup(ctx, e.symbolId);
      if (!def || depth > 16) return [];
      const T = symbolTransform(def.origin, e.position, e.rotation, e.scaleX, e.scaleY);
      const out: Prim[] = [];
      for (const child of def.entities) for (const p of toPrims(child, ctx, depth + 1)) out.push(transformPrim(p, T));
      return out;
    }
  }
}
