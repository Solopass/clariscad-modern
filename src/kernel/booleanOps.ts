// Trim, split, extend, offset, fillet, chamfer. Pure: each returns an
// EditResult describing what to replace, remove and add (or null when the
// edit does not apply), and the tools turn that into one undoable patch.
import type { ArcEntity, Entity, Id, LineEntity } from "./types";
import { type ArcPrim, type Prim, type PrimContext, type SegPrim, primDeriv, primPoint, primsOf, splinePrim } from "./prims";
import { simplifyPolyline } from "./simplify";
import { intersectPrims, lineLine } from "./intersections";
import { tangentTangentRadius } from "./construct";
import {
  type Path,
  type PathSeg,
  endOf,
  localU,
  normalizeCuts,
  paramOf,
  pathToEntity,
  pointAt,
  segsToEntity,
  startOf,
  subPath,
  toPath,
} from "./path";
import { type Vec2, TAU, add, angleInSweep, angleOf, cross, dist, dot, normAngle, normalize, perp, rotate, scale, sub } from "./vec";

/** A spline edited as the polyline the rest of the kernel already flattens it to, then put back. */
function splineStandIn(e: Extract<Entity, { kind: "spline" }>): Entity | null {
  const prim = splinePrim(e);
  if (!prim || prim.pts.length < 2) return null;
  const span = Math.max(...prim.pts.map((p) => Math.hypot(p.x, p.y)), 1);
  let pts = simplifyPolyline(prim.pts, Math.max(0.05, span * 1e-4));
  if (e.closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
  if (pts.length < 2) return null;
  return { id: e.id, layerId: e.layerId, ...(e.style ? { style: e.style } : {}), kind: "polyline", points: pts, closed: !!e.closed };
}

function backToSpline(e: Entity): Entity {
  if (e.kind !== "polyline" || e.bulges?.some((b) => b !== 0)) return e;
  return { id: e.id, layerId: e.layerId, ...(e.style ? { style: e.style } : {}), ...(e.groups ? { groups: e.groups } : {}), ...(e.locked ? { locked: true } : {}), kind: "spline", points: e.points, mode: "interpolated", closed: e.closed };
}

function mapSpline(r: EditResult): EditResult {
  return { replace: r.replace.map(backToSpline), add: r.add.map(backToSpline), remove: r.remove };
}

export interface EditResult {
  /** New versions of existing entities (same ids). */
  replace: Entity[];
  remove: Id[];
  add: Entity[];
}

const none = (): EditResult => ({ replace: [], remove: [], add: [] });
const base = (e: Entity) => ({ layerId: e.layerId, style: e.style });

// ---------------------------------------------------------------- cuts

/** Path parameters where `cutters` cross the target's path. */
export function cutParams(path: Path, cutters: Entity[], ctx?: PrimContext): number[] {
  const cuts: number[] = [];
  for (const c of cutters)
    for (const cp of primsOf(c, ctx))
      path.segs.forEach((seg, i) => {
        for (const h of intersectPrims(seg.prim, cp)) cuts.push(i + localU(seg, h.u1));
      });
  return normalizeCuts(path, cuts);
}

/** Pieces of `target` after cutting at `cuts`, with the index of the piece under `pick`. */
function pieces(path: Path, cuts: number[], pick: Vec2): { ranges: [number, number][]; hit: number } {
  const n = path.segs.length;
  const sp = paramOf(path, pick).s;
  if (!path.closed) {
    const b = [0, ...cuts.filter((c) => c > 1e-9 && c < n - 1e-9), n];
    const ranges: [number, number][] = [];
    for (let i = 0; i + 1 < b.length; i++) ranges.push([b[i], b[i + 1]]);
    const hit = ranges.findIndex(([a, z]) => sp >= a - 1e-12 && sp <= z + 1e-12);
    return { ranges, hit };
  }
  const ranges: [number, number][] = [];
  for (let i = 0; i < cuts.length; i++) ranges.push([cuts[i], i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + n]);
  const hit = ranges.findIndex(([a, z]) => (sp >= a && sp <= z) || (sp + n >= a && sp + n <= z));
  return { ranges, hit };
}

/** Remove the piece of `target` under `pick`, bounded by its crossings with `cutters`. */
export function trimAt(target: Entity, pick: Vec2, cutters: Entity[], newId: () => Id, ctx?: PrimContext): EditResult | null {
  if (target.kind === "spline") {
    const poly = splineStandIn(target);
    if (!poly) return null;
    const r = trimAt(poly, pick, cutters, newId, ctx);
    return r ? mapSpline(r) : null;
  }
  const path = toPath(target);
  if (!path) return null;
  const cuts = cutParams(
    path,
    cutters.filter((c) => c.id !== target.id),
    ctx,
  );
  const n = path.segs.length;
  if (path.closed) {
    if (cuts.length < 2) return null;
    const { ranges, hit } = pieces(path, cuts, pick);
    if (hit < 0) return null;
    // Removing one piece of a loop leaves one open piece running the other way round.
    const [a, z] = ranges[hit];
    const rest = subPath(path, z, a + n);
    const e = segsToEntity(rest, target.id, base(target));
    return e ? { replace: [e], remove: [], add: [] } : { replace: [], remove: [target.id], add: [] };
  }
  const { ranges, hit } = pieces(path, cuts, pick);
  if (hit < 0 || ranges.length < 2) return null;
  // Only the picked piece goes; the rest stays whole on either side of it.
  const [ra, rz] = ranges[hit];
  const keep: [number, number][] = [];
  if (ra > 1e-12) keep.push([0, ra]);
  if (rz < n - 1e-12) keep.push([rz, n]);
  const out = none();
  let first = true;
  for (const [a, z] of keep) {
    const e = segsToEntity(subPath(path, a, z), first ? target.id : newId(), base(target));
    if (!e) continue;
    if (first) out.replace.push(e);
    else out.add.push(e);
    first = false;
  }
  if (first) out.remove.push(target.id);
  return out;
}

/** The piece trimAt would remove (for highlighting under the cursor). */
export function trimPiece(target: Entity, pick: Vec2, cutters: Entity[], ctx?: PrimContext): Entity | null {
  if (target.kind === "spline") {
    const poly = splineStandIn(target);
    return poly ? trimPiece(poly, pick, cutters, ctx) : null;
  }
  const path = toPath(target);
  if (!path) return null;
  const cuts = cutParams(
    path,
    cutters.filter((c) => c.id !== target.id),
    ctx,
  );
  if (path.closed ? cuts.length < 2 : cuts.length < 1) return null;
  const { ranges, hit } = pieces(path, cuts, pick);
  if (hit < 0 || (!path.closed && ranges.length < 2)) return null;
  return segsToEntity(subPath(path, ranges[hit][0], ranges[hit][1]), "preview", base(target));
}

/** Split `target` at the point nearest `at`. A closed shape opens there instead. */
export function splitAt(target: Entity, at: Vec2, newId: () => Id): EditResult | null {
  if (target.kind === "spline") {
    const poly = splineStandIn(target);
    if (!poly) return null;
    const r = splitAt(poly, at, newId);
    return r ? mapSpline(r) : null;
  }
  const path = toPath(target);
  if (!path) return null;
  const n = path.segs.length;
  const { s } = paramOf(path, at);
  if (path.closed) {
    const e = segsToEntity(subPath(path, s, s + n), target.id, base(target));
    return e ? { replace: [e], remove: [], add: [] } : null;
  }
  if (s <= 1e-9 || s >= n - 1e-9) return null;
  const a = segsToEntity(subPath(path, 0, s), target.id, base(target));
  const b = segsToEntity(subPath(path, s, n), newId(), base(target));
  if (!a || !b) return null;
  return { replace: [a], remove: [], add: [b] };
}

// ---------------------------------------------------------------- extend

/** Extend the end of `target` nearest `pick` to the first boundary it reaches. */
export function extendTo(target: Entity, pick: Vec2, boundaries: Entity[], ctx?: PrimContext): EditResult | null {
  const path = toPath(target);
  if (!path || path.closed) return null;
  const n = path.segs.length;
  const atEnd = paramOf(path, pick).s > n / 2;
  const seg = atEnd ? path.segs[n - 1] : path.segs[0];
  const prim = seg.prim;
  if (prim.t === "ell" || (prim.t === "arc" && seg.reversed) || (prim.t === "arc" && target.kind !== "arc")) return null;

  let best: { point: Vec2; score: number } | null = null;
  for (const bnd of boundaries) {
    if (bnd.id === target.id) continue;
    for (const bp of primsOf(bnd, ctx)) {
      for (const h of intersectPrims(prim, bp, { extend: true })) {
        // Only hits on the boundary itself (not on its extension) count.
        if (!onPrim(bp, h.point)) continue;
        let score: number;
        if (prim.t === "seg") score = atEnd ? h.u1 - 1 : -h.u1;
        else {
          const end = prim.start + prim.sweep;
          score = atEnd ? normAngle(h.u1 - end) : normAngle(prim.start - h.u1);
          if (score > TAU - 1e-9) score = 0;
        }
        if (score > 1e-9 && (!best || score < best.score)) best = { point: h.point, score };
      }
    }
  }
  if (!best) return null;
  const p = best.point;
  let e: Entity;
  if (target.kind === "line") e = atEnd ? { ...target, b: p } : { ...target, a: p };
  else if (target.kind === "arc") {
    const ang = normAngle(angleOf(sub(p, target.center)));
    e = atEnd ? { ...target, end: ang } : { ...target, start: ang };
  } else if (target.kind === "polyline") {
    const pts = target.points.slice();
    if (atEnd) pts[pts.length - 1] = p;
    else pts[0] = p;
    e = { ...target, points: pts };
  } else return null;
  return { replace: [e], remove: [], add: [] };
}

/** Is `q` on the primitive itself (not its extension)? Curves other than seg/arc are assumed yes. */
function onPrim(p: Prim, q: Vec2): boolean {
  const tol = 1e-7;
  switch (p.t) {
    case "seg": {
      const d = sub(p.b, p.a);
      const l2 = dot(d, d);
      const t = l2 ? dot(sub(q, p.a), d) / l2 : 0;
      return t >= -1e-9 && t <= 1 + 1e-9 && dist(add(p.a, scale(d, t)), q) <= tol * Math.max(1, Math.sqrt(l2));
    }
    case "arc":
      return Math.abs(dist(q, p.c) - p.r) <= tol * Math.max(1, p.r) && angleInSweep(angleOf(sub(q, p.c)), p.start, p.sweep, 1e-9);
    default:
      return true;
  }
}

// ---------------------------------------------------------------- offset

interface OffSeg {
  kind: "seg" | "arc";
  a: Vec2;
  b: Vec2;
  c?: Vec2;
  r?: number;
  reversed?: boolean;
  origSweep?: number;
}

function tangentAt(seg: PathSeg, p: Vec2): Vec2 {
  if (seg.prim.t === "seg") return sub(seg.prim.b, seg.prim.a);
  if (seg.prim.t === "arc") {
    const t = perp(sub(p, seg.prim.c));
    return seg.reversed ? scale(t, -1) : t;
  }
  return { x: 1, y: 0 };
}

/** Parallel copy of `e` at distance `d`, on the side of `side`. */
export function offsetEntity(e: Entity, d: number, side: Vec2, newId: () => Id): EditResult | null {
  if (!(d > 0)) return null;
  const id = newId();
  const add1 = (x: Entity | null) => (x ? { replace: [], remove: [], add: [x] } : null);
  switch (e.kind) {
    case "line": {
      const n = perp(normalize(sub(e.b, e.a)));
      const sg = cross(sub(e.b, e.a), sub(side, e.a)) > 0 ? 1 : -1;
      const o = scale(n, d * sg);
      return add1({ ...e, id, a: add(e.a, o), b: add(e.b, o) });
    }
    case "circle":
    case "arc": {
      const r = dist(side, e.center) < e.r ? e.r - d : e.r + d;
      return r > 1e-9 ? add1({ ...e, id, r }) : null;
    }
    case "rect": {
      const local = rotate(sub(side, e.center), -e.rotation);
      const inside = Math.abs(local.x) < Math.abs(e.width) / 2 && Math.abs(local.y) < Math.abs(e.height) / 2;
      const k = inside ? -1 : 1;
      const w = Math.abs(e.width) + 2 * d * k;
      const h = Math.abs(e.height) + 2 * d * k;
      if (w <= 0 || h <= 0) return null;
      return add1({ ...e, id, width: w, height: h, cornerRadius: e.cornerRadius > 0 ? Math.max(0, e.cornerRadius + d * k) : 0 });
    }
    case "ellipse": {
      const full = e.start === undefined || e.end === undefined;
      const start = full ? 0 : e.start!;
      const sweep = full ? TAU : normAngle(e.end! - e.start!) || TAU;
      const steps = Math.max(24, Math.round((sweep / TAU) * 72));
      const local = rotate(sub(side, e.center), -e.rotation);
      const inside = (local.x * local.x) / (e.rx * e.rx) + (local.y * local.y) / (e.ry * e.ry) < 1;
      const sg = inside ? -1 : 1;
      const pts: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const u = start + (sweep * i) / steps;
        const prim = { t: "ell" as const, c: e.center, rx: e.rx, ry: e.ry, rot: e.rotation, start, sweep };
        const p = primPoint(prim, u);
        const tang = primDeriv(prim, u);
        const outward = scale(perp(normalize(tang)), -1);
        const q = add(p, scale(outward, d * sg));
        if (!pts.length || dist(pts[pts.length - 1], q) > 1e-6) pts.push(q);
      }
      if (full && pts.length > 2) pts.pop();
      if (pts.length < 2) return null;
      return add1({ id, layerId: e.layerId, ...(e.style ? { style: e.style } : {}), kind: "spline", points: simplifyPolyline(pts, d * 0.05), mode: "interpolated", closed: full });
    }
    case "spline": {
      const prim = splinePrim(e);
      if (!prim) return null;
      let best = { u: prim.u0, d: Infinity };
      for (const u of prim.params) {
        const dd = dist(prim.ev(u), side);
        if (dd < best.d) best = { u, d: dd };
      }
      const at = prim.ev(best.u);
      const tang = primDeriv(prim, best.u);
      const sg = cross(tang, sub(side, at)) > 0 ? 1 : -1;
      const pts: Vec2[] = [];
      for (const u of prim.params) {
        const p = prim.ev(u);
        const t = primDeriv(prim, u);
        const left = perp(normalize(t));
        const q = add(p, scale(left, d * sg));
        if (!pts.length || dist(pts[pts.length - 1], q) > 1e-6) pts.push(q);
      }
      const simple = simplifyPolyline(pts, Math.max(0.05, d * 0.05));
      if (simple.length < 2) return null;
      return add1({ id, layerId: e.layerId, ...(e.style ? { style: e.style } : {}), kind: "spline", points: simple, mode: "interpolated", closed: !!e.closed });
    }
    case "polyline":
    case "polygon": {
      const path = toPath(e);
      if (!path || !path.segs.length) return null;
      const { s } = paramOf(path, side);
      const i = Math.min(path.segs.length - 1, Math.floor(s));
      const at = pointAt(path, s);
      const sg = cross(tangentAt(path.segs[i], at), sub(side, at)) > 0 ? 1 : -1;
      const segs = offsetPath(path, d * sg);
      if (!segs) return null;
      return add1(pathToEntity({ segs, closed: path.closed }, id, base(e), e.kind));
    }
    default:
      return null;
  }
}

/** Offset every segment to the left by `o` (negative = right) and re-join the corners. */
function offsetPath(path: Path, o: number): PathSeg[] | null {
  const off: OffSeg[] = [];
  for (const s of path.segs) {
    const p = s.prim;
    if (p.t === "seg") {
      const n = scale(perp(normalize(sub(p.b, p.a))), o);
      off.push({ kind: "seg", a: add(p.a, n), b: add(p.b, n) });
    } else if (p.t === "arc") {
      // Walking CCW, left is toward the centre.
      const r = s.reversed ? p.r + o : p.r - o;
      if (r <= 1e-9) return null;
      const k = r / p.r;
      const a = add(p.c, scale(sub(startOf(s), p.c), k));
      const b = add(p.c, scale(sub(endOf(s), p.c), k));
      off.push({ kind: "arc", a, b, c: p.c, r, reversed: s.reversed, origSweep: p.sweep });
    } else return null;
  }
  const asPrim = (q: OffSeg): Prim => (q.kind === "seg" ? { t: "seg", a: q.a, b: q.b } : { t: "arc", c: q.c!, r: q.r!, start: 0, sweep: TAU });
  const join = (A: OffSeg, B: OffSeg) => {
    if (dist(A.b, B.a) <= 1e-9) return;
    const hits = intersectPrims(asPrim(A), asPrim(B), { extend: true });
    if (!hits.length) return;
    const ref = A.b;
    const j = hits.reduce((x, y) => (dist(x.point, ref) <= dist(y.point, ref) ? x : y)).point;
    A.b = j;
    B.a = j;
  };
  for (let i = 0; i + 1 < off.length; i++) join(off[i], off[i + 1]);
  if (path.closed && off.length > 1) join(off[off.length - 1], off[0]);

  const out: PathSeg[] = [];
  for (let i = 0; i < off.length; i++) {
    const q = off[i];
    if (q.kind === "seg") out.push({ prim: { t: "seg", a: q.a, b: q.b }, reversed: false });
    else {
      const aa = angleOf(sub(q.a, q.c!));
      const ab = angleOf(sub(q.b, q.c!));
      const sweep = q.reversed ? normAngle(aa - ab) : normAngle(ab - aa);
      // Joins can overshoot a small arc: a near-zero or flipped sweep means it collapsed.
      const ok = q.origSweep! >= TAU - 1e-9 || (sweep > 1e-9 && Math.abs(sweep - q.origSweep!) < Math.PI);
      if (ok) {
        const prim: ArcPrim = { t: "arc", c: q.c!, r: q.r!, start: normAngle(q.reversed ? ab : aa), sweep: sweep || TAU };
        out.push({ prim, reversed: !!q.reversed });
      }
    }
    // Parallel neighbours that could not be joined get a short connector.
    const next = off[i + 1] ?? (path.closed ? off[0] : undefined);
    if (next && dist(q.b, next.a) > 1e-9) out.push({ prim: { t: "seg", a: q.b, b: next.a }, reversed: false });
  }
  return out;
}

// ---------------------------------------------------------------- fillet / chamfer

export type TrimMode = "both" | "first" | "none";

const lineDir = (l: LineEntity) => sub(l.b, l.a);

/** Direction along the line from X toward the pick. */
function towardPick(l: LineEntity, X: Vec2, pick: Vec2): Vec2 {
  const d = normalize(lineDir(l));
  let k = dot(sub(pick, X), d);
  if (Math.abs(k) < 1e-12) k = dot(sub(dist(l.a, X) > dist(l.b, X) ? l.a : l.b, X), d);
  return k >= 0 ? d : scale(d, -1);
}

/** Line cut back (or extended) so it runs from its end on the `u` side to `T`. Keeps a/b order. */
function lineTo(l: LineEntity, X: Vec2, u: Vec2, T: Vec2): LineEntity | null {
  const keepA = dot(sub(l.a, X), u) >= dot(sub(l.b, X), u);
  const keep = keepA ? l.a : l.b;
  if (dot(sub(keep, T), u) <= 1e-9) return null; // the kept end would be swallowed
  return keepA ? { ...l, b: T } : { ...l, a: T };
}

function minorArc(c: Vec2, r: number, p: Vec2, q: Vec2, id: Id, b: { layerId: Id; style?: Entity["style"] }): ArcEntity {
  const a1 = normAngle(angleOf(sub(p, c)));
  const a2 = normAngle(angleOf(sub(q, c)));
  const ccw = normAngle(a2 - a1) <= Math.PI;
  return { id, ...b, kind: "arc", center: c, r, start: ccw ? a1 : a2, end: ccw ? a2 : a1 };
}

function primOf(e: Entity): SegPrim | ArcPrim | null {
  if (e.kind === "line") return { t: "seg", a: e.a, b: e.b };
  if (e.kind === "circle") return { t: "arc", c: e.center, r: e.r, start: 0, sweep: TAU };
  if (e.kind === "arc") return { t: "arc", c: e.center, r: e.r, start: normAngle(e.start), sweep: normAngle(e.end - e.start) || TAU };
  return null;
}

/** Arc trimmed so tangency point T becomes an end, keeping the side with the pick. */
function arcTo(a: ArcEntity, T: Vec2, pick: Vec2): ArcEntity {
  const t = normAngle(angleOf(sub(T, a.center)));
  const p = normAngle(angleOf(sub(pick, a.center)));
  const s = normAngle(a.start);
  // Option 1: start → t. Option 2: t → end. Keep the one containing the pick.
  const inFirst = normAngle(p - s) <= normAngle(t - s);
  return inFirst ? { ...a, end: t } : { ...a, start: t };
}

function trimPart(e: Entity, X: Vec2 | null, u: Vec2 | null, T: Vec2, pick: Vec2): Entity | null {
  if (e.kind === "line") {
    if (X && u) return lineTo(e, X, u, T);
    const d = normalize(lineDir(e));
    const side = dot(sub(pick, T), d) >= 0 ? d : scale(d, -1);
    return lineTo(e, T, side, T);
  }
  if (e.kind === "arc") return arcTo(e, T, pick);
  return e; // circles are left whole
}

/**
 * Fillet two lines/arcs/circles with an arc of radius r (r = 0 joins two
 * lines at a sharp corner). Picks choose which sides are kept.
 */
export function fillet(e1: Entity, pick1: Vec2, e2: Entity, pick2: Vec2, r: number, mode: TrimMode, newId: () => Id): EditResult | null {
  if (e1.id === e2.id) return null;
  const out = none();
  if (e1.kind === "line" && e2.kind === "line") {
    const X = lineLine(e1.a, lineDir(e1), e2.a, lineDir(e2))?.point;
    if (!X) return null;
    const u1 = towardPick(e1, X, pick1);
    const u2 = towardPick(e2, X, pick2);
    const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (th < 1e-9 || th > Math.PI - 1e-9) return null;
    const t = r > 0 ? r / Math.tan(th / 2) : 0;
    const T1 = add(X, scale(u1, t));
    const T2 = add(X, scale(u2, t));
    const n1 = mode !== "none" ? lineTo(e1, X, u1, T1) : e1;
    const n2 = mode === "both" ? lineTo(e2, X, u2, T2) : e2;
    if (!n1 || !n2) return null;
    if (mode !== "none") out.replace.push(n1);
    if (mode === "both") out.replace.push(n2);
    if (r > 0) {
      const c = add(X, scale(normalize(add(u1, u2)), r / Math.sin(th / 2)));
      out.add.push(minorArc(c, r, T1, T2, newId(), base(e1)));
    }
    return out;
  }
  const p1 = primOf(e1);
  const p2 = primOf(e2);
  if (!p1 || !p2 || !(r > 0)) return null;
  const cands = tangentTangentRadius(p1, p2, r);
  if (!cands.length) return null;
  cands.sort((a, b) => dist(a.t1, pick1) + dist(a.t2, pick2) - (dist(b.t1, pick1) + dist(b.t2, pick2)));
  const c = cands[0];
  if (mode !== "none") {
    const n1 = trimPart(e1, null, null, c.t1, pick1);
    if (!n1) return null;
    if (n1 !== e1) out.replace.push(n1);
  }
  if (mode === "both") {
    const n2 = trimPart(e2, null, null, c.t2, pick2);
    if (!n2) return null;
    if (n2 !== e2) out.replace.push(n2);
  }
  out.add.push(minorArc(c.center, r, c.t1, c.t2, newId(), base(e1)));
  return out;
}

export type ChamferSpec = { d1: number; d2: number } | { d1: number; angle: number };

/** Chamfer two lines: distances from the corner, or a distance and an angle (radians, from the first line). */
export function chamfer(e1: Entity, pick1: Vec2, e2: Entity, pick2: Vec2, spec: ChamferSpec, mode: TrimMode, newId: () => Id): EditResult | null {
  if (e1.kind !== "line" || e2.kind !== "line" || e1.id === e2.id) return null;
  const X = lineLine(e1.a, lineDir(e1), e2.a, lineDir(e2))?.point;
  if (!X) return null;
  const u1 = towardPick(e1, X, pick1);
  const u2 = towardPick(e2, X, pick2);
  const P1 = add(X, scale(u1, spec.d1));
  let P2: Vec2;
  if ("angle" in spec) {
    const sgn = cross(scale(u1, -1), u2) >= 0 ? 1 : -1;
    const dir = rotate(scale(u1, -1), sgn * spec.angle);
    const hit = lineLine(P1, dir, X, u2);
    if (!hit || hit.u <= 0) return null;
    P2 = hit.point;
  } else P2 = add(X, scale(u2, spec.d2));
  const n1 = mode !== "none" ? lineTo(e1, X, u1, P1) : e1;
  const n2 = mode === "both" ? lineTo(e2, X, u2, P2) : e2;
  if (!n1 || !n2) return null;
  const out = none();
  if (mode !== "none") out.replace.push(n1);
  if (mode === "both") out.replace.push(n2);
  if (dist(P1, P2) > 1e-9) out.add.push({ id: newId(), ...base(e1), kind: "line", a: P1, b: P2 });
  return out;
}
