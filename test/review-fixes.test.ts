// Regression tests for the Milestone 1 architect review.
import { describe, expect, test } from "bun:test";
import {
  type Entity,
  type Prim,
  EntityIndex,
  bulgeArc,
  circle3P,
  dist,
  entityBBox,
  parseLength,
  primDeriv,
  primPoint,
  splinePrim,
  toPrims,
  len,
} from "../src/kernel";

const close = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 1e-9) =>
  expect(dist(a, b)).toBeLessThanOrEqual(tol);

describe("polyline bulges", () => {
  test("bulge 1 is a CCW semicircle", () => {
    const arc = bulgeArc({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    close(arc.c, { x: 1, y: 0 });
    expect(arc.r).toBeCloseTo(1, 12);
    expect(arc.sweep).toBeCloseTo(Math.PI, 12);
    // CCW from (0,0) to (2,0) around (1,0) passes below: through (1,-1).
    close(primPoint(arc, arc.start + arc.sweep / 2), { x: 1, y: -1 });
  });

  test("negative bulge goes the other way and ends still match", () => {
    const arc = bulgeArc({ x: 0, y: 0 }, { x: 2, y: 0 }, -0.5);
    const ends = [primPoint(arc, arc.start), primPoint(arc, arc.start + arc.sweep)];
    expect(ends.some((e) => dist(e, { x: 0, y: 0 }) < 1e-9)).toBe(true);
    expect(ends.some((e) => dist(e, { x: 2, y: 0 }) < 1e-9)).toBe(true);
    expect(primPoint(arc, arc.start + arc.sweep / 2).y).toBeGreaterThan(0);
  });

  test("polyline with a bulge yields an arc primitive", () => {
    const prims = toPrims({ id: "p", layerId: "L", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], closed: false, bulges: [0, 1] });
    expect(prims.map((p) => p.t)).toEqual(["seg", "arc"]);
  });
});

describe("symbols with mirror and non-uniform scale", () => {
  const symbols = new Map([
    [
      "door",
      {
        id: "door",
        name: "door swing",
        origin: { x: 0, y: 0 },
        entities: [{ id: "a", layerId: "L", kind: "arc" as const, center: { x: 0, y: 0 }, r: 1, start: 0, end: Math.PI / 2 }],
      },
    ],
  ]);
  const inst = (sx: number, sy: number): Entity => ({ id: "i", layerId: "L", kind: "symbol", symbolId: "door", position: { x: 10, y: 0 }, rotation: 0, scaleX: sx, scaleY: sy });

  test("mirrored arc stays an exact arc in the mirrored quadrant", () => {
    const [p] = toPrims(inst(-1, 1), { symbols });
    expect(p.t).toBe("arc");
    const a = p as Extract<Prim, { t: "arc" }>;
    // Quarter arc in quadrant II of (10,0): from (10,1) to (9,0).
    close(primPoint(a, a.start), { x: 10, y: 1 });
    close(primPoint(a, a.start + a.sweep), { x: 9, y: 0 });
  });

  test("non-uniform scale turns the arc into a curve with mapped points", () => {
    const [p] = toPrims(inst(2, 1), { symbols });
    expect(p.t).toBe("curve");
    close(primPoint(p, 0), { x: 12, y: 0 });
    close(primPoint(p, Math.PI / 2), { x: 10, y: 1 });
  });

  test("broken symbol has no box and is not returned by far-away queries", () => {
    const broken: Entity = { id: "b", layerId: "L", kind: "symbol", symbolId: "missing", position: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 };
    expect(entityBBox(broken)).toBeNull();
    const idx = new EntityIndex([broken]);
    expect(idx.around({ x: 1e9, y: 1e9 }, 1)).toEqual([]);
  });

  test("reindexSymbol picks up a changed definition", () => {
    const defs = new Map(symbols);
    const idx = new EntityIndex([inst(1, 1)], { symbols: defs });
    expect(idx.around({ x: 60, y: 0 }, 1)).toEqual([]);
    defs.set("door", { ...defs.get("door")!, entities: [{ id: "a", layerId: "L", kind: "arc", center: { x: 50, y: 0 }, r: 1, start: 0, end: 1 }] });
    idx.reindexSymbol("door");
    expect(idx.around({ x: 60, y: 0 }, 1).length).toBe(1);
  });
});

describe("NURBS splines", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: 7, y: 1 },
    { x: 10, y: 5 },
    { x: 12, y: 0 },
  ];

  test("clamped cubic: ends on end points, tangent along the control polygon", () => {
    const s = splinePrim({ points: pts, mode: "bspline", closed: false })!;
    close(s.ev(s.u0), pts[0], 1e-12);
    close(s.ev(s.u1), pts[4], 1e-12);
    const d0 = primDeriv(s, s.u0);
    expect(len(d0)).toBeGreaterThan(1);
    // Direction matches P1 - P0.
    expect(Math.abs(d0.x * 4 - d0.y * 3)).toBeLessThan(1e-4 * len(d0));
  });

  test("degree 1 is the control polygon", () => {
    const s = splinePrim({ points: pts, mode: "bspline", closed: false, degree: 1 })!;
    close(s.ev(1), pts[1], 1e-12);
    close(s.ev(2.5), { x: 8.5, y: 3 }, 1e-12);
  });

  test("closed periodic B-spline joins smoothly", () => {
    const s = splinePrim({ points: pts, mode: "bspline", closed: true })!;
    expect(s.closed).toBe(true);
    close(s.ev(s.u0), s.ev(s.u1), 1e-9);
  });

  test("rational weights pull the curve toward a control point", () => {
    const plain = splinePrim({ points: pts, mode: "bspline", closed: false })!;
    const heavy = splinePrim({ points: pts, mode: "bspline", closed: false, weights: [1, 1, 10, 1, 1] })!;
    const mid = (plain.u0 + plain.u1) / 2;
    expect(dist(heavy.ev(mid), pts[2])).toBeLessThan(dist(plain.ev(mid), pts[2]));
  });
});

describe("other review fixes", () => {
  test("partial ellipse uses start/end", () => {
    const [p] = toPrims({ id: "e", layerId: "L", kind: "ellipse", center: { x: 0, y: 0 }, rx: 4, ry: 2, rotation: 0, start: 0, end: Math.PI / 2 });
    expect(p.t === "ell" && p.sweep).toBeCloseTo(Math.PI / 2, 12);
    const b = entityBBox({ id: "e", layerId: "L", kind: "ellipse", center: { x: 0, y: 0 }, rx: 4, ry: 2, rotation: 0, start: 0, end: Math.PI / 2 })!;
    expect(b.minX).toBeCloseTo(0, 12);
    expect(b.minY).toBeCloseTo(0, 12);
  });

  test("circle3P stays accurate far from the origin", () => {
    const o = 3e6;
    const center = { x: o + 1.234, y: o - 0.567 };
    const r = 0.5;
    const at = (t: number) => ({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
    const c = circle3P(at(0.1), at(2.0), at(4.0))!;
    expect(dist(c.center, center)).toBeLessThan(1e-8);
    expect(Math.abs(c.r - r)).toBeLessThan(1e-8);
  });

  test("feet followed by a spaced dash subtracts", () => {
    const IN = 25.4;
    expect(parseLength(`10' - 6"`, "architectural")).toBeCloseTo(114 * IN, 9);
    expect(parseLength(`10'-6"`, "architectural")).toBeCloseTo(126 * IN, 9);
    expect(parseLength(`10' 6"`, "architectural")).toBeCloseTo(126 * IN, 9);
    expect(parseLength(`10' - 2'`, "architectural")).toBeCloseTo(96 * IN, 9);
  });
});
