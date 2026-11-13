// Hatch and fill patterns. A pattern is a set of line families (the same
// model as AutoCAD .pat files): each family is parallel lines at `angle`
// through `origin`, rows `spacing` apart, each row shifted `shift` along the
// line, optionally dashed (positive = dash, negative = gap, 0 = dot).
// Sizes are paper millimetres; they are multiplied by the layer scale and the
// entity's fill scale. Lines are clipped to closed outlines (even-odd rule).
import type { Entity } from "./types";
import { type PrimContext, bandPrims, flattenPrim, primBBox, primsOf } from "./prims";
import { type Vec2, add, dist, dot, scale } from "./vec";

export interface LineFamily {
  angle: number; // degrees
  origin: [number, number];
  shift: number;
  spacing: number;
  dashes?: number[];
}

export interface HatchPattern {
  id: string;
  label: string;
  /** Solid fill colour (instead of lines). */
  solid?: string;
  families?: LineFamily[];
}

const IN = 25.4;
const fam = (angle: number, ox: number, oy: number, shift: number, spacing: number, dashes?: number[]): LineFamily => ({ angle, origin: [ox, oy], shift, spacing, dashes });
const inch = (angle: number, ox: number, oy: number, shift: number, spacing: number, dashes?: number[]) =>
  fam(angle, ox * IN, oy * IN, shift * IN, spacing * IN, dashes?.map((d) => d * IN));

export const PATTERNS: HatchPattern[] = [
  { id: "solid", label: "Solid", solid: "#000000" },
  { id: "gray25", label: "Light Gray", solid: "#d4d4d4" },
  { id: "gray50", label: "Gray", solid: "#9a9a9a" },
  { id: "ansi31", label: "Diagonal (ANSI 31)", families: [inch(45, 0, 0, 0, 0.125)] },
  { id: "crosshatch", label: "Crosshatch (ANSI 37)", families: [inch(45, 0, 0, 0, 0.125), inch(135, 0, 0, 0, 0.125)] },
  { id: "steel", label: "Steel (ANSI 32)", families: [inch(45, 0, 0, 0, 0.375), inch(45, 0.176776695, 0, 0, 0.375)] },
  { id: "brick", label: "Brick", families: [inch(0, 0, 0, 0, 0.25), inch(90, 0, 0, 0.25, 0.25, [0.25, -0.25])] },
  {
    id: "concrete",
    label: "Concrete",
    families: [fam(50, 0, 0, 4.0, 5.0, [0.8, -6]), fam(355, 0, 0, 3.1, 4.4, [0.6, -5]), fam(100.4, 0.5, 0.2, 2.4, 6, [0.5, -5]), fam(30, 1, 1, 3, 3.5, [0, -4])],
  },
  {
    id: "insulation",
    label: "Insulation",
    families: [inch(0, 0, 0, 0, 0.375), inch(0, 0, 0.125, 0, 0.375, [0.125, -0.125]), inch(0, 0, 0.25, 0, 0.375, [0.125, -0.125])],
  },
  { id: "wood", label: "Wood Grain", families: [fam(0, 0, 0, 3.3, 2.2, [9, -1.5, 3, -2]), fam(0, 0, 1.1, 5.1, 2.2, [5, -2.5])] },
  {
    id: "earth",
    label: "Earth",
    families: [
      inch(0, 0, 0, 0.25, 0.25, [0.25, -0.25]),
      inch(0, 0, 0.09375, 0.25, 0.25, [0.25, -0.25]),
      inch(0, 0, 0.1875, 0.25, 0.25, [0.25, -0.25]),
      inch(90, 0.03125, 0.21875, 0.25, 0.25, [0.25, -0.25]),
      inch(90, 0.125, 0.21875, 0.25, 0.25, [0.25, -0.25]),
      inch(90, 0.21875, 0.21875, 0.25, 0.25, [0.25, -0.25]),
    ],
  },
  { id: "sand", label: "Sand", families: [fam(37.5, 0, 0, 1.5, 2.2, [0, -2.5]), fam(7.5, 0, 0, 2.1, 2.9, [0, -3.1])] },
];

export const patternById = (id: string | undefined) => PATTERNS.find((p) => p.id === id);

export interface HatchResult {
  segs: [Vec2, Vec2][];
  dots: Vec2[];
  /** Too many lines at this scale; draw a tint instead. */
  dense: boolean;
}

const LIMIT = 20000;

/** Clip one line family to the rings. `k` = overall scale (layer × fill). */
function familyLines(rings: Vec2[][], f: LineFamily, k: number, out: HatchResult): boolean {
  const th = (f.angle * Math.PI) / 180;
  const d = { x: Math.cos(th), y: Math.sin(th) };
  const n = { x: -d.y, y: d.x };
  const o = { x: f.origin[0] * k, y: f.origin[1] * k };
  const sp = f.spacing * k;
  if (!(sp > 0)) return true;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const r of rings)
    for (const p of r) {
      const v = dot({ x: p.x - o.x, y: p.y - o.y }, n);
      vmin = Math.min(vmin, v);
      vmax = Math.max(vmax, v);
    }
  const k0 = Math.ceil(vmin / sp);
  const k1 = Math.floor(vmax / sp);
  if (k1 - k0 > LIMIT) return false;
  const dashes = f.dashes?.map((x) => x * k);
  const period = dashes ? dashes.reduce((s, x) => s + Math.abs(x), 0) : 0;

  for (let row = k0; row <= k1; row++) {
    const v = row * sp;
    const base = add(add(o, scale(n, v)), scale(d, row * f.shift * k));
    const hits: number[] = [];
    for (const r of rings)
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        const pn = dot({ x: p.x - o.x, y: p.y - o.y }, n) - v;
        const qn = dot({ x: q.x - o.x, y: q.y - o.y }, n) - v;
        if (pn < 0 !== qn < 0) {
          const t = pn / (pn - qn);
          const x = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
          hits.push(dot({ x: x.x - base.x, y: x.y - base.y }, d));
        }
      }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const s0 = hits[i];
      const s1 = hits[i + 1];
      const at = (s: number) => add(base, scale(d, s));
      if (!dashes || period <= 0) {
        out.segs.push([at(s0), at(s1)]);
      } else {
        // Walk the dash pattern (anchored at the row's base point) across [s0, s1].
        let s = Math.floor(s0 / period) * period;
        let guard = 0;
        while (s < s1 && guard++ < 100000) {
          for (const dash of dashes) {
            const len = Math.abs(dash);
            if (dash > 0) {
              const a = Math.max(s, s0);
              const b = Math.min(s + len, s1);
              if (b > a) out.segs.push([at(a), at(b)]);
            } else if (dash === 0 && s >= s0 && s <= s1) out.dots.push(at(s));
            s += len;
            if (s >= s1) break;
          }
        }
      }
      if (out.segs.length + out.dots.length > LIMIT) return false;
    }
  }
  return true;
}

/** Pattern geometry clipped to closed rings, or null for solid fills / unknown patterns. */
export function hatchRings(rings: Vec2[][], pattern: HatchPattern, k: number): HatchResult | null {
  if (!pattern.families || !rings.length) return null;
  const out: HatchResult = { segs: [], dots: [], dense: false };
  for (const f of pattern.families) {
    if (!familyLines(rings, f, k, out)) return { segs: [], dots: [], dense: true };
  }
  return out;
}

/** Closed outline(s) of a fillable entity, as polygons. Null if the entity is open. */
export function fillRings(e: Entity, ctx?: PrimContext): Vec2[][] | null {
  switch (e.kind) {
    case "wall": {
      const [f1, f2] = bandPrims(e.a, e.b, e.thickness, e.justify, false, false);
      return [[f1.a, f1.b, f2.b, f2.a]];
    }
    case "rect":
    case "polygon":
    case "circle":
      break;
    case "ellipse":
      if (e.start !== undefined && e.end !== undefined) return null;
      break;
    case "polyline":
    case "spline":
      if (!e.closed) return null;
      break;
    default:
      return null;
  }
  const prims = primsOf(e, ctx);
  const ring: Vec2[] = [];
  for (const p of prims) {
    const { pts } = flattenPrim(p, Math.max(1e-6, sizeOf(prims) * 1e-3));
    for (const q of pts) if (!ring.length || dist(ring[ring.length - 1], q) > 1e-12) ring.push(q);
  }
  if (ring.length > 2 && dist(ring[0], ring[ring.length - 1]) < 1e-9) ring.pop();
  return ring.length >= 3 ? [ring] : null;
}

/** Extent of the outline (not its distance from the origin), for the flattening tolerance. */
function sizeOf(prims: ReturnType<typeof primsOf>): number {
  let s = 0;
  for (const p of prims) {
    const b = primBBox(p);
    if (b) s = Math.max(s, b.maxX - b.minX, b.maxY - b.minY);
  }
  return s || 1;
}

const cache = new WeakMap<Entity, { key: string; rings: Vec2[][] | null; result: HatchResult | null }>();

/**
 * The outline(s) to fill: a wall's solved outline when the solver has seen this exact
 * wall (mitres, openings), otherwise the entity's own closed outline.
 */
export function outlineOf(e: Entity, ctx?: PrimContext): Vec2[][] | null {
  if (e.kind === "wall") {
    const solved = ctx?.wallPrims?.get(e.id);
    if (solved && solved.entity === e) return solved.fill;
  }
  return fillRings(e, ctx);
}

/**
 * Cached hatch for an entity's fill. Recomputed when the pattern, the overall scale
 * `k` (layer scale × fill scale) or the outline object changes.
 */
export function entityHatch(e: Entity, patternId: string, k: number, ctx?: PrimContext): { rings: Vec2[][] | null; result: HatchResult | null } {
  const key = `${patternId}|${k}`;
  const hit = cache.get(e);
  const rings = e.kind === "wall" ? outlineOf(e, ctx) : hit?.rings ?? outlineOf(e, ctx);
  if (hit && hit.key === key && hit.rings === rings) return hit;
  const pat = patternById(patternId);
  const result = rings && pat ? hatchRings(rings, pat, k) : null;
  const v = { key, rings, result };
  cache.set(e, v);
  return v;
}
