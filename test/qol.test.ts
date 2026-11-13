import { describe, expect, test } from "bun:test";
import { intersectPrims } from "../src/kernel/intersections";
import { LINE_HEIGHT, textBoxCorners, textLines, textWidth } from "../src/kernel/textMetrics";
import { booleanPolygons, entityAreaAndPerimeter, findEnclosedRegion, ringArea } from "../src/kernel/regionOps";
import { formatArea } from "../src/kernel/units";
import { useDocumentStore } from "../src/state/useDocumentStore";
import { booleanSelection } from "../src/state/arrange";
import { type Entity } from "../src/kernel/types";
import { describeSelection } from "../src/state/inspect";

describe("tangent touch intersections", () => {
  test("line tangent to an ellipse at its top vertex", () => {
    const line = { t: "seg" as const, a: { x: -50, y: 30 }, b: { x: 50, y: 30 } };
    const ell = { t: "ell" as const, c: { x: 0, y: 0 }, rx: 40, ry: 30, rot: 0, start: 0, sweep: 2 * Math.PI };
    const hits = intersectPrims(line, ell);
    expect(hits.length).toBe(1);
    expect(hits[0].point.x).toBeCloseTo(0, 6);
    expect(hits[0].point.y).toBeCloseTo(30, 6);
  });

  test("two externally tangent ellipses meet at the touch point", () => {
    const e1 = { t: "ell" as const, c: { x: 0, y: 0 }, rx: 40, ry: 25, rot: 0, start: 0, sweep: 2 * Math.PI };
    const e2 = { t: "ell" as const, c: { x: 70, y: 0 }, rx: 30, ry: 20, rot: 0, start: 0, sweep: 2 * Math.PI };
    const hits = intersectPrims(e1, e2);
    expect(hits.length).toBe(1);
    expect(hits[0].point.x).toBeCloseTo(40, 5);
    expect(hits[0].point.y).toBeCloseTo(0, 5);
  });
});

describe("multi-line text metrics", () => {
  test("splits lines and expands bounding box height by LINE_HEIGHT", () => {
    expect(textLines("A\nBC\r\nD")).toEqual(["A", "BC", "D"]);
    expect(textWidth("A\nMMMM", 10)).toBeCloseTo(textWidth("MMMM", 10), 6);
    const single = textBoxCorners({ x: 0, y: 0 }, "Hello", 10, 0, "left");
    const multi = textBoxCorners({ x: 0, y: 0 }, "Hello\nWorld", 10, 0, "left");
    expect(single[0].y).toBeCloseTo(-2.2, 6);
    expect(multi[0].y).toBeCloseTo(-2.2 - LINE_HEIGHT * 10, 6);
  });
});

describe("regionOps: area, booleans, enclosed hatch", () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  test("union, subtract, intersect of overlapping rectangles", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(50, 0, 150, 100)];
    const u = booleanPolygons(a, b, "union");
    expect(u.length).toBe(1);
    expect(Math.abs(ringArea(u[0]))).toBeCloseTo(15000, 3);

    const s = booleanPolygons(a, b, "subtract");
    expect(s.length).toBe(1);
    expect(Math.abs(ringArea(s[0]))).toBeCloseTo(5000, 3);

    const i = booleanPolygons(a, b, "intersect");
    expect(i.length).toBe(1);
    expect(Math.abs(ringArea(i[0]))).toBeCloseTo(5000, 3);
  });

  test("findEnclosedRegion finds minimal loop around pick point and ignores outside", () => {
    const mk = (id: string, x1: number, y1: number, x2: number, y2: number): Entity => ({
      id,
      layerId: "layer-1",
      kind: "line",
      a: { x: x1, y: y1 },
      b: { x: x2, y: y2 },
    });
    const ents: Entity[] = [
      mk("1", -10, 0, 110, 0),
      mk("2", 100, -10, 100, 110),
      mk("3", 110, 100, -10, 100),
      mk("4", 0, 110, 0, -10),
    ];
    const inside = findEnclosedRegion({ x: 50, y: 50 }, ents);
    expect(inside).not.toBeNull();
    expect(Math.abs(ringArea(inside!))).toBeCloseTo(10000, 2);

    const outside = findEnclosedRegion({ x: 200, y: 200 }, ents);
    expect(outside).toBeNull();
  });

  test("booleanSelection updates document and is one undo step", () => {
    const ds = useDocumentStore.getState();
    const doc = ds.doc;
    const r1: Entity = { id: "r1", layerId: doc.activeLayerId, kind: "rect", center: { x: 50, y: 50 }, width: 100, height: 100, rotation: 0, cornerRadius: 0 };
    const r2: Entity = { id: "r2", layerId: doc.activeLayerId, kind: "rect", center: { x: 100, y: 50 }, width: 100, height: 100, rotation: 0, cornerRadius: 0 };
    ds.load({ ...doc, entities: [r1, r2] });
    ds.setSelection(["r1", "r2"]);
    expect(booleanSelection("union")).toBe(true);
    expect(useDocumentStore.getState().doc.entities.length).toBe(1);
    const poly = useDocumentStore.getState().doc.entities[0];
    expect(poly.kind).toBe("polyline");
    const m = entityAreaAndPerimeter(poly);
    expect(m?.area).toBeCloseTo(15000, 1);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().doc.entities.length).toBe(2);
  });

  test("Get Info includes area and perimeter for closed shapes", () => {
    const ds = useDocumentStore.getState();
    const doc = ds.doc;
    const r1: Entity = { id: "r1", layerId: doc.activeLayerId, kind: "rect", center: { x: 50, y: 50 }, width: 100, height: 50, rotation: 0, cornerRadius: 0 };
    ds.load({ ...doc, units: "mm", entities: [r1] });
    ds.setSelection(["r1"]);
    const info = describeSelection();
    expect(info?.note).toContain("5000.0 mm²");
    expect(formatArea(1000, "mm")).toBe("1000.0 mm²");
  });
});
