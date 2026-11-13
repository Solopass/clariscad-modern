// Pure entity transforms used by editing tools (move now; rotate/mirror/scale later).
import type { Entity } from "./types";
import { type Vec2, add } from "./vec";

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
