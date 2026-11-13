// Construction math behind the drawing Methods (pure functions, no state).
import type { Prim } from "./prims";
import { closestOnPrim, primDeriv } from "./prims";
import { intersectPrims } from "./intersections";
import { type Vec2, TAU, add, angleOf, cross, dist, fromAngle, mid, normalize, normAngle, perp, rotate, scale, sub } from "./vec";

export interface Circle {
  center: Vec2;
  r: number;
}

/** Circle through two diameter end points. */
export function circle2P(a: Vec2, b: Vec2): Circle {
  return { center: mid(a, b), r: dist(a, b) / 2 };
}

/** Circle through three points; null if they are collinear. */
export function circle3P(a: Vec2, b: Vec2, c: Vec2): Circle | null {
  // Work relative to `a` so points far from the origin keep their precision.
  const B = sub(b, a);
  const C = sub(c, a);
  const d = 2 * cross(B, C);
  if (Math.abs(d) < 1e-12 * Math.max(1e-300, dist(a, b) * dist(b, c))) return null;
  const b2 = B.x * B.x + B.y * B.y;
  const c2 = C.x * C.x + C.y * C.y;
  const rel = { x: (C.y * b2 - B.y * c2) / d, y: (B.x * c2 - C.x * b2) / d };
  return { center: add(a, rel), r: Math.hypot(rel.x, rel.y) };
}

export interface ArcDef {
  center: Vec2;
  r: number;
  /** CCW start and end angles. */
  start: number;
  end: number;
}

/** Arc from start through `through` to end. */
export function arc3P(start: Vec2, through: Vec2, end: Vec2): ArcDef | null {
  const c = circle3P(start, through, end);
  if (!c) return null;
  const a0 = angleOf(sub(start, c.center));
  const a1 = angleOf(sub(end, c.center));
  const ccw = cross(sub(through, start), sub(end, through)) > 0;
  return ccw
    ? { center: c.center, r: c.r, start: normAngle(a0), end: normAngle(a1) }
    : { center: c.center, r: c.r, start: normAngle(a1), end: normAngle(a0) };
}

/**
 * Arc that leaves `origin` traveling along `tangent` and ends at `end`.
 * The stored arc is CCW; when the tangent walk is clockwise the same curve
 * is stored from `end` back to `origin`. Null when the end lies on the tangent line.
 */
export function arcFromTangent(origin: Vec2, tangent: Vec2, end: Vec2): ArcDef | null {
  const lenT = Math.hypot(tangent.x, tangent.y);
  if (lenT < 1e-12) return null;
  let T = { x: tangent.x / lenT, y: tangent.y / lenT };
  const D = sub(end, origin);
  const len2 = D.x * D.x + D.y * D.y;
  if (len2 < 1e-18) return null;
  // Leave toward the end, not away from it.
  if (D.x * T.x + D.y * T.y < 0) T = { x: -T.x, y: -T.y };
  const N = perp(T);
  const dn = D.x * N.x + D.y * N.y;
  if (Math.abs(dn) < 1e-9 * Math.sqrt(len2)) return null;
  const rSigned = len2 / (2 * dn);
  const center = add(origin, scale(N, rSigned));
  const r = Math.abs(rSigned);
  if (!(r > 1e-9)) return null;
  const startAng = normAngle(angleOf(sub(origin, center)));
  const endAng = normAngle(angleOf(sub(end, center)));
  if (rSigned >= 0) return startAng === endAng ? null : { center, r, start: startAng, end: endAng };
  return startAng === endAng ? null : { center, r, start: endAng, end: startAng };
}

/** Unit tangent of a primitive at the point on it nearest `p`. */
export function tangentAt(prim: Prim, p: Vec2): { point: Vec2; dir: Vec2 } | null {
  const h = closestOnPrim(prim, p);
  const d = primDeriv(prim, h.u);
  const len = Math.hypot(d.x, d.y);
  if (!(len > 1e-12)) return null;
  return { point: h.point, dir: { x: d.x / len, y: d.y / len } };
}

/**
 * Arc from start to end with a given radius. Positive radius = the minor arc
 * running CCW from start to end; `major` picks the long way round.
 */
export function arcStartEndRadius(start: Vec2, end: Vec2, r: number, major = false): ArcDef | null {
  const chord = dist(start, end);
  if (chord === 0 || chord > 2 * r + 1e-12) return null;
  const h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));
  const m = mid(start, end);
  const n = perp(normalize(sub(end, start)));
  // Centre on the left of start→end gives a CCW minor arc.
  const center = add(m, scale(n, major ? -h : h));
  return { center, r, start: normAngle(angleOf(sub(start, center))), end: normAngle(angleOf(sub(end, center))) };
}

/**
 * Regular polygon vertices.
 *  inscribed:     `p` is a vertex (Center-Vertex).
 *  circumscribed: `p` is the midpoint of a side (Center-Side).
 */
export function regularPolygon(center: Vec2, p: Vec2, sides: number, mode: "inscribed" | "circumscribed" = "inscribed"): Vec2[] {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  let r = dist(center, p);
  let a0 = angleOf(sub(p, center));
  if (mode === "circumscribed") {
    r = r / Math.cos(Math.PI / n);
    a0 += Math.PI / n;
  }
  return Array.from({ length: n }, (_, i) => add(center, fromAngle(a0 + (TAU * i) / n, r)));
}

/** Regular polygon from one edge (a → b), built on the left of the edge. */
export function regularPolygonFromEdge(a: Vec2, b: Vec2, sides: number): Vec2[] {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const out = [a, b];
  const turn = TAU / n;
  for (let i = 2; i < n; i++) {
    const p = out[i - 1];
    const q = out[i - 2];
    out.push(add(p, rotate(sub(p, q), turn)));
  }
  return out;
}

/** Rectangle from a base edge (a → b) and a third point giving the height. Returns 4 corners. */
export function rect3P(a: Vec2, b: Vec2, c: Vec2): Vec2[] {
  const u = normalize(sub(b, a));
  const n = perp(u);
  const h = cross(u, sub(c, a));
  const off = scale(n, h);
  return [a, b, add(b, off), add(a, off)];
}

/** Lines/circles shifted by r on each side: centres of radius-r circles tangent to `p` lie on them. */
function offsetsForTangency(p: Prim, r: number): Prim[] {
  if (p.t === "seg" || p.t === "xline") {
    const o = p.t === "seg" ? p.a : p.p;
    const d = normalize(p.t === "seg" ? sub(p.b, p.a) : p.d);
    const n = perp(d);
    return [
      { t: "xline", p: add(o, scale(n, r)), d },
      { t: "xline", p: add(o, scale(n, -r)), d },
    ];
  }
  if (p.t === "arc") {
    const out: Prim[] = [{ t: "arc", c: p.c, r: p.r + r, start: 0, sweep: TAU }];
    if (Math.abs(p.r - r) > 1e-12) out.push({ t: "arc", c: p.c, r: Math.abs(p.r - r), start: 0, sweep: TAU });
    return out;
  }
  return [];
}

export interface TangentCircle extends Circle {
  t1: Vec2;
  t2: Vec2;
}

/** All radius-r circles tangent to both primitives (lines/segments and circles/arcs). Tangent points may lie on extensions. */
export function tangentTangentRadius(p1: Prim, p2: Prim, r: number): TangentCircle[] {
  const out: TangentCircle[] = [];
  for (const o1 of offsetsForTangency(p1, r))
    for (const o2 of offsetsForTangency(p2, r))
      for (const h of intersectPrims(o1, o2)) {
        if (out.some((c) => dist(c.center, h.point) < 1e-9)) continue;
        const full = (p: Prim): Prim => (p.t === "seg" ? { t: "xline", p: p.a, d: normalize(sub(p.b, p.a)) } : p.t === "arc" ? { ...p, start: 0, sweep: TAU } : p);
        out.push({ center: h.point, r, t1: closestOnPrim(full(p1), h.point).point, t2: closestOnPrim(full(p2), h.point).point });
      }
  return out;
}
