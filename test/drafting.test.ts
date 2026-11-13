import { describe, expect, test, beforeEach } from "bun:test";
import { arcFromTangent, dist } from "../src/kernel";
import type { Entity } from "../src/kernel/types";
import { parseDocument, serializeDocument } from "../src/io/nativeJson";
import { copyEntities, alignSelection } from "../src/state/arrange";
import { expandSelection, groupSelection, ungroupSelection } from "../src/state/groups";
import { copySelection, pasteSelection } from "../src/state/clipboard";
import { applyOps } from "../src/state/ops";
import { newDocument, useDocumentStore } from "../src/state/useDocumentStore";
import { normalizeSheet, sheetPages } from "../src/state/sheetModel";
import { EntityIndex } from "../src/kernel/spatialIndex";
import { translation } from "../src/kernel/transform";

const S = () => useDocumentStore.getState();
const line = (id: string, ax: number, ay: number, bx: number, by: number, groupId?: string): Entity => ({
  id,
  layerId: "layer-1",
  kind: "line",
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  ...(groupId ? { groupId } : {}),
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
      entities: [line("a", 0, 0, 10, 0, "g1"), line("b", 0, 5, 10, 5, "g1"), line("c", 100, 100, 110, 100)],
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
    const gid = S().doc.entities[0].groupId;
    expect(gid).toBeTruthy();
    expect(S().doc.entities.every((e) => e.groupId === gid)).toBe(true);
    const copies = copyEntities(S().doc.entities, translation(5, 0), () => `c${Math.random()}`);
    expect(copies[0].groupId).toBeTruthy();
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe(gid);
    ungroupSelection();
    expect(S().doc.entities.every((e) => !e.groupId)).toBe(true);
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
});
