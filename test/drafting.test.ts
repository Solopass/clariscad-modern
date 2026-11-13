import { describe, expect, test, beforeEach } from "bun:test";
import { arcFromTangent, dist, snap, trimAt, offsetEntity, EntityIndex } from "../src/kernel";
import { solveWalls, breakForCrossing } from "../src/kernel/wallSolver";
import { endingOutline, pathEnds } from "../src/kernel/endings";
import { matchShortcut } from "../src/input/keymap";
import type { Entity } from "../src/kernel/types";
import { parseDocument, serializeDocument } from "../src/io/nativeJson";
import { copyEntities, alignSelection } from "../src/state/arrange";
import { expandSelection, groupSelection, lockSelection, ungroupSelection } from "../src/state/groups";
import { copySelection, pasteSelection } from "../src/state/clipboard";
import { applyOps } from "../src/state/ops";
import { newDocument, useDocumentStore } from "../src/state/useDocumentStore";
import { normalizeSheet, sheetPages } from "../src/state/sheetModel";
import { translation } from "../src/kernel/transform";

const S = () => useDocumentStore.getState();
const line = (id: string, ax: number, ay: number, bx: number, by: number, groups?: string[]): Entity => ({
  id,
  layerId: "layer-1",
  kind: "line",
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  ...(groups ? { groups } : {}),
});

beforeEach(() => S().load(newDocument()));

describe("tangent arc", () => {
  test("leaves a horizontal tangent and ends up and to the right on a quarter circle", () => {
    const a = arcFromTangent({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 10 });
    expect(a).not.toBeNull();
    expect(a!.r).toBeCloseTo(10, 6);
    expect(a!.center.x).toBeCloseTo(0, 6);
    expect(a!.center.y).toBeCloseTo(10, 6);
    // The arc passes through both points.
    expect(dist({ x: a!.center.x + a!.r * Math.cos(a!.start), y: a!.center.y + a!.r * Math.sin(a!.start) }, { x: 0, y: 0 })).toBeCloseTo(0, 6);
  });

  test("the same curve below the tangent is the quarter circle under the line", () => {
    const a = arcFromTangent({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: -10 });
    expect(a).not.toBeNull();
    expect(a!.r).toBeCloseTo(10, 6);
    expect(a!.center.y).toBeCloseTo(-10, 6);
    const on = (ang: number) => ({ x: a!.center.x + a!.r * Math.cos(ang), y: a!.center.y + a!.r * Math.sin(ang) });
    const start = on(a!.start);
    const end = on(a!.end);
    const pts = [start, end];
    expect(pts.some((p) => dist(p, { x: 0, y: 0 }) < 1e-6)).toBe(true);
    expect(pts.some((p) => dist(p, { x: 10, y: -10 }) < 1e-6)).toBe(true);
  });

  test("a point straight along the tangent is not an arc", () => {
    expect(arcFromTangent({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 })).toBeNull();
  });
});

describe("sheet", () => {
  test("a file with no sheet opens as one landscape letter page", () => {
    const text = serializeDocument(newDocument()).replace(/,"sheet":\{[^}]*\}/, "");
    const r = parseDocument(text);
    expect(r.warnings).toEqual([]);
    expect(normalizeSheet(r.doc.sheet)).toEqual({ paperId: "letter", landscape: true, pagesX: 1, pagesY: 1 });
  });

  test("page size follows the active layer scale", () => {
    const doc = newDocument();
    doc.layers[0].scale = 48;
    const [page] = sheetPages(doc);
    // Letter landscape is 11 × 8.5 in, at 1/4" = 1'-0" (scale 48).
    expect(page.w).toBeCloseTo(11 * 25.4 * 48, 4);
    expect(page.h).toBeCloseTo(8.5 * 25.4 * 48, 4);
    expect(page.x).toBe(0);
    expect(page.y).toBe(0);
  });

  test("the sheet is an undoable document property", () => {
    const doc = newDocument();
    const index = new EntityIndex();
    const next = applyOps(doc, index, [{ op: "docProps", before: { sheet: doc.sheet }, after: { sheet: { paperId: "a4", landscape: false, pagesX: 2, pagesY: 1 } } }]);
    expect(next.sheet).toEqual({ paperId: "a4", landscape: false, pagesX: 2, pagesY: 1 });
    expect(next.units).toBe(doc.units);
    const back = applyOps(next, index, [{ op: "docProps", before: { sheet: next.sheet }, after: { sheet: doc.sheet } }]);
    expect(back.sheet).toEqual(doc.sheet);
  });
});

describe("groups, align, clipboard", () => {
  function add(...ents: Entity[]) {
    const doc = S().doc;
    S().commit({ label: "add", ops: ents.map((entity, k) => ({ op: "add" as const, entity, index: doc.entities.length + k })) });
  }

  test("clicking one member selects the group; an inside window does not, until every member is inside", () => {
    const doc = {
      ...newDocument(),
      entities: [line("a", 0, 0, 10, 0, ["g1"]), line("b", 0, 5, 10, 5, ["g1"]), line("c", 100, 100, 110, 100)],
    };
    expect(expandSelection(doc, ["a"], "click").sort()).toEqual(["a", "b"]);
    expect(expandSelection(doc, ["a"], "inside")).toEqual([]);
    expect(expandSelection(doc, ["a", "b"], "inside").sort()).toEqual(["a", "b"]);
    expect(expandSelection(doc, ["a"], "crossing").sort()).toEqual(["a", "b"]);
    expect(expandSelection(doc, ["c"], "click")).toEqual(["c"]);
  });

  test("group, copy and ungroup keep members together and then let them go", () => {
    add(line("a", 0, 0, 10, 0), line("b", 0, 20, 10, 20));
    S().setSelection(["a", "b"]);
    groupSelection();
    const gid = S().doc.entities[0].groups?.[0];
    expect(gid).toBeTruthy();
    expect(S().doc.entities.every((e) => e.groups?.[0] === gid)).toBe(true);
    const copies = copyEntities(S().doc.entities, translation(5, 0), () => `c${Math.random()}`);
    expect(copies[0].groups?.[0]).toBeTruthy();
    expect(copies[0].groups?.[0]).toBe(copies[1].groups?.[0]);
    expect(copies[0].groups?.[0]).not.toBe(gid);
    ungroupSelection();
    expect(S().doc.entities.every((e) => !e.groups?.length)).toBe(true);
  });

  test("align left lines up the left edges and is one undo", () => {
    add(line("a", 0, 0, 10, 0), line("b", 30, 10, 40, 10));
    S().setSelection(["a", "b"]);
    const before = S().undoStack.length;
    alignSelection("left");
    const xs = S().doc.entities.map((e) => (e.kind === "line" ? e.a.x : 0));
    expect(xs).toEqual([0, 0]);
    expect(S().undoStack.length).toBe(before + 1);
    S().undo();
    const back = S().doc.entities.find((e) => e.id === "b");
    expect(back && back.kind === "line" && back.a.x).toBe(30);
  });

  test("paste drops a shifted copy on the active layer", () => {
    add(line("a", 0, 0, 10, 0));
    S().setSelection(["a"]);
    expect(copySelection()).toBe(true);
    expect(pasteSelection()).toBe(true);
    expect(S().doc.entities.length).toBe(2);
    const copy = S().doc.entities[1];
    expect(copy.kind === "line" && copy.a.x).toBeCloseTo(25.4, 6);
    expect(S().selection.has(copy.id)).toBe(true);
  });

  test("grouping a group nests it, and one ungroup peels only the outer level", () => {
    add(line("a", 0, 0, 10, 0), line("b", 0, 10, 10, 10));
    S().setSelection(["a", "b"]);
    groupSelection();
    const inner = S().doc.entities[0].groups?.[0];
    add(line("c", 20, 0, 30, 0));
    S().setSelection(["a", "b", "c"]);
    groupSelection();
    const a = S().doc.entities.find((e) => e.id === "a")!;
    const c = S().doc.entities.find((e) => e.id === "c")!;
    expect(a.groups?.[0]).toBe(c.groups?.[0]);
    expect(a.groups?.[1]).toBe(inner);
    expect(expandSelection(S().doc, ["a"], "click").sort()).toEqual(["a", "b", "c"]);
    ungroupSelection();
    const a2 = S().doc.entities.find((e) => e.id === "a")!;
    const c2 = S().doc.entities.find((e) => e.id === "c")!;
    expect(a2.groups?.[0]).toBe(inner);
    expect(a2.groups?.length).toBe(1);
    expect(c2.groups).toBeUndefined();
  });

  test("lock clears the selection and a locked object stays out of a plain click", () => {
    add(line("a", 0, 0, 10, 0));
    S().setSelection(["a"]);
    lockSelection();
    expect(S().doc.entities[0].locked).toBe(true);
    expect(S().selection.size).toBe(0);
    expect(expandSelection(S().doc, ["a"], "click")).toEqual(["a"]);
  });
});

describe("curves, walls, arrows, snaps, keys", () => {
  const wall = (id: string, ax: number, ay: number, bx: number, by: number, t = 2): Extract<Entity, { kind: "wall" }> => ({
    id,
    layerId: "L",
    kind: "wall",
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: t,
    justify: "center",
  });

  test("three walls meeting at a point mitre instead of stopping square", () => {
    const a = Math.PI * 2 / 3;
    const out = solveWalls([
      wall("a", 0, 0, 20, 0),
      wall("b", 0, 0, 20 * Math.cos(a), 20 * Math.sin(a)),
      wall("c", 0, 0, 20 * Math.cos(2 * a), 20 * Math.sin(2 * a)),
    ]);
    for (const id of ["a", "b", "c"]) {
      const prims = out.get(id)!.prims.filter((p): p is Extract<typeof p, { t: "seg" }> => p.t === "seg");
      // A square cap would be a short segment with both ends next to the joint. The mitre has none.
      const caps = prims.filter((p) => Math.hypot(p.a.x, p.a.y) < 1.6 && Math.hypot(p.b.x, p.b.y) < 1.6);
      expect(caps.length).toBe(0);
      const near = prims.flatMap((p) => [p.a, p.b]).some((p) => Math.hypot(p.x, p.y) < 4);
      expect(near).toBe(true);
    }
  });

  test("a crossing wall can be broken into an opening", () => {
    const cut = breakForCrossing(wall("h", 0, 0, 20, 0, 2) as Extract<Entity, { kind: "wall" }>, wall("v", 10, -10, 10, 10, 2) as Extract<Entity, { kind: "wall" }>);
    expect(cut?.openings?.[0].at).toBeCloseTo(10, 6);
    expect(cut?.openings?.[0].width).toBe(2);
  });

  test("a spline trims and offsets", () => {
    const spline: Entity = { id: "s", layerId: "L", kind: "spline", points: [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 10, y: 0 }], mode: "interpolated", closed: false };
    const cutter: Entity = { id: "c", layerId: "L", kind: "line", a: { x: 5, y: -5 }, b: { x: 5, y: 5 } };
    const trimmed = trimAt(spline, { x: 1, y: 0 }, [cutter], () => "n");
    expect(trimmed).not.toBeNull();
    expect(trimmed!.replace.length + trimmed!.add.length).toBeGreaterThan(0);
    const off = offsetEntity(spline, 1, { x: 5, y: 4 }, () => "o");
    expect(off?.add[0].kind).toBe("spline");
  });

  test("an ellipse offsets to a larger curve", () => {
    const ell: Entity = { id: "e", layerId: "L", kind: "ellipse", center: { x: 0, y: 0 }, rx: 4, ry: 2, rotation: 0 };
    const off = offsetEntity(ell, 1, { x: 10, y: 0 }, () => "o");
    expect(off?.add[0].kind).toBe("spline");
    const pts = off!.add[0].kind === "spline" ? off!.add[0].points : [];
    expect(Math.max(...pts.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(4);
  });

  test("tangent snap finds a point on an ellipse", () => {
    const ell: Entity = { id: "e", layerId: "L", kind: "ellipse", center: { x: 0, y: 0 }, rx: 4, ry: 2, rotation: 0 };
    const index = new EntityIndex([ell]);
    const res = snap({ x: 3, y: 2 }, index, { modifiers: { tangent: true, endpoint: false, midpoint: false, center: false, intersection: false, quadrant: false, perpendicular: false, nearest: false, apparent: false, alignment: false, insertion: false, angle: false, grid: false, parallel: false }, tolerance: 20, grid: { spacing: 1 }, angleStep: 0 }, { from: { x: 10, y: 0 } });
    expect(res?.kind).toBe("tangent");
    const p = res!.point;
    expect(Math.abs((p.x * p.x) / 16 + (p.y * p.y) / 4 - 1)).toBeLessThan(1e-3);
  });

  test("a line ending is an arrow sitting on the end point", () => {
    const ln: Entity = { id: "l", layerId: "L", kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, style: { endEnding: "arrow" } };
    const ends = pathEnds(ln);
    expect(ends[1].tip).toEqual({ x: 10, y: 0 });
    const shape = endingOutline(ends[1].tip, ends[1].dir, "arrow", 3);
    expect(shape.fill).toBe(true);
    expect(shape.pts[0]).toEqual({ x: 10, y: 0 });
  });

  test("the shortcut list matches what the key handler looks up", () => {
    expect(matchShortcut({ key: "g", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id).toBe("arrange.group");
    expect(matchShortcut({ key: "G", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })?.id).toBe("arrange.ungroup");
    expect(matchShortcut({ key: "l", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })?.id).toBe("tool:line");
    expect(matchShortcut({ key: "f", ctrlKey: false, metaKey: false, shiftKey: true, altKey: false })?.id).toBe("view.fitPage");
    expect(matchShortcut({ key: "Escape", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBeUndefined();
  });
});
