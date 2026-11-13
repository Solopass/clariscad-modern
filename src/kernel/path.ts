// Path model for trim / split / extend / offset. A path is a chain of
// segments and arcs (or one elliptical arc) walked in one direction, with a
// global parameter s ∈ [0, n]: segment i covers [i, i+1]. Pieces of a path
// are rebuilt into ordinary entities.
import type { Entity, Id, StyleRef } from "./types";
import { type ArcPrim, type EllPrim, type SegPrim, bulgeArc, closestOnPrim, primPoint, rectCorners } from "./prims";
import { type Vec2, TAU, add, dist, lerp, normAngle, rotate } from "./vec";

export interface PathSeg {
  /** seg: oriented in walk direction. arc/ell: CCW prim; `reversed` = walked clockwise. */
  prim: SegPrim | ArcPrim | EllPrim;
  reversed: boolean;
}

export interface Path {
  segs: PathSeg[];
  closed: boolean;
}

const EPS = 1e-9;

// ---------------------------------------------------------------- build

function polyPath(points: Vec2[], closed: boolean, bulges?: number[]): Path {
  const segs: PathSeg[] = [];
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (dist(a, b) <= EPS) continue;
    const bl = bulges?.[i] ?? 0;
    if (bl !== 0) segs.push({ prim: bulgeArc(a, b, bl), reversed: bl < 0 });
    else segs.push({ prim: { t: "seg", a, b }, reversed: false });
  }
  return { segs, closed };
}

/** Path for an editable entity, or null (splines, walls, guides, dimensions, symbols, double lines). */
export function toPath(e: Entity): Path | null {
  switch (e.kind) {
    case "line":
      return dist(e.a, e.b) > EPS ? { segs: [{ prim: { t: "seg", a: e.a, b: e.b }, reversed: false }], closed: false } : null;
    case "polyline":
      return polyPath(e.points, e.closed, e.bulges);
    case "polygon":
      return polyPath(e.points, true);
    case "rect": {
      const r = Math.max(0, Math.min(e.cornerRadius, Math.abs(e.width) / 2, Math.abs(e.height) / 2));
      if (r === 0) return polyPath(rectCorners(e.center, e.width, e.height, e.rotation), true);
      // Rounded rectangle as a closed polyline with quarter-circle bulges.
      const hw = Math.abs(e.width) / 2;
      const hh = Math.abs(e.height) / 2;
      const L = (x: number, y: number) => add(e.center, rotate({ x, y }, e.rotation));
      const q = Math.tan(Math.PI / 8);
      const pts = [L(-hw + r, -hh), L(hw - r, -hh), L(hw, -hh + r), L(hw, hh - r), L(hw - r, hh), L(-hw + r, hh), L(-hw, hh - r), L(-hw, -hh + r)];
      return polyPath(pts, true, [0, q, 0, q, 0, q, 0, q]);
    }
    case "circle":
      return { segs: [{ prim: { t: "arc", c: e.center, r: e.r, start: 0, sweep: TAU }, reversed: false }], closed: true };
    case "arc": {
      const sweep = normAngle(e.end - e.start) || TAU;
      return { segs: [{ prim: { t: "arc", c: e.center, r: e.r, start: normAngle(e.start), sweep }, reversed: false }], closed: false };
    }
    case "ellipse": {
      const full = e.start === undefined || e.end === undefined;
      const start = full ? 0 : normAngle(e.start!);
      const sweep = full ? TAU : normAngle(e.end! - e.start!) || TAU;
      return { segs: [{ prim: { t: "ell", c: e.center, rx: e.rx, ry: e.ry, rot: e.rotation, start, sweep }, reversed: false }], closed: full };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- parameters

/** Prim parameter for a local walk parameter u ∈ [0,1]. */
function primU(s: PathSeg, u: number): number {
  const p = s.prim;
  if (p.t === "seg") return u;
  return p.start + p.sweep * (s.reversed ? 1 - u : u);
}

/** Local walk parameter u ∈ [0,1] from a prim parameter. */
export function localU(s: PathSeg, primParam: number): number {
  const p = s.prim;
  if (p.t === "seg") return primParam;
  const f = normAngle(primParam - p.start) / p.sweep;
  // A point at the very start of a full loop may come back as ~1; keep it consistent.
  const g = f > 1 + 1e-9 ? 0 : Math.min(1, f);
  return s.reversed ? 1 - g : g;
}

export const segCount = (path: Path) => path.segs.length;

export function pointAt(path: Path, s: number): Vec2 {
  const n = path.segs.length;
  let i = Math.floor(s);
  if (i >= n) i = n - 1;
  if (i < 0) i = 0;
  const seg = path.segs[i];
  return primPoint(seg.prim, primU(seg, s - i));
}

/** Closest path parameter to a point. */
export function paramOf(path: Path, p: Vec2): { s: number; distance: number } {
  let best = { s: 0, distance: Infinity };
  path.segs.forEach((seg, i) => {
    const h = closestOnPrim(seg.prim, p);
    if (h.distance < best.distance) best = { s: i + localU(seg, h.u), distance: h.distance };
  });
  return best;
}

// ---------------------------------------------------------------- sub-paths

/** Part of one segment between local parameters u0 < u1, walked in path direction. */
function subSeg(seg: PathSeg, u0: number, u1: number): PathSeg {
  const p = seg.prim;
  if (p.t === "seg") return { prim: { t: "seg", a: lerp(p.a, p.b, u0), b: lerp(p.a, p.b, u1) }, reversed: false };
  // In CCW prim terms the covered range is [lo, hi] of the sweep fraction.
  const lo = seg.reversed ? 1 - u1 : u0;
  const hi = seg.reversed ? 1 - u0 : u1;
  return { prim: { ...p, start: normAngle(p.start + p.sweep * lo), sweep: p.sweep * (hi - lo) }, reversed: seg.reversed };
}

/** Segments covering [s0, s1] (s1 may exceed n for a wrap-around on closed paths). */
export function subPath(path: Path, s0: number, s1: number): PathSeg[] {
  const n = path.segs.length;
  const out: PathSeg[] = [];
  for (let k = Math.floor(s0); k < s1; k++) {
    const u0 = Math.max(0, s0 - k);
    const u1 = Math.min(1, s1 - k);
    if (u1 - u0 > 1e-12) out.push(subSeg(path.segs[((k % n) + n) % n], u0, u1));
  }
  return out;
}

const segLength = (s: PathSeg) => (s.prim.t === "seg" ? dist(s.prim.a, s.prim.b) : s.prim.t === "arc" ? s.prim.r * s.prim.sweep : Math.max(s.prim.rx, s.prim.ry) * s.prim.sweep);

const startOf = (s: PathSeg) => (s.prim.t === "seg" ? s.prim.a : primPoint(s.prim, s.reversed ? s.prim.start + s.prim.sweep : s.prim.start));
const endOf = (s: PathSeg) => (s.prim.t === "seg" ? s.prim.b : primPoint(s.prim, s.reversed ? s.prim.start : s.prim.start + s.prim.sweep));

/** Join neighbouring pieces of the same circle (left over from cutting a closed loop). */
function mergeArcs(segs: PathSeg[]): PathSeg[] {
  const out: PathSeg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.prim.t === "arc" &&
      s.prim.t === "arc" &&
      prev.reversed === s.reversed &&
      dist(prev.prim.c, s.prim.c) < 1e-9 &&
      Math.abs(prev.prim.r - s.prim.r) < 1e-9 &&
      dist(endOf(prev), startOf(s)) < 1e-9
    ) {
      const a = prev.prim;
      const b = s.prim;
      const start = prev.reversed ? b.start : a.start;
      out[out.length - 1] = { prim: { ...a, start, sweep: Math.min(TAU, a.sweep + b.sweep) }, reversed: prev.reversed };
    } else out.push(s);
  }
  return out;
}

export interface Base {
  layerId: Id;
  style?: StyleRef;
}

/** Rebuild an entity from path segments (dropping slivers). Null if nothing is left. */
export function segsToEntity(segs: PathSeg[], id: Id, base: Base, closed = false): Entity | null {
  const kept = mergeArcs(segs.filter((s) => segLength(s) > 1e-9));
  if (!kept.length) return null;
  const common = { id, layerId: base.layerId, ...(base.style ? { style: base.style } : {}) };
  if (kept.length === 1) {
    const s = kept[0];
    const p = s.prim;
    if (p.t === "seg") return { ...common, kind: "line", a: p.a, b: p.b };
    if (p.t === "arc") {
      // A full loop is a circle only when the result is closed; an opened circle is a 360° arc.
      if (p.sweep >= TAU - 1e-12 && closed) return { ...common, kind: "circle", center: p.c, r: p.r };
      if (p.sweep >= TAU - 1e-12) return { ...common, kind: "arc", center: p.c, r: p.r, start: normAngle(p.start), end: normAngle(p.start) };
      return { ...common, kind: "arc", center: p.c, r: p.r, start: normAngle(p.start), end: normAngle(p.start + p.sweep) };
    }
    if (p.sweep >= TAU - 1e-12) return { ...common, kind: "ellipse", center: p.c, rx: p.rx, ry: p.ry, rotation: p.rot };
    return { ...common, kind: "ellipse", center: p.c, rx: p.rx, ry: p.ry, rotation: p.rot, start: normAngle(p.start), end: normAngle(p.start + p.sweep) };
  }
  if (kept.some((s) => s.prim.t === "ell")) return null;
  const points = kept.map(startOf);
  if (!closed) points.push(endOf(kept[kept.length - 1]));
  const bulges = kept.map((s) => (s.prim.t === "arc" ? Math.tan(s.prim.sweep / 4) * (s.reversed ? -1 : 1) : 0));
  if (!closed) bulges.push(0);
  const hasArc = bulges.some((b) => b !== 0);
  return { ...common, kind: "polyline", points, closed, ...(hasArc ? { bulges } : {}) };
}

/** The path as one entity (used after offsetting). Polygons stay polygons when they have no arcs. */
export function pathToEntity(path: Path, id: Id, base: Base, prefer?: Entity["kind"]): Entity | null {
  const e = segsToEntity(path.segs, id, base, path.closed);
  if (e && prefer === "polygon" && e.kind === "polyline" && !e.bulges && e.closed) return { id, layerId: e.layerId, style: e.style, kind: "polygon", points: e.points };
  return e;
}

/** Sorted, de-duplicated cut parameters. On closed paths, cuts at s≈n fold onto s≈0. */
export function normalizeCuts(path: Path, cuts: number[]): number[] {
  const n = path.segs.length;
  const sorted = cuts
    .map((s) => (path.closed && s >= n - 1e-9 ? 0 : s))
    .filter((s) => s >= -1e-9 && s <= n + 1e-9)
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev === undefined || dist(pointAt(path, prev), pointAt(path, s)) > 1e-7) out.push(s);
  }
  if (path.closed && out.length > 1 && dist(pointAt(path, out[0]), pointAt(path, out[out.length - 1])) <= 1e-7) out.pop();
  return out;
}

export { startOf, endOf };
