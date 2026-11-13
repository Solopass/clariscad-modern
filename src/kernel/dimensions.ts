// Dimension geometry: extension lines, dimension line/arc, arrowheads and
// text, built from a dimension entity, its layer's scale, a drafting
// standard and the document's units. Sizes in a DimStyle are paper
// millimetres; model size = paper size × layer scale.
import type { DimensionEntity, DraftingStandard, UnitSystem } from "./types";
import type { Prim } from "./prims";
import { lineLine } from "./intersections";
import { formatLength } from "./units";
import { textWidth } from "./textMetrics";
import { type Vec2, TAU, add, angleInSweep, angleOf, dist, dot, fromAngle, mid, normAngle, normalize, perp, rotate, scale, sub } from "./vec";

export type ArrowKind = "filled" | "open" | "tick" | "dot";

export interface DimStyle {
  textHeight: number;
  arrowSize: number;
  arrow: ArrowKind;
  /** Gap between the object and the start of an extension line. */
  extGap: number;
  /** How far extension lines run past the dimension line. */
  extBeyond: number;
  /** Clearance around text. */
  textGap: number;
  /** "inline": text breaks the dimension line (ANSI). "above": text sits over it (ISO/DIN/JIS/BS). */
  textPlacement: "inline" | "above";
  /** Half-length of centre-mark arms. */
  centerMark: number;
  /** Decimal places for angles. */
  anglePrecision: number;
}

export const STANDARDS: Record<DraftingStandard, DimStyle> = {
  ANSI: { textHeight: 3.0, arrowSize: 3.0, arrow: "filled", extGap: 1.5, extBeyond: 3.0, textGap: 1.0, textPlacement: "inline", centerMark: 2.5, anglePrecision: 0 },
  ISO: { textHeight: 2.5, arrowSize: 2.5, arrow: "filled", extGap: 1.0, extBeyond: 2.0, textGap: 0.8, textPlacement: "above", centerMark: 2.5, anglePrecision: 0 },
  DIN: { textHeight: 3.5, arrowSize: 3.5, arrow: "filled", extGap: 0, extBeyond: 2.0, textGap: 1.0, textPlacement: "above", centerMark: 3.0, anglePrecision: 0 },
  JIS: { textHeight: 3.5, arrowSize: 3.0, arrow: "filled", extGap: 1.0, extBeyond: 2.0, textGap: 1.0, textPlacement: "above", centerMark: 3.0, anglePrecision: 0 },
  BS308: { textHeight: 3.5, arrowSize: 3.0, arrow: "open", extGap: 1.0, extBeyond: 2.5, textGap: 1.0, textPlacement: "above", centerMark: 3.0, anglePrecision: 0 },
};

export interface DimText {
  pos: Vec2;
  /** Baseline angle, always upright (between -90° and 90°). */
  angle: number;
  str: string;
  height: number;
}

export interface DimGeometry {
  lines: [Vec2, Vec2][];
  arcs: { c: Vec2; r: number; start: number; sweep: number }[];
  /** Closed polygons; filled for "filled"/"dot" arrows. */
  arrows: Vec2[][];
  filledArrows: boolean;
  text: DimText | null;
  /** Measured value (mm, or radians for angular). */
  value: number;
}

export { textWidth };

const upright = (ang: number) => {
  let a = normAngle(ang);
  if (a > Math.PI / 2 + 1e-9 && a <= (3 * Math.PI) / 2 + 1e-9) a -= Math.PI;
  return a > Math.PI ? a - TAU : a;
};

function arrowAt(tip: Vec2, dir: Vec2, st: DimStyle, k: number): Vec2[] {
  const L = st.arrowSize * k;
  const d = normalize(dir);
  if (st.arrow === "tick") {
    const t = rotate(d, Math.PI / 4);
    return [add(tip, scale(t, -L / 2)), add(tip, scale(t, L / 2))];
  }
  if (st.arrow === "dot") {
    const r = L / 4;
    return Array.from({ length: 10 }, (_, i) => add(tip, fromAngle((i * TAU) / 10, r)));
  }
  const n = perp(d);
  const back = add(tip, scale(d, -L));
  return [tip, add(back, scale(n, L / 6)), add(back, scale(n, -L / 6))];
}

function label(d: DimensionEntity, measured: string): string {
  if (d.textOverride === undefined || d.textOverride === "") return measured;
  return d.textOverride.replace("<>", measured);
}

function fmtAngle(rad: number, places: number): string {
  const deg = (rad * 180) / Math.PI;
  return `${+deg.toFixed(places)}°`;
}

/** Build dimension geometry. `k` = layer scale (model mm per paper mm). */
export function dimGeometry(d: DimensionEntity, k: number, st: DimStyle, units: UnitSystem): DimGeometry {
  const h = st.textHeight * k;
  const g: DimGeometry = { lines: [], arcs: [], arrows: [], filledArrows: st.arrow === "filled" || st.arrow === "dot", text: null, value: 0 };
  const arrow = (tip: Vec2, dir: Vec2) => {
    const poly = arrowAt(tip, dir, st, k);
    if (st.arrow === "tick") g.lines.push([poly[0], poly[1]]);
    else g.arrows.push(poly);
  };
  const lp = d.linePoint;

  if (d.dimType === "horizontal" || d.dimType === "vertical" || d.dimType === "aligned") {
    const [p1, p2] = d.points;
    if (!p1 || !p2) return g;
    let d1: Vec2;
    let d2: Vec2;
    if (d.dimType === "horizontal") {
      d1 = { x: p1.x, y: lp.y };
      d2 = { x: p2.x, y: lp.y };
    } else if (d.dimType === "vertical") {
      d1 = { x: lp.x, y: p1.y };
      d2 = { x: lp.x, y: p2.y };
    } else {
      const u = dist(p1, p2) > 0 ? normalize(sub(p2, p1)) : { x: 1, y: 0 };
      const n = perp(u);
      const off = dot(sub(lp, p1), n);
      d1 = add(p1, scale(n, off));
      d2 = add(p2, scale(n, off));
    }
    // Extension lines.
    for (const [p, q] of [
      [p1, d1],
      [p2, d2],
    ] as [Vec2, Vec2][]) {
      const len = dist(p, q);
      if (len <= st.extGap * k) continue;
      const e = scale(sub(q, p), 1 / len);
      g.lines.push([add(p, scale(e, st.extGap * k)), add(q, scale(e, st.extBeyond * k))]);
    }
    const value = dist(d1, d2);
    g.value = value;
    const str = label(d, formatLength(value, units));
    const dir = value > 0 ? normalize(sub(d2, d1)) : { x: 1, y: 0 };
    const ang = upright(angleOf(dir));
    const m = mid(d1, d2);
    const tw = textWidth(str, h);
    const room = value >= 2.5 * st.arrowSize * k;
    if (room) {
      arrow(d1, scale(dir, -1));
      arrow(d2, dir);
    } else {
      // Not enough room: arrows outside, pointing in.
      arrow(d1, dir);
      arrow(d2, scale(dir, -1));
      g.lines.push([add(d1, scale(dir, -2 * st.arrowSize * k)), d1], [d2, add(d2, scale(dir, 2 * st.arrowSize * k))]);
    }
    if (st.textPlacement === "inline" && value > tw + 2 * st.textGap * k + 2 * st.arrowSize * k) {
      const half = tw / 2 + st.textGap * k;
      g.lines.push([d1, add(m, scale(dir, -half))], [add(m, scale(dir, half)), d2]);
      g.text = { pos: m, angle: ang, str, height: h };
    } else {
      g.lines.push([d1, d2]);
      const up = perp(fromAngle(ang));
      g.text = { pos: add(m, scale(up, st.textGap * k + h / 2)), angle: ang, str, height: h };
    }
    return g;
  }

  if (d.dimType === "angular") {
    const [a1, b1, a2, b2] = d.points;
    if (!a1 || !b1 || !a2 || !b2) return g;
    const X = lineLine(a1, sub(b1, a1), a2, sub(b2, a2))?.point;
    if (!X) return g;
    const r = Math.max(dist(X, lp), 1e-9);
    const tp = angleOf(sub(lp, X));
    const u1 = normalize(sub(b1, a1));
    const u2 = normalize(sub(b2, a2));
    let best: { start: number; sweep: number } | null = null;
    for (const r1 of [u1, scale(u1, -1)])
      for (const r2 of [u2, scale(u2, -1)]) {
        const s = normAngle(angleOf(r1));
        const sw = normAngle(angleOf(r2) - s);
        if (sw > 1e-9 && sw < Math.PI + 1e-9 && angleInSweep(tp, s, sw)) best = { start: s, sweep: sw };
      }
    if (!best) return g;
    g.value = best.sweep;
    g.arcs.push({ c: X, r, start: best.start, sweep: best.sweep });
    const e1 = add(X, fromAngle(best.start, r));
    const e2 = add(X, fromAngle(best.start + best.sweep, r));
    // Arrowheads point along the arc, outward from its middle (CCW tangent at the end, reversed at the start).
    arrow(e1, scale(perp(fromAngle(best.start)), -1));
    arrow(e2, perp(fromAngle(best.start + best.sweep)));
    // Extension lines from the nearer end of each line when the arc lies beyond it.
    for (const [a, b, e] of [
      [a1, b1, e1],
      [a2, b2, e2],
    ] as [Vec2, Vec2, Vec2][]) {
      const near = dist(a, e) < dist(b, e) ? a : b;
      const onSeg = dot(sub(e, a), sub(b, a)) >= 0 && dot(sub(e, b), sub(a, b)) >= 0;
      if (!onSeg && dist(near, e) > st.extGap * k) {
        const dir = normalize(sub(e, near));
        g.lines.push([add(near, scale(dir, st.extGap * k)), add(e, scale(dir, st.extBeyond * k))]);
      }
    }
    const midA = best.start + best.sweep / 2;
    const str = label(d, fmtAngle(best.sweep, st.anglePrecision));
    g.text = { pos: add(X, fromAngle(midA, r + st.textGap * k + h / 2)), angle: upright(midA - Math.PI / 2), str, height: h };
    return g;
  }

  if (d.dimType === "radius" || d.dimType === "diameter") {
    const [c, q] = d.points;
    if (!c || !q) return g;
    const r = dist(c, q);
    g.value = d.dimType === "radius" ? r : 2 * r;
    const dir = dist(lp, c) > 1e-9 ? normalize(sub(lp, c)) : { x: 1, y: 0 };
    const edge = add(c, scale(dir, r));
    const outside = dist(lp, c) > r;
    if (d.dimType === "radius") {
      g.lines.push([c, outside ? lp : edge]);
      arrow(edge, outside ? scale(dir, -1) : dir);
    } else {
      const opp = add(c, scale(dir, -r));
      g.lines.push([opp, outside ? lp : edge]);
      arrow(edge, outside ? scale(dir, -1) : dir);
      arrow(opp, scale(dir, -1));
    }
    const str = label(d, (d.dimType === "radius" ? "R" : "⌀") + formatLength(g.value, units));
    const pos = outside ? add(lp, { x: (dir.x >= 0 ? 1 : -1) * (textWidth(str, h) / 2 + st.textGap * k), y: 0 }) : add(mid(c, edge), scale(perp(dir), st.textGap * k + h / 2));
    g.text = { pos, angle: outside ? 0 : upright(angleOf(dir)), str, height: h };
    return g;
  }

  if (d.dimType === "centerMark") {
    const c = d.points[0];
    if (!c) return g;
    const s = st.centerMark * k;
    g.lines.push([add(c, { x: -s, y: 0 }), add(c, { x: s, y: 0 })], [add(c, { x: 0, y: -s }), add(c, { x: 0, y: s })]);
    return g;
  }
  return g;
}

/**
 * Where the dimension line goes after its measured points move: it keeps its
 * offset from the measured points (perpendicular for linear dimensions, from the
 * centre for radial ones), so moving one end does not drag the line halfway.
 */
export function relocateLinePoint(d: DimensionEntity, newPts: Vec2[]): Vec2 {
  const [o1, o2] = d.points;
  const [n1, n2] = newPts;
  const lp = d.linePoint;
  switch (d.dimType) {
    case "horizontal":
      return { x: lp.x + ((n1.x - o1.x) + (n2.x - o2.x)) / 2, y: lp.y + Math.min(n1.y, n2.y) - Math.min(o1.y, o2.y) };
    case "vertical":
      return { x: lp.x + Math.min(n1.x, n2.x) - Math.min(o1.x, o2.x), y: lp.y + ((n1.y - o1.y) + (n2.y - o2.y)) / 2 };
    case "aligned": {
      if (dist(o1, o2) === 0 || dist(n1, n2) === 0) return lp;
      const on = perp(normalize(sub(o2, o1)));
      const off = dot(sub(lp, o1), on);
      const along = dot(sub(lp, o1), normalize(sub(o2, o1))) / dist(o1, o2);
      const nn = perp(normalize(sub(n2, n1)));
      return add(add(n1, scale(sub(n2, n1), along)), scale(nn, off));
    }
    case "angular": {
      // Keep the arc's radius and side relative to the corner.
      const X0 = lineLine(d.points[0], sub(d.points[1], d.points[0]), d.points[2], sub(d.points[3], d.points[2]))?.point;
      const X1 = lineLine(newPts[0], sub(newPts[1], newPts[0]), newPts[2], sub(newPts[3], newPts[2]))?.point;
      return X0 && X1 ? add(lp, sub(X1, X0)) : lp;
    }
    default:
      // Radial and centre marks follow the centre.
      return add(lp, sub(n1, o1));
  }
}

/** Text box corners (for hit-testing and bounding boxes). */
export function textBox(t: DimText): Vec2[] {
  const w = textWidth(t.str, t.height) / 2;
  const hh = t.height / 2;
  return [
    { x: -w, y: -hh },
    { x: w, y: -hh },
    { x: w, y: hh },
    { x: -w, y: hh },
  ].map((p) => add(t.pos, rotate(p, t.angle)));
}

/** Primitives for hit-testing / selection / bounds. */
export function geometryPrims(g: DimGeometry): Prim[] {
  const out: Prim[] = [];
  for (const [a, b] of g.lines) out.push({ t: "seg", a, b });
  for (const a of g.arcs) out.push({ t: "arc", c: a.c, r: a.r, start: a.start, sweep: a.sweep });
  for (const poly of g.arrows) poly.forEach((p, i) => out.push({ t: "seg", a: p, b: poly[(i + 1) % poly.length] }));
  if (g.text) {
    const box = textBox(g.text);
    box.forEach((p, i) => out.push({ t: "seg", a: p, b: box[(i + 1) % 4] }));
  }
  return out;
}
