import { describe, expect, test } from "bun:test";
import { type Entity, type Modifiers, EntityIndex, SpatialIndex, dist, snap } from "../src/kernel";

const L = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({
  id,
  layerId: "L",
  kind: "line",
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});
const all: Modifiers = {
  endpoint: true,
  midpoint: true,
  center: true,
  quadrant: true,
  intersection: true,
  perpendicular: true,
  tangent: true,
  nearest: true,
  insertion: true,
};
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => expect(dist(a, b)).toBeLessThan(1e-9);

describe("spatial index", () => {
  test("search, remove and unbounded entries", () => {
    const s = new SpatialIndex();
    s.set("a", { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    s.set("b", { minX: 10, minY: 10, maxX: 11, maxY: 11 });
    s.set("g", null);
    expect(s.search({ minX: -1, minY: -1, maxX: 2, maxY: 2 }).sort()).toEqual(["a", "g"]);
    s.remove("a");
    expect(s.search({ minX: -1, minY: -1, maxX: 2, maxY: 2 })).toEqual(["g"]);
    expect(s.searchInside({ minX: 9, minY: 9, maxX: 12, maxY: 12 })).toEqual(["b"]);
  });

  test("nearest uses exact geometry, not boxes", () => {
    // Diagonal line's box covers the query point, but the line itself is far away.
    const idx = new EntityIndex([L("diag", 0, 0, 10, 10), L("h", 0, 4.6, 10, 4.6)]);
    const res = idx.nearest({ x: 8, y: 2 }, 3);
    expect(res[0].entity.id).toBe("h");
  });

  test("upsert moves an entity", () => {
    const idx = new EntityIndex([L("a", 0, 0, 1, 0)]);
    idx.upsert(L("a", 100, 0, 101, 0));
    expect(idx.around({ x: 0, y: 0 }, 1)).toEqual([]);
    expect(idx.around({ x: 100, y: 0 }, 1).length).toBe(1);
  });
});

describe("point snaps", () => {
  const idx = new EntityIndex([
    L("h", 0, 0, 10, 0),
    L("v", 5, -5, 5, 5),
    { id: "c", layerId: "L", kind: "circle", center: { x: 20, y: 0 }, r: 3 },
    { id: "a", layerId: "L", kind: "arc", center: { x: 40, y: 0 }, r: 2, start: 0, end: Math.PI / 2 },
  ]);
  const s = (x: number, y: number, extra: Partial<Parameters<typeof snap>[3]> = {}, m: Modifiers = all) =>
    snap({ x, y }, idx, { modifiers: m, tolerance: 0.5 }, extra);

  test("endpoint", () => {
    const r = s(9.8, 0.2);
    expect(r.kind).toBe("endpoint");
    expect(r.label).toBe("END");
    near(r.point, { x: 10, y: 0 });
  });

  test("intersection beats midpoint at the same place", () => {
    const r = s(5.1, 0.1);
    expect(r.kind).toBe("intersection");
    near(r.point, { x: 5, y: 0 });
    expect(r.entityIds.sort()).toEqual(["h", "v"]);
  });

  test("midpoint when intersections are off", () => {
    const r = s(5.1, 0.1, {}, { ...all, intersection: false });
    expect(r.kind).toBe("midpoint");
    near(r.point, { x: 5, y: 0 });
  });

  test("center and quadrant of a circle", () => {
    const c = s(20.2, 0.1);
    expect(c.kind).toBe("center");
    near(c.point, { x: 20, y: 0 });
    const q = s(20.1, 2.8);
    expect(q.kind).toBe("quadrant");
    near(q.point, { x: 20, y: 3 });
  });

  test("arc quadrants only inside the sweep; arc has ends and a midpoint", () => {
    const q = s(38.1, 0.1, {}, { quadrant: true });
    expect(q.kind).toBe("none"); // 180° is not on a 0–90° arc
    const m = s(41.4, 1.4);
    expect(m.kind).toBe("midpoint");
    near(m.point, { x: 40 + Math.SQRT2, y: Math.SQRT2 });
  });

  test("nearest point on entity", () => {
    const r = s(2.3, 0.3);
    expect(r.kind).toBe("nearest");
    near(r.point, { x: 2.3, y: 0 });
  });

  test("perpendicular from the previous point", () => {
    const r = s(7.2, 0.2, { from: { x: 7, y: 6 } }, { perpendicular: true });
    expect(r.kind).toBe("perpendicular");
    near(r.point, { x: 7, y: 0 });
  });

  test("tangent to a circle from an outside point", () => {
    // From (20, 6) to circle r=3 at (20,0): tangent points at angle 90° ± 60°.
    const from = { x: 20, y: 6 };
    const t = { x: 20 + 3 * Math.cos(Math.PI / 6), y: 3 * Math.sin(Math.PI / 6) };
    const r = s(t.x + 0.1, t.y, { from }, { tangent: true });
    expect(r.kind).toBe("tangent");
    near(r.point, t);
  });

  test("excluded entities are ignored", () => {
    const r = s(9.8, 0.2, { exclude: new Set(["h"]) }, { endpoint: true });
    expect(r.kind).toBe("none");
  });
});

describe("constraints and guides", () => {
  const idx = new EntityIndex([L("far", 100, 100, 110, 100), L("far2", 120, 90, 120, 95)]);

  test("grid snap when nothing else is in range", () => {
    const r = snap({ x: 12.4, y: 7.6 }, idx, { modifiers: { endpoint: true, grid: true }, tolerance: 0.5, grid: { spacing: 5 } });
    expect(r.kind).toBe("grid");
    near(r.point, { x: 10, y: 10 });
  });

  test("angle lock to 15° steps", () => {
    const r = snap(
      { x: 10, y: 2.5 },
      idx,
      { modifiers: { angle: true }, tolerance: 0.5, angleStep: Math.PI / 12 },
      { from: { x: 0, y: 0 } },
    );
    expect(r.kind).toBe("angle");
    expect(r.label).toBe("15°");
    expect(Math.atan2(r.point.y, r.point.x)).toBeCloseTo(Math.PI / 12, 12);
  });

  test("alignment with a reference point, and with two at once", () => {
    const r = snap({ x: 3.2, y: 40 }, idx, { modifiers: { alignment: true }, tolerance: 0.5 }, { anchors: [{ x: 3, y: 0 }] });
    expect(r.kind).toBe("alignment");
    near(r.point, { x: 3, y: 40 });
    expect(r.guides.length).toBe(1);
    const both = snap(
      { x: 3.2, y: 7.1 },
      idx,
      { modifiers: { alignment: true }, tolerance: 0.5 },
      { anchors: [{ x: 3, y: 0 }, { x: 50, y: 7 }] },
    );
    near(both.point, { x: 3, y: 7 });
    expect(both.guides.length).toBe(2);
  });

  test("apparent intersection of two lines that don't touch", () => {
    // Line "far" extended to x=120 meets "far2" extended to y=100.
    const r = snap({ x: 120.2, y: 100.1 }, idx, { modifiers: { apparent: true }, tolerance: 0.5 }, { apparentRange: 30 });
    expect(r.kind).toBe("apparent");
    near(r.point, { x: 120, y: 100 });
  });
});
