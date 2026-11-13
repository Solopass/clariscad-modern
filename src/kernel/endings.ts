// Arrow, tick and dot caps for open paths. Sizes are model millimetres
// (paper millimetres × the layer scale), the same convention as dimension arrows.
import type { Entity, LineEnding } from "./types";
import { type Prim, primDeriv, splinePrim } from "./prims";
import { type PathSeg, endOf, startOf, toPath } from "./path";
import { type Vec2, add, dist, normalize, perp, scale, sub } from "./vec";

export interface PathEnd {
  at: "start" | "end";
  tip: Vec2;
  /** Unit direction the cap points: out of the object, away along the path. */
  dir: Vec2;
}

const unit = (v: Vec2): Vec2 | null => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-12 ? { x: v.x / l, y: v.y / l } : null;
};

/** Walk direction of a path segment at its start (atEnd false) or end. */
function travel(seg: PathSeg, atEnd: boolean): Vec2 | null {
  const p = seg.prim;
  if (p.t === "seg") return unit(sub(p.b, p.a));
  const u = atEnd ? (seg.reversed ? p.start : p.start + p.sweep) : seg.reversed ? p.start + p.sweep : p.start;
  const tang = primDeriv(p as Prim, u);
  const dir = unit(tang);
  if (!dir) return null;
  return seg.reversed ? scale(dir, -1) : dir;
}

/** The two open ends of an entity, if it has any. Closed shapes return none. */
export function pathEnds(e: Entity): PathEnd[] {
  if (e.kind === "line") {
    const d = unit(sub(e.b, e.a));
    if (!d || dist(e.a, e.b) === 0) return [];
    return [
      { at: "start", tip: e.a, dir: scale(d, -1) },
      { at: "end", tip: e.b, dir: d },
    ];
  }
  if (e.kind === "spline" && !e.closed) {
    const prim = splinePrim(e);
    if (!prim) return [];
    const d0 = unit(primDeriv(prim, prim.u0));
    const d1 = unit(primDeriv(prim, prim.u1));
    if (!d0 || !d1) return [];
    return [
      { at: "start", tip: prim.ev(prim.u0), dir: scale(d0, -1) },
      { at: "end", tip: prim.ev(prim.u1), dir: d1 },
    ];
  }
  const path = toPath(e);
  if (!path || path.closed || !path.segs.length) return [];
  const a = path.segs[0];
  const b = path.segs[path.segs.length - 1];
  const d0 = travel(a, false);
  const d1 = travel(b, true);
  if (!d0 || !d1) return [];
  return [
    { at: "start", tip: startOf(a), dir: scale(d0, -1) },
    { at: "end", tip: endOf(b), dir: d1 },
  ];
}

export function endingKind(e: Entity, at: "start" | "end"): LineEnding | undefined {
  return at === "start" ? e.style?.startEnding : e.style?.endEnding;
}

/** Polygon for a filled cap (arrow or dot). Open arrows and ticks are two-point strokes; those return a polyline of 2. */
export function endingOutline(tip: Vec2, dir: Vec2, kind: LineEnding, size: number): { fill: boolean; pts: Vec2[] } {
  const d = normalize(dir);
  const n = perp(d);
  const back = add(tip, scale(d, -size));
  if (kind === "arrow") return { fill: true, pts: [tip, add(back, scale(n, size / 3)), add(back, scale(n, -size / 3))] };
  if (kind === "open") return { fill: false, pts: [add(back, scale(n, size / 3)), tip, add(back, scale(n, -size / 3))] };
  if (kind === "tick") {
    const t = normalize(add(d, n));
    return { fill: false, pts: [add(tip, scale(t, -size / 2)), add(tip, scale(t, size / 2))] };
  }
  const r = size / 3;
  return { fill: true, pts: Array.from({ length: 10 }, (_, i) => add(tip, { x: r * Math.cos((i * Math.PI * 2) / 10), y: r * Math.sin((i * Math.PI * 2) / 10) })) };
}
