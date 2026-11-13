// Smart walls: clean junctions across the whole drawing.
//
//  L corner  – two walls share an endpoint: their faces run to where they meet (mitre), no caps.
//  T join    – a wall's end lies inside another wall's band: its faces run to that wall's
//              near face, which gets a gap between them. No cap.
//  X cross   – walls pass through each other: each wall's faces are removed inside the other band.
//  Openings  – faces are removed over [at - w/2, at + w/2] and closed with jamb lines.
//
// Each face is a line a + d·u + n·o (u along the wall, o the face offset). We find each
// face's [u0, u1] from the end conditions, subtract the intervals that lie inside other
// walls' bands, and emit the remaining pieces plus caps and jambs as segments.
import type { Id, WallEntity, WallOpening } from "./types";
import type { Transform2D } from "./transform";
import { type Prim, bandOffsets } from "./prims";
import { lineLine } from "./intersections";
import { type Vec2, add, cross, dist, dot, normalize, perp, scale, sub } from "./vec";

const EPS = 1e-6;
/** sin(φ/2) below which an L corner is capped instead of mitred (φ ≈ 29°). The mitre then reaches at most 2× the thickness. */
export const MITRE_LIMIT = 0.25;

interface W {
  e: WallEntity;
  a: Vec2;
  b: Vec2;
  d: Vec2;
  n: Vec2;
  len: number;
  off: [number, number];
}

const prep = (e: WallEntity): W | null => {
  const len = dist(e.a, e.b);
  if (len < EPS) return null;
  const d = normalize(sub(e.b, e.a));
  return { e, a: e.a, b: e.b, d, n: perp(d), len, off: bandOffsets(e.thickness, e.justify) };
};

const facePoint = (w: W, o: number, u: number) => add(add(w.a, scale(w.d, u)), scale(w.n, o));
/** Wall-local coordinates of a point: along (u) and across (o). */
const local = (w: W, p: Vec2) => ({ u: dot(sub(p, w.a), w.d), o: dot(sub(p, w.a), w.n) });

/** u on W's face (offset o) where it meets the line through q with direction dir. */
function faceMeet(w: W, o: number, q: Vec2, dir: Vec2): number | null {
  const hit = lineLine(facePoint(w, o, 0), w.d, q, dir);
  return hit ? hit.t : null;
}

type End = { cap: boolean; u: [number, number]; reach: number };

/** End condition of wall `w` at its start (atB = false) or end (atB = true). */
function endCondition(w: W, atB: boolean, all: W[]): End {
  const P = atB ? w.b : w.a;
  const uEnd = atB ? w.len : 0;
  const plain: End = { cap: true, u: [uEnd, uEnd], reach: uEnd };

  // L corner: exactly one other wall ends here.
  const sharers = all.filter((v) => v !== w && (dist(v.a, P) < EPS || dist(v.b, P) < EPS));
  if (sharers.length === 1) {
    const v = sharers[0];
    const vAtB = dist(v.b, P) < EPS;
    const dW = atB ? scale(w.d, -1) : w.d; // away from the joint
    const dV = vAtB ? scale(v.d, -1) : v.d;
    if (Math.abs(cross(dW, dV)) < 1e-9) return { cap: false, u: [uEnd, uEnd], reach: uEnd }; // collinear: butt joint
    // Very sharp corners would mitre far past the walls: cap them square instead.
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(dW, dV))));
    if (Math.sin(phi / 2) < MITRE_LIMIT) return plain;
    // Side of each face relative to the away direction (left positive).
    const sideW = (o: number) => (atB ? -o : o);
    const sideV = (o: number) => (vAtB ? -o : o);
    const vFaces = [...v.off].sort((x, y) => sideV(x) - sideV(y)); // right → left
    const u: [number, number] = [uEnd, uEnd];
    for (let k = 0; k < 2; k++) {
      const o = w.off[k];
      // W's leftmost face meets V's rightmost and vice versa.
      const isLeft = sideW(o) >= sideW(w.off[1 - k]);
      const ov = isLeft ? vFaces[0] : vFaces[1];
      const t = faceMeet(w, o, facePoint(v, ov, 0), v.d);
      u[k] = t ?? uEnd;
    }
    return { cap: false, u, reach: uEnd };
  }
  if (sharers.length > 1) return { cap: false, u: [uEnd, uEnd], reach: uEnd };

  // T join: P inside another wall's band (not at its ends).
  for (const v of all) {
    if (v === w) continue;
    const { u: uv, o: ov } = local(v, P);
    const [lo, hi] = v.off;
    if (uv <= EPS || uv >= v.len - EPS || ov < lo - EPS || ov > hi + EPS) continue;
    if (Math.abs(cross(w.d, v.d)) < 1e-9) continue;
    // The near face is the one on the side where the rest of W lies.
    const far = atB ? w.a : w.b;
    const of = local(v, far).o;
    const near = of >= (lo + hi) / 2 ? hi : lo;
    const u: [number, number] = [uEnd, uEnd];
    for (let k = 0; k < 2; k++) u[k] = faceMeet(w, w.off[k], facePoint(v, near, 0), v.d) ?? uEnd;
    // For cutting V's near face, W's band reaches V's middle line.
    const reach = faceMeet(w, (w.off[0] + w.off[1]) / 2, facePoint(v, (lo + hi) / 2, 0), v.d) ?? uEnd;
    return { cap: false, u, reach };
  }
  return plain;
}

/** Interval of u on W's face line (offset o) strictly inside V's band [ua, ub] × [lo, hi]. */
function insideBand(w: W, o: number, v: W, ua: number, ub: number): [number, number] | null {
  const p0 = facePoint(w, o, 0);
  // Clip the line p0 + w.d·t against the 4 half-planes of V's band, shrunk by EPS.
  let t0 = -Infinity;
  let t1 = Infinity;
  const clip = (dirComp: number, posComp: number, min: number, max: number) => {
    if (Math.abs(dirComp) < 1e-12) return posComp > min + EPS && posComp < max - EPS;
    let a = (min - posComp) / dirComp;
    let b = (max - posComp) / dirComp;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return true;
  };
  const lp = local(v, p0);
  if (!clip(dot(w.d, v.d), lp.u, ua, ub)) return null;
  if (!clip(dot(w.d, v.n), lp.o, v.off[0], v.off[1])) return null;
  return t1 > t0 ? [t0, t1] : null;
}

function subtract(ranges: [number, number][], cut: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of ranges) {
    if (cut[1] <= a || cut[0] >= b) out.push([a, b]);
    else {
      if (cut[0] > a) out.push([a, cut[0]]);
      if (cut[1] < b) out.push([cut[1], b]);
    }
  }
  return out.filter(([a, b]) => b - a > EPS);
}

export interface WallSolve {
  prims: Prim[];
  /** Solid parts of the wall as closed outlines (openings left out), for fills. */
  fill: Vec2[][];
  /** Symbol frame per opening: x along the wall (hinge side flips it), y across (swing side flips it). */
  frames: { opening: WallOpening; T: Transform2D }[];
}

/** Solve every wall. */
export function solveWalls(walls: WallEntity[]): Map<Id, WallSolve> {
  const ws = walls.map(prep).filter((w): w is W => !!w);
  const ends = new Map<W, [End, End]>();
  for (const w of ws) ends.set(w, [endCondition(w, false, ws), endCondition(w, true, ws)]);
  const out = new Map<Id, WallSolve>();

  for (const w of ws) {
    const [s, e] = ends.get(w)!;
    const prims: Prim[] = [];
    for (let k = 0; k < 2; k++) {
      const o = w.off[k];
      // A face whose corners cross (very short wall between two mitres) has nothing to draw.
      let ranges: [number, number][] = e.u[k] - s.u[k] > EPS ? [[s.u[k], e.u[k]]] : [];
      for (const v of ws) {
        if (v === w) continue;
        const [vs, ve] = ends.get(v)!;
        const cut = insideBand(w, o, v, Math.min(vs.reach, 0), Math.max(ve.reach, v.len));
        if (cut) ranges = subtract(ranges, cut);
      }
      for (const op of w.e.openings ?? []) ranges = subtract(ranges, [op.at - op.width / 2, op.at + op.width / 2]);
      for (const [a, b] of ranges) prims.push({ t: "seg", a: facePoint(w, o, a), b: facePoint(w, o, b) });
    }
    if (s.cap) prims.push({ t: "seg", a: facePoint(w, w.off[0], 0), b: facePoint(w, w.off[1], 0) });
    if (e.cap) prims.push({ t: "seg", a: facePoint(w, w.off[0], w.len), b: facePoint(w, w.off[1], w.len) });
    for (const op of w.e.openings ?? [])
      for (const u of [op.at - op.width / 2, op.at + op.width / 2])
        if (u > 0 && u < w.len) prims.push({ t: "seg", a: facePoint(w, w.off[0], u), b: facePoint(w, w.off[1], u) });
    out.set(w.e.id, { prims, fill: fillOutlines(w, s, e), frames: openingFrames(w) });
  }
  return out;
}

/** The band between the (mitred) faces, cut into pieces at openings. */
function fillOutlines(w: W, s: End, e: End): Vec2[][] {
  const gaps = (w.e.openings ?? []).map((o) => [o.at - o.width / 2, o.at + o.width / 2] as [number, number]).sort((x, y) => x[0] - y[0]);
  const bounds: [number, number][] = [];
  let from = -Infinity;
  for (const [g0, g1] of gaps) {
    if (g0 > from) bounds.push([from, g0]);
    from = Math.max(from, g1);
  }
  bounds.push([from, Infinity]);
  const out: Vec2[][] = [];
  for (const [lo, hi] of bounds) {
    let r0: [number, number] = [Math.max(s.u[0], lo), Math.min(e.u[0], hi)];
    let r1: [number, number] = [Math.max(s.u[1], lo), Math.min(e.u[1], hi)];
    const ok0 = r0[1] - r0[0] > EPS;
    const ok1 = r1[1] - r1[0] > EPS;
    if (!ok0 && !ok1) continue;
    // One face has no length here (a mitre ends inside this piece): pinch it to a point
    // so the outline stays a simple shape instead of crossing itself.
    if (!ok0) r0 = [clamp(r0[1], r1[0], r1[1]), clamp(r0[1], r1[0], r1[1])];
    if (!ok1) r1 = [clamp(r1[1], r0[0], r0[1]), clamp(r1[1], r0[0], r0[1])];
    out.push([facePoint(w, w.off[0], r0[0]), facePoint(w, w.off[0], r0[1]), facePoint(w, w.off[1], r1[1]), facePoint(w, w.off[1], r1[0])]);
  }
  return out;
}

function openingFrames(w: W): { opening: WallOpening; T: Transform2D }[] {
  const mid = (w.off[0] + w.off[1]) / 2;
  return (w.e.openings ?? [])
    .filter((o) => o.symbolId)
    .map((o) => {
      const c = facePoint(w, mid, o.at);
      const x = o.hingeFlip ? scale(w.d, -1) : w.d;
      const y = o.swingFlip ? scale(w.n, -1) : w.n;
      return { opening: o, T: { a: x.x, b: x.y, c: y.x, d: y.y, e: c.x, f: c.y } };
    });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Centre for a new opening of `width` near distance `along` on the wall: kept clear of
 * the wall ends by half the thickness (so it never runs into a corner joint) and of
 * other openings. Null if it does not fit.
 */
export function fitOpening(w: WallEntity, along: number, width: number): number | null {
  const len = dist(w.a, w.b);
  const lo = width / 2 + w.thickness / 2;
  const hi = len - width / 2 - w.thickness / 2;
  if (hi < lo) return null;
  const at = clamp(along, lo, hi);
  const clash = (w.openings ?? []).some((o) => Math.abs(o.at - at) < (o.width + width) / 2 - 1e-9);
  return clash ? null : at;
}

/** Distance along a wall to the point nearest `p`, clamped to the wall. */
export function wallParam(w: WallEntity, p: Vec2): number {
  const len = dist(w.a, w.b);
  if (len === 0) return 0;
  return Math.max(0, Math.min(len, dot(sub(p, w.a), normalize(sub(w.b, w.a)))));
}
