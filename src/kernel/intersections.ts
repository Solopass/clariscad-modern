// Intersections between primitives. Line/line, line/circle, circle/circle and
// line/ellipse are solved in closed form. Everything else (ellipse/arc,
// ellipse/ellipse, anything with a spline) starts from the flattened
// polylines and is polished with Newton's method to ~1e-12.
import type { Entity } from "./types";
import {
  type ArcPrim,
  type EllPrim,
  type Prim,
  type PrimContext,
  flattenPrim,
  primBBox,
  primContains,
  primDeriv,
  primParamOf,
  primPoint,
  primRange,
  toPrims,
} from "./prims";
import { type Vec2, EPS, add, cross, dist, dot, len, rotate, scale, sub } from "./vec";

export interface Hit {
  point: Vec2;
  /** Parameter on the first primitive. */
  u1: number;
  /** Parameter on the second primitive. */
  u2: number;
}

export interface IntersectOptions {
  /** Treat segments as infinite lines and arcs/elliptical arcs as full curves (apparent intersections). */
  extend?: boolean;
  eps?: number;
}

// ---------------------------------------------------------------- closed-form kernels

/** Infinite lines p1 + t·d1 and p2 + u·d2. Null if parallel. */
export function lineLine(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): { t: number; u: number; point: Vec2 } | null {
  const den = cross(d1, d2);
  if (Math.abs(den) <= 1e-14 * len(d1) * len(d2)) return null;
  const w = sub(p2, p1);
  const t = cross(w, d2) / den;
  const u = cross(w, d1) / den;
  return { t, u, point: add(p1, scale(d1, t)) };
}

/** Line p + t·d against circle (c, r). Returns line parameters; one value when tangent. */
export function lineCircle(p: Vec2, d: Vec2, c: Vec2, r: number, eps = EPS): number[] {
  const a = dot(d, d);
  if (a === 0) return [];
  const t0 = dot(sub(c, p), d) / a;
  const foot = add(p, scale(d, t0));
  const h = dist(foot, c);
  if (h > r + eps) return [];
  if (Math.abs(h - r) <= eps) return [t0];
  const half = Math.sqrt(r * r - h * h) / Math.sqrt(a);
  return [t0 - half, t0 + half];
}

/** Two circles. Returns 0, 1 (tangent) or 2 points; none for concentric circles. */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number, eps = EPS): Vec2[] {
  const d = dist(c1, c2);
  if (d <= eps) return [];
  if (d > r1 + r2 + eps || d < Math.abs(r1 - r2) - eps) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const ux = (c2.x - c1.x) / d;
  const uy = (c2.y - c1.y) / d;
  const base = { x: c1.x + ux * a, y: c1.y + uy * a };
  if (h2 <= eps * Math.max(1, r1)) return [base];
  const h = Math.sqrt(h2);
  return [
    { x: base.x - uy * h, y: base.y + ux * h },
    { x: base.x + uy * h, y: base.y - ux * h },
  ];
}

/** Line p + t·d against a full ellipse. Solved exactly by mapping the ellipse to the unit circle. */
export function lineEllipse(p: Vec2, d: Vec2, e: Pick<EllPrim, "c" | "rx" | "ry" | "rot">, eps = EPS): number[] {
  const toUnit = (v: Vec2) => {
    const r = rotate(v, -e.rot);
    return { x: r.x / e.rx, y: r.y / e.ry };
  };
  const pu = toUnit(sub(p, e.c));
  const du = toUnit(d);
  return lineCircle(pu, du, { x: 0, y: 0 }, 1, eps / Math.min(e.rx, e.ry));
}

// ---------------------------------------------------------------- prim × prim

const isLineLike = (p: Prim): p is Extract<Prim, { t: "seg" } | { t: "xline" }> => p.t === "seg" || p.t === "xline";
const lineOf = (p: Extract<Prim, { t: "seg" } | { t: "xline" }>) =>
  p.t === "seg" ? { o: p.a, d: sub(p.b, p.a) } : { o: p.p, d: p.d };

function accept(p: Prim, u: number, opts: IntersectOptions): boolean {
  if (opts.extend && p.t !== "curve") return true;
  return primContains(p, u, opts.eps ?? EPS);
}

function dedupe(hits: Hit[], tol: number): Hit[] {
  const out: Hit[] = [];
  for (const h of hits) if (!out.some((o) => dist(o.point, h.point) <= tol)) out.push(h);
  return out;
}

export function intersectPrims(A: Prim, B: Prim, opts: IntersectOptions = {}): Hit[] {
  const eps = opts.eps ?? EPS;
  // Keep line-like primitives first so each pair has one code path.
  if (!isLineLike(A) && isLineLike(B)) return intersectPrims(B, A, opts).map((h) => ({ point: h.point, u1: h.u2, u2: h.u1 }));

  if (isLineLike(A)) {
    const la = lineOf(A);
    if (isLineLike(B)) {
      const lb = lineOf(B);
      const r = lineLine(la.o, la.d, lb.o, lb.d);
      if (!r) return [];
      return accept(A, r.t, opts) && accept(B, r.u, opts) ? [{ point: r.point, u1: r.t, u2: r.u }] : [];
    }
    if (B.t === "arc") {
      const out: Hit[] = [];
      for (const t of lineCircle(la.o, la.d, B.c, B.r, eps)) {
        const point = add(la.o, scale(la.d, t));
        const u = primParamOf(B, point);
        if (accept(A, t, opts) && accept(B, u, opts)) out.push({ point, u1: t, u2: u });
      }
      return out;
    }
    if (B.t === "ell") {
      const out: Hit[] = [];
      for (const t of lineEllipse(la.o, la.d, B, eps)) {
        const point = add(la.o, scale(la.d, t));
        const u = primParamOf(B, point);
        if (accept(A, t, opts) && accept(B, u, opts)) out.push({ point, u1: t, u2: u });
      }
      return out;
    }
    return lineCurve(A, la.o, la.d, B, opts);
  }

  if (A.t === "arc" && B.t === "arc") {
    const out: Hit[] = [];
    for (const point of circleCircle(A.c, A.r, B.c, B.r, eps)) {
      const u1 = primParamOf(A, point);
      const u2 = primParamOf(B, point);
      if (accept(A, u1, opts) && accept(B, u2, opts)) out.push({ point, u1, u2 });
    }
    return out;
  }

  return curveCurve(A, B, opts);
}

/** Prim with sweep limits removed (for apparent intersections). */
function extended(p: Prim): Prim {
  if (p.t === "arc" || p.t === "ell") return { ...p, start: 0, sweep: Math.PI * 2 } as ArcPrim | EllPrim;
  return p;
}

function sizeOf(p: Prim): number {
  const b = primBBox(p);
  return b ? Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9) : 1;
}

/** Line against a free-form curve: seed on the flattened polyline, then 1D Newton on cross(B(t)-o, d) = 0. */
function lineCurve(A: Prim, o: Vec2, d: Vec2, B: Prim, opts: IntersectOptions): Hit[] {
  const target = opts.extend ? extended(B) : B;
  const { pts, params } = flattenPrim(target, sizeOf(target) * 1e-4);
  const g = (t: number) => cross(sub(primPoint(target, t), o), d);
  const [lo, hi] = primRange(target);
  const seeds: number[] = [];
  const dd = dot(d, d);
  const nearTol = 2e-4 * Math.max(1, sizeOf(target)) * Math.sqrt(dd);
  for (let i = 0; i + 1 < pts.length; i++) {
    const g0 = cross(sub(pts[i], o), d);
    const g1 = cross(sub(pts[i + 1], o), d);
    if (g0 === 0 || g0 * g1 < 0 || (i + 2 === pts.length && g1 === 0)) seeds.push(params[i] + (params[i + 1] - params[i]) * (g0 / (g0 - g1 || 1)));
    else if (Math.abs(g0) < nearTol || Math.abs(g1) < nearTol) seeds.push((params[i] + params[i + 1]) / 2);
  }
  const out: Hit[] = [];
  for (let t of seeds) {
    for (let it = 0; it < 40; it++) {
      const gt = g(t);
      const dg = cross(primDeriv(target, t), d);
      if (Math.abs(dg) < 1e-12 * Math.max(1, sizeOf(target)) * Math.sqrt(dd)) {
        // Tangent touch (double root): golden-section on |g(t)| in a narrow bracket.
        let a = Math.max(lo, t - (hi - lo) * 1e-3);
        let b = Math.min(hi, t + (hi - lo) * 1e-3);
        const phi = (Math.sqrt(5) - 1) / 2;
        let x1 = b - phi * (b - a);
        let x2 = a + phi * (b - a);
        let f1 = Math.abs(g(x1));
        let f2 = Math.abs(g(x2));
        for (let k = 0; k < 50; k++) {
          if (f1 < f2) {
            b = x2;
            x2 = x1;
            f2 = f1;
            x1 = b - phi * (b - a);
            f1 = Math.abs(g(x1));
          } else {
            a = x1;
            x1 = x2;
            f1 = f2;
            x2 = a + phi * (b - a);
            f2 = Math.abs(g(x2));
          }
        }
        t = (a + b) / 2;
        break;
      }
      const next = Math.min(hi, Math.max(lo, t - gt / dg));
      if (Math.abs(next - t) < 1e-15) break;
      t = next;
    }
    const point = primPoint(target, t);
    if (Math.abs(g(t)) / Math.sqrt(dd) > 1e-8 * Math.max(1, sizeOf(target))) continue;
    const s = dot(sub(point, o), d) / dd;
    if (accept(A, s, opts) && (opts.extend || primContains(target, t, opts.eps ?? EPS))) out.push({ point, u1: s, u2: t });
  }
  return dedupe(out, 1e-7 * Math.max(1, sizeOf(target)));
}

function segSegParams(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): [number, number] | null {
  const r = lineLine(a0, sub(a1, a0), b0, sub(b1, b0));
  if (!r) return null;
  const tol = 1e-9;
  return r.t >= -tol && r.t <= 1 + tol && r.u >= -tol && r.u <= 1 + tol ? [r.t, r.u] : null;
}

/** Curve against curve: polyline seeds polished by 2D Newton on A(s) - B(t) = 0. */
function curveCurve(A0: Prim, B0: Prim, opts: IntersectOptions): Hit[] {
  const A = opts.extend ? extended(A0) : A0;
  const B = opts.extend ? extended(B0) : B0;
  const scaleLen = Math.max(sizeOf(A), sizeOf(B));
  const fa = flattenPrim(A, sizeOf(A) * 1e-4);
  const fb = flattenPrim(B, sizeOf(B) * 1e-4);
  const ba = primBBox(A);
  const bb = primBBox(B);
  if (ba && bb && (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY)) return [];

  const seeds: [number, number][] = [];
  const nearDist = 4e-4 * Math.max(1, scaleLen);
  for (let i = 0; i + 1 < fa.pts.length; i++) {
    const a0 = fa.pts[i];
    const a1 = fa.pts[i + 1];
    const minAx = Math.min(a0.x, a1.x) - nearDist;
    const maxAx = Math.max(a0.x, a1.x) + nearDist;
    const minAy = Math.min(a0.y, a1.y) - nearDist;
    const maxAy = Math.max(a0.y, a1.y) + nearDist;
    for (let j = 0; j + 1 < fb.pts.length; j++) {
      const b0 = fb.pts[j];
      const b1 = fb.pts[j + 1];
      if (maxAx < Math.min(b0.x, b1.x) || Math.max(b0.x, b1.x) < minAx) continue;
      if (maxAy < Math.min(b0.y, b1.y) || Math.max(b0.y, b1.y) < minAy) continue;
      const st = segSegParams(a0, a1, b0, b1);
      if (st)
        seeds.push([
          fa.params[i] + (fa.params[i + 1] - fa.params[i]) * st[0],
          fb.params[j] + (fb.params[j + 1] - fb.params[j]) * st[1],
        ]);
      else if (dist(a0, b0) < nearDist || dist(a1, b1) < nearDist)
        seeds.push([(fa.params[i] + fa.params[i + 1]) / 2, (fb.params[j] + fb.params[j + 1]) / 2]);
    }
  }

  const [alo, ahi] = primRange(A);
  const [blo, bhi] = primRange(B);
  const clampA = (s: number) => (A.t === "curve" ? Math.min(ahi, Math.max(alo, s)) : s);
  const clampB = (t: number) => (B.t === "curve" ? Math.min(bhi, Math.max(blo, t)) : t);
  const out: Hit[] = [];
  for (let [s, t] of seeds) {
    let lambda = 1e-10;
    for (let it = 0; it < 50; it++) {
      const F = sub(primPoint(A, s), primPoint(B, t));
      const err2 = F.x * F.x + F.y * F.y;
      if (err2 < 1e-24) break;
      const da = primDeriv(A, s);
      const db = primDeriv(B, t);
      const det = -da.x * db.y + da.y * db.x;
      let ds: number;
      let dt: number;
      if (Math.abs(det) > 1e-10 * Math.max(1, scaleLen * scaleLen)) {
        ds = (-F.x * -db.y - -db.x * -F.y) / det;
        dt = (da.x * -F.y - da.y * -F.x) / det;
      } else {
        // Damped Gauss-Newton (Levenberg-Marquardt) for tangent touches.
        const j00 = da.x * da.x + da.y * da.y + lambda;
        const j11 = db.x * db.x + db.y * db.y + lambda;
        const j01 = -(da.x * db.x + da.y * db.y);
        const g0 = da.x * F.x + da.y * F.y;
        const g1 = -(db.x * F.x + db.y * F.y);
        const hdet = j00 * j11 - j01 * j01;
        if (hdet === 0) break;
        ds = -(g0 * j11 - g1 * j01) / hdet;
        dt = -(j00 * g1 - j01 * g0) / hdet;
        const ns = clampA(s + ds);
        const nt = clampB(t + dt);
        const nF = sub(primPoint(A, ns), primPoint(B, nt));
        if (nF.x * nF.x + nF.y * nF.y < err2) lambda = Math.max(1e-14, lambda * 0.3);
        else {
          lambda *= 10;
          continue;
        }
      }
      s = clampA(s + ds);
      t = clampB(t + dt);
      if (Math.abs(ds) + Math.abs(dt) < 1e-15) break;
    }
    const pa = primPoint(A, s);
    if (dist(pa, primPoint(B, t)) > 1e-8 * Math.max(1, scaleLen)) continue;
    if (!opts.extend && (!primContains(A0, s, opts.eps ?? EPS) || !primContains(B0, t, opts.eps ?? EPS))) continue;
    out.push({ point: pa, u1: s, u2: t });
  }
  return dedupe(out, 1e-7 * Math.max(1, scaleLen));
}

// ---------------------------------------------------------------- entity level

export function intersectEntities(a: Entity, b: Entity, opts: IntersectOptions = {}, ctx?: PrimContext): Vec2[] {
  const pa = toPrims(a, ctx);
  const pb = toPrims(b, ctx);
  const pts: Vec2[] = [];
  for (const x of pa) for (const y of pb) for (const h of intersectPrims(x, y, opts)) pts.push(h.point);
  const out: Vec2[] = [];
  for (const p of pts) if (!out.some((o) => dist(o, p) <= 1e-7)) out.push(p);
  return out;
}
