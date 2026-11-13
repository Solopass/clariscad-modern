// Tools and their construction Methods. A Method is declarative: how many
// clicks it takes and how to build the shape from those points. The cursor
// is passed as the last point while previewing, so the same build() drives
// both the rubber band and the final entity.
import type { CadDocument, Entity, Id } from "../kernel/types";
import type { Prim } from "../kernel/prims";
import type { EntityIndex } from "../kernel/spatialIndex";
import type { Patch } from "../state/ops";
import { EDIT_TOOLS } from "./editTools";
import {
  arc3P,
  arcFromTangent,
  arcStartEndRadius,
  circle2P,
  circle3P,
  rect3P,
  regularPolygon,
  regularPolygonFromEdge,
  tangentAt,
  tangentTangentRadius,
} from "../kernel/construct";
import { type Vec2, angleOf, cross, dist, dot, fromAngle, mid, normAngle, normalize, sub, scale, perp } from "../kernel/vec";
import type { ToolId, ToolSettings } from "../state/useToolStore";

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
/** An entity before it gets an id and layer. */
export type Shape = DistributiveOmit<Entity, "id" | "layerId">;

export interface BuildCtx {
  settings: ToolSettings;
  /** Nearest primitive to a point (for methods that pick existing geometry). */
  primAt(p: Vec2): Prim | null;
  /** Nearest visible, unlocked entity to a point (within the pick radius). */
  entityAt(p: Vec2): Entity | null;
  /** Entities the snap engine reported for each placed point (same order as pts). */
  pickIds: (Id[] | undefined)[];
  doc(): CadDocument;
  index(): EntityIndex;
  newId(): Id;
  /** Ask the user for a line of text (null = cancelled). */
  ask(question: string, initial: string): string | null;
  /** Pick radius in world units. */
  tolerance: number;
}

export interface MethodDef {
  id: string;
  label: string;
  /** Clicks needed; "many" finishes with Enter / double-click. */
  points: number | "many";
  /** Minimum points for a "many" method. */
  min?: number;
  /** Freehand: press, drag, release. */
  freehand?: boolean;
  /** Indices of clicks that pick an entity (raw cursor, must hit something) rather than a point. */
  rawPicks?: number[];
  /** A many-point method that finishes when the cursor returns to the first point. */
  closes?: boolean;
  /** Status-line prompt for the next click (index = points placed so far). */
  prompts: string[];
  /** Drawing methods: the new shape(s) from the points. */
  build?(pts: Vec2[], ctx: BuildCtx): Shape | Shape[] | null;
  /** Editing methods: a patch from the points (called once all points are placed). */
  edit?(pts: Vec2[], ctx: BuildCtx): Patch | null;
  /** Editing methods: what to show while the cursor is the last point. */
  preview?(pts: Vec2[], ctx: BuildCtx): { shapes?: Shape[]; highlight?: Shape[] };
}

export interface ToolDef {
  id: ToolId;
  label: string;
  /** Keyboard shortcut (single key). */
  key: string;
  methods: MethodDef[];
}

const ortho = (a: Vec2, b: Vec2): Vec2 => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y });

const rectFromCorners = (a: Vec2, b: Vec2, radius: number): Shape | null => {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w === 0 || h === 0) return null;
  return { kind: "rect", center: mid(a, b), width: w, height: h, rotation: 0, cornerRadius: radius };
};

const DRAW_TOOLS: ToolDef[] = [
  {
    id: "select",
    label: "Selection",
    key: "v",
    methods: [
      { id: "pick", label: "Pick / Marquee", points: 0, prompts: ["Click to select, drag for a marquee (left→right inside, right→left crossing); drag a handle to reshape"] },
      { id: "lasso", label: "Lasso", points: 0, prompts: ["Drag a loop around what to select"] },
      { id: "polygon", label: "Polygon", points: 0, prompts: ["Click the corners of an area; Enter or double-click to select inside it"] },
    ],
  },
  {
    id: "line",
    label: "Single Line",
    key: "l",
    methods: [
      { id: "twoPoint", label: "Two Point", points: 2, prompts: ["Line start", "Line end"], build: ([a, b]) => (dist(a, b) > 0 ? { kind: "line", a, b } : null) },
      {
        id: "continuous",
        label: "Continuous",
        points: "many",
        min: 2,
        prompts: ["First point", "Next point (Enter or double-click to finish, C to close)"],
        build: (pts) => (pts.length >= 2 ? { kind: "polyline", points: pts, closed: false } : null),
      },
      { id: "polar", label: "Polar", points: 2, prompts: ["Line start", "Type length and angle, or click the end"], build: ([a, b]) => (dist(a, b) > 0 ? { kind: "line", a, b } : null) },
      { id: "orthogonal", label: "Orthogonal", points: 2, prompts: ["Line start", "Line end (horizontal or vertical)"], build: ([a, b]) => (dist(a, b) > 0 ? { kind: "line", a, b: ortho(a, b) } : null) },
    ],
  },
  {
    id: "doubleLine",
    label: "Double Line",
    key: "d",
    methods: (["center", "left", "right"] as const).map((j) => ({
      id: j,
      label: j === "center" ? "Center" : j === "left" ? "Left Edge" : "Right Edge",
      points: 2 as const,
      prompts: ["Start point", "End point"],
      build: ([a, b]: Vec2[], { settings }: BuildCtx): Shape | null =>
        dist(a, b) > 0 ? { kind: "doubleLine", a, b, width: settings.doubleLineWidth, justify: j, capStart: settings.doubleLineCaps, capEnd: settings.doubleLineCaps } : null,
    })),
  },
  {
    id: "rect",
    label: "Rectangle",
    key: "r",
    methods: [
      { id: "corner", label: "Corner to Corner", points: 2, prompts: ["First corner", "Opposite corner"], build: ([a, b], { settings }) => rectFromCorners(a, b, settings.cornerRadius) },
      {
        id: "center",
        label: "Center to Corner",
        points: 2,
        prompts: ["Center", "Corner"],
        build: ([c, b], { settings }) => rectFromCorners(sub(scale(c, 2), b), b, settings.cornerRadius),
      },
      {
        id: "threePoint",
        label: "Rotated (3 Point)",
        points: 3,
        prompts: ["Base start", "Base end", "Height"],
        build: (pts, { settings }) => {
          if (pts.length < 3) return pts[1] && dist(pts[0], pts[1]) > 0 ? { kind: "line", a: pts[0], b: pts[1] } : null;
          const [a, b, c] = pts;
          const r = rect3P(a, b, c);
          const w = dist(a, b);
          const h = dist(b, r[2]);
          if (w === 0 || h === 0) return null;
          return { kind: "rect", center: mid(r[0], r[2]), width: w, height: h, rotation: angleOf(sub(b, a)), cornerRadius: settings.cornerRadius };
        },
      },
    ],
  },
  {
    id: "circle",
    label: "Circle",
    key: "c",
    methods: [
      { id: "centerRadius", label: "Center-Radius", points: 2, prompts: ["Center", "Radius"], build: ([c, p]) => (dist(c, p) > 0 ? { kind: "circle", center: c, r: dist(c, p) } : null) },
      {
        id: "diameter",
        label: "Two Point (Diameter)",
        points: 2,
        prompts: ["Diameter start", "Diameter end"],
        build: ([a, b]) => {
          const c = circle2P(a, b);
          return c.r > 0 ? { kind: "circle", center: c.center, r: c.r } : null;
        },
      },
      {
        id: "threePoint",
        label: "Three Point",
        points: 3,
        prompts: ["First point on circle", "Second point", "Third point"],
        build: (pts) => {
          if (pts.length < 3) return pts.length === 2 && dist(pts[0], pts[1]) > 0 ? { kind: "circle", ...circle2P(pts[0], pts[1]) } : null;
          const c = circle3P(pts[0], pts[1], pts[2]);
          return c ? { kind: "circle", center: c.center, r: c.r } : null;
        },
      },
      {
        id: "ttr",
        label: "Tangent-Tangent-Radius",
        points: 2,
        prompts: ["Pick the first line or circle", "Pick the second line or circle (radius in Methods bar)"],
        build: ([a, b], ctx) => {
          const pa = ctx.primAt(a);
          const pb = ctx.primAt(b);
          if (!pa || !pb) return null;
          const cs = tangentTangentRadius(pa, pb, ctx.settings.arcRadius);
          if (!cs.length) return null;
          // Prefer the circle whose tangent points are nearest the two picks.
          cs.sort((x, y) => dist(x.t1, a) + dist(x.t2, b) - (dist(y.t1, a) + dist(y.t2, b)));
          return { kind: "circle", center: cs[0].center, r: cs[0].r };
        },
      },
    ],
  },
  {
    id: "arc",
    label: "Arc",
    key: "a",
    methods: [
      {
        id: "threePoint",
        label: "Three Point",
        points: 3,
        prompts: ["Arc start", "Point on arc", "Arc end"],
        build: (pts) => {
          if (pts.length < 3) return pts.length === 2 && dist(pts[0], pts[1]) > 0 ? { kind: "line", a: pts[0], b: pts[1] } : null;
          const a = arc3P(pts[0], pts[1], pts[2]);
          return a ? { kind: "arc", ...a } : null;
        },
      },
      {
        id: "centerStartEnd",
        label: "Center-Start-End",
        points: 3,
        prompts: ["Center", "Start (sets radius)", "End angle"],
        build: (pts) => {
          const [c, s] = pts;
          const r = dist(c, s);
          if (r === 0) return null;
          if (pts.length < 3) return { kind: "circle", center: c, r };
          const start = normAngle(angleOf(sub(s, c)));
          const end = normAngle(angleOf(sub(pts[2], c)));
          return start === end ? null : { kind: "arc", center: c, r, start, end };
        },
      },
      {
        id: "startEndRadius",
        label: "Start-End-Radius",
        points: 3,
        prompts: ["Arc start", "Arc end", "Pick the side (radius in Methods bar)"],
        build: (pts, { settings }) => {
          const [a, b] = pts;
          if (dist(a, b) === 0) return null;
          if (pts.length < 3) return { kind: "line", a, b };
          // Bulge toward the side the cursor is on.
          const left = cross(sub(b, a), sub(pts[2], a)) > 0;
          const r = Math.max(settings.arcRadius, dist(a, b) / 2);
          const arc = left ? arcStartEndRadius(b, a, r) : arcStartEndRadius(a, b, r);
          return arc ? { kind: "arc", ...arc } : null;
        },
      },
      {
        id: "tangent",
        label: "Tangent",
        points: 2,
        rawPicks: [0],
        prompts: ["Click the object the arc leaves, tangent at that point", "Arc end"],
        build: ([a, b], ctx) => {
          if (!b) return null;
          const prim = ctx.primAt(a);
          if (!prim) return null;
          const t = tangentAt(prim, a);
          if (!t) return null;
          const arc = arcFromTangent(t.point, t.dir, b);
          return arc ? { kind: "arc", ...arc } : null;
        },
      },
    ],
  },
  {
    id: "ellipse",
    label: "Ellipse",
    key: "e",
    methods: [
      {
        id: "box",
        label: "Bounding Box",
        points: 2,
        prompts: ["First corner", "Opposite corner"],
        build: ([a, b]) => {
          const rx = Math.abs(b.x - a.x) / 2;
          const ry = Math.abs(b.y - a.y) / 2;
          return rx > 0 && ry > 0 ? { kind: "ellipse", center: mid(a, b), rx, ry, rotation: 0 } : null;
        },
      },
      {
        id: "centerAxes",
        label: "Center + Axes (Rotated)",
        points: 3,
        prompts: ["Center", "End of first axis", "Second axis length"],
        build: (pts) => {
          const [c, p] = pts;
          const rx = dist(c, p);
          if (rx === 0) return null;
          if (pts.length < 3) return { kind: "line", a: c, b: p };
          const u = normalize(sub(p, c));
          const ry = Math.abs(dot(sub(pts[2], c), perp(u)));
          return ry > 0 ? { kind: "ellipse", center: c, rx, ry, rotation: angleOf(u) } : null;
        },
      },
    ],
  },
  {
    id: "polygon",
    label: "Regular Polygon",
    key: "g",
    methods: [
      {
        id: "vertices",
        label: "Vertices",
        points: "many",
        min: 3,
        closes: true,
        prompts: ["First vertex", "Next vertex — click the first point, Enter, or double-click to close"],
        build: (pts) => {
          if (pts.length < 2) return null;
          if (pts.length < 3) return { kind: "polyline", points: pts, closed: false };
          return { kind: "polygon", points: pts };
        },
      },
      {
        id: "inscribed",
        label: "Center-Vertex",
        points: 2,
        prompts: ["Center", "A vertex"],
        build: ([c, p], { settings }) => (dist(c, p) > 0 ? { kind: "polygon", points: regularPolygon(c, p, settings.polygonSides, "inscribed"), regular: true } : null),
      },
      {
        id: "circumscribed",
        label: "Center-Side",
        points: 2,
        prompts: ["Center", "Middle of a side"],
        build: ([c, p], { settings }) => (dist(c, p) > 0 ? { kind: "polygon", points: regularPolygon(c, p, settings.polygonSides, "circumscribed"), regular: true } : null),
      },
      {
        id: "edge",
        label: "Edge",
        points: 2,
        prompts: ["Edge start", "Edge end (polygon builds to the left)"],
        build: ([a, b], { settings }) => (dist(a, b) > 0 ? { kind: "polygon", points: regularPolygonFromEdge(a, b, settings.polygonSides), regular: true } : null),
      },
    ],
  },
  {
    id: "spline",
    label: "Curve",
    key: "s",
    methods: [
      {
        id: "interpolated",
        label: "Through Points",
        points: "many",
        min: 2,
        prompts: ["First point", "Next point (Enter or double-click to finish)"],
        build: (pts) => (pts.length >= 2 ? { kind: "spline", points: pts, mode: "interpolated", closed: false } : null),
      },
      {
        id: "bspline",
        label: "Control Points",
        points: "many",
        min: 2,
        prompts: ["First control point", "Next control point (Enter or double-click to finish)"],
        build: (pts) => (pts.length >= 2 ? { kind: "spline", points: pts, mode: "bspline", closed: false } : null),
      },
      {
        id: "freehand",
        label: "Freehand",
        points: "many",
        min: 2,
        freehand: true,
        prompts: ["Press and drag to draw"],
        build: (pts) => (pts.length >= 2 ? { kind: "spline", points: pts, mode: "interpolated", closed: false } : null),
      },
    ],
  },
  {
    id: "guide",
    label: "Graphic Guide",
    key: "u",
    methods: [
      { id: "horizontal", label: "Horizontal", points: 1, prompts: ["Click a point the guide passes through"], build: ([p]) => ({ kind: "guide", point: p, dir: { x: 1, y: 0 } }) },
      { id: "vertical", label: "Vertical", points: 1, prompts: ["Click a point the guide passes through"], build: ([p]) => ({ kind: "guide", point: p, dir: { x: 0, y: 1 } }) },
      {
        id: "angled",
        label: "Angled",
        points: 1,
        prompts: ["Click a point (angle in Methods bar)"],
        build: ([p], { settings }) => ({ kind: "guide", point: p, dir: fromAngle((settings.guideAngle * Math.PI) / 180) }),
      },
      {
        id: "twoPoint",
        label: "Through Two Points",
        points: 2,
        prompts: ["First point", "Second point"],
        build: ([a, b]) => (dist(a, b) > 0 ? { kind: "guide", point: a, dir: normalize(sub(b, a)) } : null),
      },
      {
        id: "perpendicular",
        label: "Perpendicular",
        points: 1,
        rawPicks: [0],
        prompts: ["Click a line, arc or circle — the guide is perpendicular there"],
        build: ([p], ctx) => {
          const prim = ctx.primAt(p);
          if (!prim) return null;
          const t = tangentAt(prim, p);
          return t ? { kind: "guide", point: t.point, dir: perp(t.dir) } : null;
        },
      },
      {
        id: "parallel",
        label: "Parallel",
        points: 2,
        rawPicks: [0],
        prompts: ["Click the line or curve to match", "Point the parallel guide passes through"],
        build: (pts, ctx) => {
          const prim = ctx.primAt(pts[0]);
          if (!prim) return null;
          const t = tangentAt(prim, pts[0]);
          if (!t) return null;
          return { kind: "guide", point: pts[1] ?? t.point, dir: t.dir };
        },
      },
    ],
  },
];

const ORDER: ToolId[] = ["select", "line", "doubleLine", "wall", "rect", "circle", "arc", "ellipse", "polygon", "spline", "guide", "dimension", "trim", "extend", "split", "offset", "fillet", "chamfer", "symbol", "text"];
const ALL = [...DRAW_TOOLS, ...EDIT_TOOLS];
/** Tools in palette order. */
export const TOOLS: ToolDef[] = ORDER.map((id) => ALL.find((t) => t.id === id)!);

export const toolDef = (id: ToolId) => TOOLS.find((t) => t.id === id)!;
export const methodDef = (tool: ToolId, method: string) => {
  const t = toolDef(tool);
  return t.methods.find((m) => m.id === method) ?? t.methods[0];
};

