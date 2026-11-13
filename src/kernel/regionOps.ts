// Planar region operations: area/perimeter, 2D polygon booleans (Union,
// Subtract, Intersect), and enclosed-region boundary detection for hatching.
import type { Entity } from "./types";
import { type PrimContext, flattenPrim, primsOf } from "./prims";
import { lineLine } from "./intersections";
import { type Vec2, dist, sub } from "./vec";

const SNAP = 1e-5;

export function ringArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function ringPerimeter(pts: Vec2[], closed = true): number {
  let len = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) len += dist(pts[i], pts[(i + 1) % pts.length]);
  return len;
}

export function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pointInRings(p: Vec2, rings: Vec2[][]): boolean {
  let inside = false;
  for (const r of rings) if (pointInRing(p, r)) inside = !inside;
  return inside;
}

function cleanRing(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > SNAP) out.push(p);
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= SNAP) out.pop();
  return out;
}

/** Convert a closed entity to a CCW polygon ring (null if open or unsupported). */
export function entityToRing(e: Entity, ctx?: PrimContext, tol = 0.25): Vec2[] | null {
  if (e.kind === "line" || e.kind === "arc" || e.kind === "guide" || e.kind === "dimension" || e.kind === "text" || e.kind === "symbol" || e.kind === "doubleLine")
    return null;
  if (e.kind === "polyline" && !e.closed) return null;
  if (e.kind === "ellipse" && e.start !== undefined && e.end !== undefined && Math.abs(e.end - e.start) < 2 * Math.PI - 1e-6) return null;
  const prims = primsOf(e, ctx);
  if (!prims.length) return null;
  const pts: Vec2[] = [];
  for (const p of prims) {
    const f = flattenPrim(p, tol).pts;
    for (const q of f) pts.push(q);
  }
  const ring = cleanRing(pts);
  if (ring.length < 3) return null;
  if (ringArea(ring) < 0) ring.reverse();
  return ring;
}

/** Area and perimeter of a closed entity (null for open/non-area entities). */
export function entityAreaAndPerimeter(e: Entity, ctx?: PrimContext): { area: number; perimeter: number } | null {
  if (e.kind === "circle") return { area: Math.PI * e.r * e.r, perimeter: 2 * Math.PI * e.r };
  if (e.kind === "ellipse" && (e.start === undefined || e.end === undefined || Math.abs(e.end - e.start) >= 2 * Math.PI - 1e-6)) {
    const a = e.rx;
    const b = e.ry;
    const perim = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    return { area: Math.PI * a * b, perimeter: perim };
  }
  const ring = entityToRing(e, ctx, 0.05);
  if (!ring) return null;
  return { area: Math.abs(ringArea(ring)), perimeter: ringPerimeter(ring, true) };
}

// ------------------------------------------------ planar segment arrangement

type Seg = [Vec2, Vec2];

function ringsToSegs(rings: Vec2[][]): Seg[] {
  const segs: Seg[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      if (dist(a, b) > SNAP) segs.push([a, b]);
    }
  }
  return segs;
}

function splitAllSegments(segs: Seg[]): Seg[] {
  const cuts: number[][] = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++) {
    const [a0, a1] = segs[i];
    const da = sub(a1, a0);
    const minAx = Math.min(a0.x, a1.x) - SNAP;
    const maxAx = Math.max(a0.x, a1.x) + SNAP;
    const minAy = Math.min(a0.y, a1.y) - SNAP;
    const maxAy = Math.max(a0.y, a1.y) + SNAP;
    for (let j = i + 1; j < segs.length; j++) {
      const [b0, b1] = segs[j];
      if (maxAx < Math.min(b0.x, b1.x) || Math.max(b0.x, b1.x) < minAx) continue;
      if (maxAy < Math.min(b0.y, b1.y) || Math.max(b0.y, b1.y) < minAy) continue;
      const db = sub(b1, b0);
      const hit = lineLine(a0, da, b0, db);
      if (hit) {
        if (hit.t >= -1e-6 && hit.t <= 1 + 1e-6 && hit.u >= -1e-6 && hit.u <= 1 + 1e-6) {
          cuts[i].push(Math.min(1, Math.max(0, hit.t)));
          cuts[j].push(Math.min(1, Math.max(0, hit.u)));
        }
      } else {
        // Collinear overlap: project endpoints of each segment onto the other.
        const la2 = da.x * da.x + da.y * da.y;
        const lb2 = db.x * db.x + db.y * db.y;
        if (la2 > 0) {
          const cross0 = (b0.x - a0.x) * da.y - (b0.y - a0.y) * da.x;
          if (Math.abs(cross0) <= SNAP * Math.sqrt(la2)) {
            for (const p of [b0, b1]) {
              const t = ((p.x - a0.x) * da.x + (p.y - a0.y) * da.y) / la2;
              if (t > 1e-6 && t < 1 - 1e-6) cuts[i].push(t);
            }
          }
        }
        if (lb2 > 0) {
          const cross1 = (a0.x - b0.x) * db.y - (a0.y - b0.y) * db.x;
          if (Math.abs(cross1) <= SNAP * Math.sqrt(lb2)) {
            for (const p of [a0, a1]) {
              const u = ((p.x - b0.x) * db.x + (p.y - b0.y) * db.y) / lb2;
              if (u > 1e-6 && u < 1 - 1e-6) cuts[j].push(u);
            }
          }
        }
      }
    }
  }
  const out: Seg[] = [];
  for (let i = 0; i < segs.length; i++) {
    const [a0, a1] = segs[i];
    const ts = cuts[i].sort((x, y) => x - y);
    let prev = ts[0];
    for (let k = 1; k < ts.length; k++) {
      if (ts[k] - prev < 1e-6) continue;
      const p = { x: a0.x + (a1.x - a0.x) * prev, y: a0.y + (a1.y - a0.y) * prev };
      const q = { x: a0.x + (a1.x - a0.x) * ts[k], y: a0.y + (a1.y - a0.y) * ts[k] };
      if (dist(p, q) > SNAP) out.push([p, q]);
      prev = ts[k];
    }
  }
  return out;
}

interface HalfEdge {
  id: number;
  u: number;
  v: number;
  twin: number;
  ang: number;
  next: number;
  used: boolean;
}

interface Arrangement {
  verts: Vec2[];
  edges: HalfEdge[];
  faces: number[][];
}

function buildArrangement(rawSegs: Seg[], pruneDeadEnds = false): Arrangement {
  const split = splitAllSegments(rawSegs);
  const verts: Vec2[] = [];
  const vertKey = (p: Vec2): number => {
    for (let i = 0; i < verts.length; i++) if (dist(verts[i], p) <= SNAP) return i;
    verts.push(p);
    return verts.length - 1;
  };
  const edgeKeys = new Set<string>();
  let pairs: [number, number][] = [];
  for (const [a, b] of split) {
    const u = vertKey(a);
    const v = vertKey(b);
    if (u === v) continue;
    const key = u < v ? `${u}:${v}` : `${v}:${u}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    pairs.push([u, v]);
  }
  if (pruneDeadEnds) {
    let changed = true;
    while (changed) {
      changed = false;
      const deg = new Map<number, number>();
      for (const [u, v] of pairs) {
        deg.set(u, (deg.get(u) ?? 0) + 1);
        deg.set(v, (deg.get(v) ?? 0) + 1);
      }
      const next = pairs.filter(([u, v]) => (deg.get(u) ?? 0) >= 2 && (deg.get(v) ?? 0) >= 2);
      if (next.length !== pairs.length) {
        pairs = next;
        changed = true;
      }
    }
  }
  const edges: HalfEdge[] = [];
  const outByVert = new Map<number, number[]>();
  const addOut = (u: number, eid: number) => {
    let list = outByVert.get(u);
    if (!list) {
      list = [];
      outByVert.set(u, list);
    }
    list.push(eid);
  };
  for (const [u, v] of pairs) {
    const e0 = edges.length;
    const e1 = e0 + 1;
    edges.push({ id: e0, u, v, twin: e1, ang: Math.atan2(verts[v].y - verts[u].y, verts[v].x - verts[u].x), next: -1, used: false });
    edges.push({ id: e1, u: v, v: u, twin: e0, ang: Math.atan2(verts[u].y - verts[v].y, verts[u].x - verts[v].x), next: -1, used: false });
    addOut(u, e0);
    addOut(v, e1);
  }
  for (const list of outByVert.values()) {
    list.sort((a, b) => edges[a].ang - edges[b].ang);
  }
  for (const e of edges) {
    const list = outByVert.get(e.v)!;
    const idx = list.indexOf(e.twin);
    // Previous in CCW order around e.v keeps the face on the left of e.
    e.next = list[(idx - 1 + list.length) % list.length];
  }
  const faces: number[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    const face: number[] = [];
    let cur = i;
    let guard = 0;
    while (!edges[cur].used && guard++ <= edges.length) {
      edges[cur].used = true;
      face.push(cur);
      cur = edges[cur].next;
    }
    if (face.length >= 3 && cur === i) faces.push(face);
  }
  return { verts, edges, faces };
}

function interiorPoint(pts: Vec2[]): Vec2 {
  // Find a horizontal scanline through the midpoint of two distinct y-values and take the midpoint of the first inside span.
  const ys = [...new Set(pts.map((p) => p.y))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < ys.length; i++) {
    const y = (ys[i] + ys[i + 1]) / 2;
    const xs: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((a, b) => a - b);
    if (xs.length >= 2) return { x: (xs[0] + xs[1]) / 2, y };
  }
  const c = pts.reduce((acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length }), { x: 0, y: 0 });
  return c;
}

export type BooleanOp = "union" | "subtract" | "intersect";

/** 2D polygon boolean operation on two ring sets. Returns resulting boundary loops. */
export function booleanPolygons(ringsA: Vec2[][], ringsB: Vec2[][], op: BooleanOp): Vec2[][] {
  const segs = [...ringsToSegs(ringsA), ...ringsToSegs(ringsB)];
  if (!segs.length) return [];
  const arr = buildArrangement(segs, true);
  const keptEdges = new Set<number>();
  for (const f of arr.faces) {
    const pts = f.map((eid) => arr.verts[arr.edges[eid].u]);
    if (ringArea(pts) <= 1e-6) continue;
    const pt = interiorPoint(pts);
    const inA = pointInRings(pt, ringsA);
    const inB = pointInRings(pt, ringsB);
    const keep = op === "union" ? inA || inB : op === "subtract" ? inA && !inB : inA && inB;
    if (keep) for (const eid of f) keptEdges.add(eid);
  }
  // Cancel internal edges shared by two kept faces.
  const boundary = new Set<number>();
  for (const eid of keptEdges) {
    if (!keptEdges.has(arr.edges[eid].twin)) boundary.add(eid);
  }
  const outByVert = new Map<number, number[]>();
  for (const eid of boundary) {
    const u = arr.edges[eid].u;
    let list = outByVert.get(u);
    if (!list) {
      list = [];
      outByVert.set(u, list);
    }
    list.push(eid);
  }
  const visited = new Set<number>();
  const loops: Vec2[][] = [];
  for (const start of boundary) {
    if (visited.has(start)) continue;
    const loop: Vec2[] = [];
    let cur: number | undefined = start;
    let guard = 0;
    while (cur !== undefined && !visited.has(cur) && guard++ <= boundary.size) {
      visited.add(cur);
      loop.push(arr.verts[arr.edges[cur].u]);
      const v: number = arr.edges[cur].v;
      const cand: number[] = outByVert.get(v) ?? [];
      cur = cand.find((e) => !visited.has(e));
    }
    const cleaned = cleanRing(loop);
    if (cleaned.length >= 3 && Math.abs(ringArea(cleaned)) > 1e-6) loops.push(cleaned);
  }
  return loops;
}

/** Find the minimal closed boundary loop enclosing point `p` from visible entities. */
export function findEnclosedRegion(p: Vec2, entities: Entity[], ctx?: PrimContext): Vec2[] | null {
  const segs: Seg[] = [];
  for (const e of entities) {
    if (e.kind === "guide" || e.kind === "dimension" || e.kind === "text" || e.kind === "symbol") continue;
    for (const pr of primsOf(e, ctx)) {
      if (pr.t === "xline") continue;
      const pts = flattenPrim(pr, 0.25).pts;
      for (let i = 0; i + 1 < pts.length; i++) if (dist(pts[i], pts[i + 1]) > SNAP) segs.push([pts[i], pts[i + 1]]);
    }
  }
  if (segs.length < 3) return null;
  const arr = buildArrangement(segs, true);
  // Find the smallest positive-area face that contains `p`.
  let best: { area: number; pts: Vec2[] } | null = null;
  for (const f of arr.faces) {
    const pts = f.map((eid) => arr.verts[arr.edges[eid].u]);
    const area = ringArea(pts);
    if (area <= 1e-5) continue;
    if (!pointInRing(p, pts)) continue;
    if (!best || area < best.area) best = { area, pts };
  }
  return best ? cleanRing(best.pts) : null;
}
