import { describe, expect, test } from "bun:test";
import {
  type Entity,
  type Prim,
  circleCircle,
  closestOnPrim,
  entityBBox,
  intersectEntities,
  intersectPrims,
  lineCircle,
  lineLine,
  primBBox,
  primPoint,
  rotate,
  splinePrim,
  toPrims,
  dist,
} from "../src/kernel";

const TOL = 1e-9;
const close = (a: { x: number; y: number }, b: { x: number; y: number }, tol = TOL) =>
  expect(dist(a, b)).toBeLessThanOrEqual(tol);
const sortPts = <T extends { x: number; y: number }>(p: T[]) => [...p].sort((a, b) => a.x - b.x || a.y - b.y);

describe("closed-form kernels", () => {
  test("line-line crossing", () => {
    const r = lineLine({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: -2 })!;
    close(r.point, { x: 1, y: 1 });
    expect(r.t).toBeCloseTo(0.5, 12);
    expect(r.u).toBeCloseTo(0.5, 12);
  });

  test("parallel lines do not intersect", () => {
    expect(lineLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 5, y: 0 })).toBeNull();
  });

  test("line-circle: two, tangent, none", () => {
    expect(lineCircle({ x: -5, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 2)).toEqual([3, 7]);
    expect(lineCircle({ x: -5, y: 2 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 2)).toEqual([5]);
    expect(lineCircle({ x: -5, y: 3 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 2)).toEqual([]);
  });

  test("circle-circle: 3-4-5 triangle", () => {
    const pts = sortPts(circleCircle({ x: 0, y: 0 }, 5, { x: 6, y: 0 }, 5));
    close(pts[0], { x: 3, y: -4 });
    close(pts[1], { x: 3, y: 4 });
  });

  test("circle-circle: external tangent and concentric", () => {
    const t = circleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 0 }, 2);
    expect(t.length).toBe(1);
    close(t[0], { x: 1, y: 0 });
    expect(circleCircle({ x: 0, y: 0 }, 1, { x: 0, y: 0 }, 2)).toEqual([]);
  });
});

describe("primitive intersections", () => {
  test("segments outside their range miss, but meet when extended", () => {
    const a: Prim = { t: "seg", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    const b: Prim = { t: "seg", a: { x: 3, y: -1 }, b: { x: 3, y: 1 } };
    expect(intersectPrims(a, b)).toEqual([]);
    const ext = intersectPrims(a, b, { extend: true });
    expect(ext.length).toBe(1);
    close(ext[0].point, { x: 3, y: 0 });
  });

  test("segment touching another at its end counts", () => {
    const a: Prim = { t: "seg", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    const b: Prim = { t: "seg", a: { x: 1, y: 0 }, b: { x: 1, y: 5 } };
    expect(intersectPrims(a, b).length).toBe(1);
  });

  test("line vs arc respects the sweep", () => {
    const arc: Prim = { t: "arc", c: { x: 0, y: 0 }, r: 1, start: 0, sweep: Math.PI }; // upper half
    const line: Prim = { t: "seg", a: { x: -2, y: 0.5 }, b: { x: 2, y: 0.5 } };
    const low: Prim = { t: "seg", a: { x: -2, y: -0.5 }, b: { x: 2, y: -0.5 } };
    const hits = intersectPrims(line, arc);
    expect(hits.length).toBe(2);
    for (const h of hits) expect(Math.abs(dist(h.point, { x: 0, y: 0 }) - 1)).toBeLessThan(TOL);
    expect(intersectPrims(low, arc)).toEqual([]);
    expect(intersectPrims(low, arc, { extend: true }).length).toBe(2);
  });

  test("arc vs arc filters both sweeps", () => {
    const a: Prim = { t: "arc", c: { x: 0, y: 0 }, r: 5, start: 0, sweep: Math.PI }; // upper half
    const b: Prim = { t: "arc", c: { x: 6, y: 0 }, r: 5, start: 0, sweep: 2 * Math.PI };
    const hits = intersectPrims(a, b);
    expect(hits.length).toBe(1);
    close(hits[0].point, { x: 3, y: 4 });
  });

  test("line vs rotated ellipse is exact", () => {
    const e: Prim = { t: "ell", c: { x: 1, y: 2 }, rx: 4, ry: 1.5, rot: 0.6, start: 0, sweep: 2 * Math.PI };
    const line: Prim = { t: "xline", p: { x: -10, y: 1 }, d: { x: 1, y: 0.2 } };
    const hits = intersectPrims(line, e);
    expect(hits.length).toBe(2);
    for (const h of hits) {
      // Point must satisfy the ellipse's implicit equation.
      const l = rotate({ x: h.point.x - 1, y: h.point.y - 2 }, -0.6);
      expect(Math.abs((l.x / 4) ** 2 + (l.y / 1.5) ** 2 - 1)).toBeLessThan(TOL);
      close(primPoint(e, h.u2), h.point, 1e-8);
    }
  });

  test("ellipse vs circle is refined to 1e-9", () => {
    const e: Prim = { t: "ell", c: { x: 0, y: 0 }, rx: 5, ry: 2, rot: 0.3, start: 0, sweep: 2 * Math.PI };
    const c: Prim = { t: "arc", c: { x: 2, y: 1 }, r: 2.5, start: 0, sweep: 2 * Math.PI };
    const hits = intersectPrims(e, c);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) {
      expect(Math.abs(dist(h.point, { x: 2, y: 1 }) - 2.5)).toBeLessThan(TOL);
      const l = rotate(h.point, -0.3);
      expect(Math.abs((l.x / 5) ** 2 + (l.y / 2) ** 2 - 1)).toBeLessThan(TOL);
    }
  });

  test("line vs spline lands on the curve", () => {
    const s = splinePrim(
      [
        { x: 0, y: 0 },
        { x: 2, y: 3 },
        { x: 4, y: -1 },
        { x: 6, y: 2 },
      ],
      "interpolated",
      false,
    )!;
    const line: Prim = { t: "xline", p: { x: 0, y: 1 }, d: { x: 1, y: 0 } };
    const hits = intersectPrims(line, s);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (const h of hits) {
      expect(Math.abs(h.point.y - 1)).toBeLessThan(TOL);
      close(s.ev(h.u2), h.point, TOL);
    }
  });

  test("entity-level: rectangle crossed by a line gives two points", () => {
    const rect: Entity = { id: "r", layerId: "L", kind: "rect", center: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0, cornerRadius: 0 };
    const line: Entity = { id: "l", layerId: "L", kind: "line", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } };
    const pts = sortPts(intersectEntities(rect, line));
    expect(pts.length).toBe(2);
    close(pts[0], { x: -2, y: 0 });
    close(pts[1], { x: 2, y: 0 });
  });
});

describe("splines", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: 7, y: 1 },
    { x: 10, y: 5 },
  ];
  test("interpolated spline passes through every fit point", () => {
    const s = splinePrim(pts, "interpolated", false)!;
    pts.forEach((p, i) => close(s.ev(i), p, 1e-12));
  });
  test("clamped B-spline starts and ends on the end control points", () => {
    const s = splinePrim(pts, "bspline", false)!;
    close(s.ev(s.u0), pts[0], 1e-12);
    close(s.ev(s.u1), pts[3], 1e-12);
  });
});

describe("bounding boxes and closest points", () => {
  test("arc bbox includes only quadrants inside the sweep", () => {
    const b = primBBox({ t: "arc", c: { x: 0, y: 0 }, r: 2, start: 0, sweep: Math.PI / 2 })!;
    expect(b.minX).toBeCloseTo(0, 12);
    expect(b.minY).toBeCloseTo(0, 12);
    expect(b.maxX).toBeCloseTo(2, 12);
    expect(b.maxY).toBeCloseTo(2, 12);
  });

  test("rotated ellipse bbox is tight", () => {
    const b = primBBox({ t: "ell", c: { x: 0, y: 0 }, rx: 3, ry: 1, rot: Math.PI / 2, start: 0, sweep: 2 * Math.PI })!;
    expect(b.maxX).toBeCloseTo(1, 12);
    expect(b.maxY).toBeCloseTo(3, 12);
  });

  test("guides are unbounded", () => {
    expect(entityBBox({ id: "g", layerId: "L", kind: "guide", point: { x: 0, y: 0 }, dir: { x: 1, y: 0 } })).toBeNull();
  });

  test("closest point on ellipse is a true foot point", () => {
    const e: Prim = { t: "ell", c: { x: 0, y: 0 }, rx: 5, ry: 2, rot: 0, start: 0, sweep: 2 * Math.PI };
    const h = closestOnPrim(e, { x: 3, y: 4 });
    const l = h.point;
    expect(Math.abs((l.x / 5) ** 2 + (l.y / 2) ** 2 - 1)).toBeLessThan(1e-9);
    // Brute force check.
    let best = Infinity;
    for (let i = 0; i < 200000; i++) best = Math.min(best, dist(primPoint(e, (i / 200000) * 2 * Math.PI), { x: 3, y: 4 }));
    expect(h.distance).toBeLessThanOrEqual(best + 1e-9);
  });

  test("rounded rectangle has 4 edges and 4 quarter arcs", () => {
    const prims = toPrims({ id: "r", layerId: "L", kind: "rect", center: { x: 0, y: 0 }, width: 10, height: 6, rotation: 0.3, cornerRadius: 1 });
    expect(prims.filter((p) => p.t === "seg").length).toBe(4);
    expect(prims.filter((p) => p.t === "arc").length).toBe(4);
  });

  test("symbol instances are transformed from their definition", () => {
    const symbols = new Map([
      ["s", { id: "s", name: "unit", origin: { x: 0, y: 0 }, entities: [{ id: "c", layerId: "L", kind: "line" as const, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }] }],
    ]);
    const prims = toPrims({ id: "i", layerId: "L", kind: "symbol", symbolId: "s", position: { x: 5, y: 5 }, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 }, { symbols });
    expect(prims.length).toBe(1);
    const seg = prims[0] as Extract<Prim, { t: "seg" }>;
    close(seg.a, { x: 5, y: 5 });
    close(seg.b, { x: 5, y: 7 });
  });
});
