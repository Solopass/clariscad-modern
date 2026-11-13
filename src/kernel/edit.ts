// Pure entity transforms used by editing tools and the Arrange menu.
import type { Entity } from "./types";
import { type Transform2D, apply, applyDir, multiply, rotation, scaling, translation } from "./transform";
import { type Vec2, add, angleOf, normAngle, normalize } from "./vec";

const mv = (p: Vec2, d: Vec2) => add(p, d);

/** Copy of `e` moved by `d` (same id). */
export function translateEntity(e: Entity, d: Vec2): Entity {
  switch (e.kind) {
    case "line":
    case "doubleLine":
    case "wall":
      return { ...e, a: mv(e.a, d), b: mv(e.b, d) };
    case "polyline":
    case "polygon":
    case "spline":
      return { ...e, points: e.points.map((p) => mv(p, d)) };
    case "rect":
    case "circle":
    case "arc":
    case "ellipse":
      return { ...e, center: mv(e.center, d) };
    case "guide":
      return { ...e, point: mv(e.point, d) };
    case "dimension":
      return { ...e, points: e.points.map((p) => mv(p, d)), linePoint: mv(e.linePoint, d) };
    case "symbol":
      return { ...e, position: mv(e.position, d) };
  }
}

/** Uniform scale factor and mirror flag of a similarity transform. Throws for shears / non-uniform scales. */
export function similarityOf(T: Transform2D): { s: number; mirror: boolean } {
  const det = T.a * T.d - T.b * T.c;
  const sx = Math.hypot(T.a, T.b);
  const sy = Math.hypot(T.c, T.d);
  if (Math.abs(sx - sy) > 1e-9 * Math.max(sx, sy) || Math.abs(T.a * T.c + T.b * T.d) > 1e-9 * sx * sy)
    throw new Error("transformEntity needs a similarity transform (rotate, mirror, uniform scale)");
  return { s: sx, mirror: det < 0 };
}

/** Image of a direction angle. */
const mapAngle = (T: Transform2D, ang: number) => angleOf(applyDir(T, { x: Math.cos(ang), y: Math.sin(ang) }));

/**
 * Copy of `e` under a similarity transform (rotation, mirror, uniform scale,
 * translation). Same id. Mirroring keeps arcs CCW by swapping their ends.
 */
export function transformEntity(e: Entity, T: Transform2D): Entity {
  const { s, mirror } = similarityOf(T);
  const m = (p: Vec2) => apply(T, p);
  switch (e.kind) {
    case "line":
      return { ...e, a: m(e.a), b: m(e.b) };
    case "doubleLine":
      // A mirror swaps left/right justification.
      return { ...e, a: m(e.a), b: m(e.b), width: e.width * s, justify: mirror ? flipJustify(e.justify) : e.justify };
    case "wall":
      return {
        ...e,
        a: m(e.a),
        b: m(e.b),
        thickness: e.thickness * s,
        justify: mirror ? flipJustify(e.justify) : e.justify,
        // A mirror keeps a→b order, so distances along the wall are unchanged apart from scale.
        openings: e.openings?.map((o) => ({ ...o, at: o.at * s, width: o.width * s })),
      };
    case "polyline":
      return { ...e, points: e.points.map(m), bulges: mirror && e.bulges ? e.bulges.map((b) => -b) : e.bulges };
    case "polygon":
    case "spline":
      return { ...e, points: e.points.map(m) };
    case "rect":
      return { ...e, center: m(e.center), width: e.width * s, height: e.height * s, rotation: normAngle(mapAngle(T, e.rotation)), cornerRadius: e.cornerRadius * s };
    case "circle":
      return { ...e, center: m(e.center), r: e.r * s };
    case "arc": {
      const a0 = mapAngle(T, e.start);
      const a1 = mapAngle(T, e.end);
      return mirror
        ? { ...e, center: m(e.center), r: e.r * s, start: normAngle(a1), end: normAngle(a0) }
        : { ...e, center: m(e.center), r: e.r * s, start: normAngle(a0), end: normAngle(a1) };
    }
    case "ellipse": {
      const rot = mapAngle(T, e.rotation);
      let start = e.start;
      let end = e.end;
      if (mirror && start !== undefined && end !== undefined) {
        // In the ellipse's own frame a mirror flips the parameter: u → -u, and ends swap.
        [start, end] = [normAngle(-end), normAngle(-start)];
      }
      return { ...e, center: m(e.center), rx: e.rx * s, ry: e.ry * s, rotation: rot, start, end };
    }
    case "guide":
      return { ...e, point: m(e.point), dir: normalize(applyDir(T, e.dir)) };
    case "dimension":
      return { ...e, points: e.points.map(m), linePoint: m(e.linePoint) };
    case "symbol":
      return {
        ...e,
        position: m(e.position),
        rotation: mapAngle(T, e.rotation),
        scaleX: e.scaleX * s,
        scaleY: (mirror ? -1 : 1) * e.scaleY * s,
      };
  }
}

const flipJustify = (j: "center" | "left" | "right") => (j === "left" ? "right" : j === "right" ? "left" : j);

/** Rotation by `ang` about `c`. */
export const rotateAbout = (c: Vec2, ang: number): Transform2D => multiply(translation(c.x, c.y), multiply(rotation(ang), translation(-c.x, -c.y)));

/** Mirror across the line through `c` with direction angle `ang` (0 = horizontal axis → vertical flip). */
export function mirrorAcross(c: Vec2, ang: number): Transform2D {
  const cos2 = Math.cos(2 * ang);
  const sin2 = Math.sin(2 * ang);
  const M: Transform2D = { a: cos2, b: sin2, c: sin2, d: -cos2, e: 0, f: 0 };
  return multiply(translation(c.x, c.y), multiply(M, translation(-c.x, -c.y)));
}

/** Uniform scale about `c`. */
export const scaleAbout = (c: Vec2, k: number): Transform2D => multiply(translation(c.x, c.y), multiply(scaling(k), translation(-c.x, -c.y)));
