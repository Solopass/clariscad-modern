import { beforeEach, describe, expect, test } from "bun:test";
import type { DimensionEntity, Entity, WallEntity } from "../src/kernel/types";
import { STANDARDS, dimGeometry, flipDimension } from "../src/kernel/dimensions";
import { gripsOf, moveHandle } from "../src/kernel/handles";
import { formatLength } from "../src/kernel/units";
import { newDocument, useDocumentStore } from "../src/state/useDocumentStore";
import { translation } from "../src/kernel/transform";
import { matchShortcut } from "../src/input/keymap";
import { solveWalls } from "../src/kernel/wallSolver";

const S = () => useDocumentStore.getState();
const grip = { scale: 1, units: "mm" as const, standard: "ANSI" as const };

beforeEach(() => {
  const doc = newDocument();
  doc.units = "mm";
  doc.layers[0].scale = 1;
  S().load(doc);
});

const add = (...es: Entity[]) => S().commit({ label: "add", ops: es.map((entity, i) => ({ op: "add" as const, entity, index: S().doc.entities.length + i })) });

function linearDim(): { line: Entity; dim: DimensionEntity } {
  const line: Entity = { id: "l", layerId: "layer-1", kind: "line", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
  const dim: DimensionEntity = {
    id: "d",
    layerId: "layer-1",
    kind: "dimension",
    dimType: "horizontal",
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    refs: [
      { entityId: "l", handle: "a" },
      { entityId: "l", handle: "b" },
    ],
    linePoint: { x: 50, y: 20 },
  };
  return { line, dim };
}

describe("dimension editing", () => {
  test("dragging the text does not change the measurement or the attachment", () => {
    const { line, dim } = linearDim();
    add(line, dim);
    const g0 = dimGeometry(dim, 1, STANDARDS.ANSI, "mm");
    const dropped = { x: g0.text!.pos.x + 12, y: g0.text!.pos.y + 6 };
    const moved = moveHandle(dim, "text", dropped, grip) as DimensionEntity;
    expect(moved.textShift).toEqual({ x: 12, y: 6 });
    expect(moved.linePoint).toEqual(dim.linePoint);
    expect(moved.refs).toEqual(dim.refs);
    S().commit({ label: "Move Text", ops: [{ op: "replace", before: dim, after: moved, grip: { handle: "text", to: dropped } }] });
    const shown = dimGeometry(S().doc.entities.find((e) => e.id === "d") as DimensionEntity, 1, STANDARDS.ANSI, "mm");
    expect(shown.value).toBeCloseTo(100, 6);
    expect(shown.text!.pos.x).toBeCloseTo(dropped.x, 6);
    expect(shown.text!.pos.y).toBeCloseTo(dropped.y, 6);
    expect(shown.text!.str).toBe(formatLength(100, "mm"));
  });

  test("the text offset stays attached when the measured line moves", () => {
    const { line, dim } = linearDim();
    const shifted: DimensionEntity = { ...dim, textShift: { x: 12, y: 6 } };
    add(line, shifted);
    const after = { ...line, a: { x: 10, y: 5 }, b: { x: 110, y: 5 } } as Entity;
    S().commit({ label: "Move", ops: [{ op: "replace", before: line, after, transform: translation(10, 5) }] });
    const d = S().doc.entities.find((e) => e.id === "d") as DimensionEntity;
    expect(d.refs.every((r) => r)).toBe(true);
    expect(d.textShift!.x).toBeCloseTo(12, 6);
    expect(d.textShift!.y).toBeCloseTo(6, 6);
    expect(dimGeometry(d, 1, STANDARDS.ANSI, "mm").value).toBeCloseTo(100, 6);
    expect(d.points[0]).toEqual({ x: 10, y: 5 });
  });

  test("flip side mirrors the dimension line and stays associative", () => {
    const { line, dim } = linearDim();
    const flipped = flipDimension(dim);
    expect(flipped.linePoint.y).toBeCloseTo(-20, 6);
    expect(flipped.refs).toEqual(dim.refs);
    add(line, flipped);
    const after = { ...line, a: { x: 0, y: 0 }, b: { x: 80, y: 0 } } as Entity;
    S().commit({ label: "Shorten", ops: [{ op: "replace", before: line, after, grip: { handle: "b", to: { x: 80, y: 0 } } }] });
    const d = S().doc.entities.find((e) => e.id === "d") as DimensionEntity;
    expect(d.linePoint.y).toBeLessThan(0);
    expect(dimGeometry(d, 1, STANDARDS.ANSI, "mm").value).toBeCloseTo(80, 6);
    expect(d.refs[1]).toEqual({ entityId: "l", handle: "b" });
  });

  test("a typed override replaces the measured text and a blank clears it", () => {
    const { dim } = linearDim();
    const over: DimensionEntity = { ...dim, textOverride: "WIDTH <>" };
    expect(dimGeometry(over, 1, STANDARDS.ANSI, "mm").text!.str).toBe(`WIDTH ${formatLength(100, "mm")}`);
    const cleared: DimensionEntity = { ...over, textOverride: "" };
    expect(dimGeometry(cleared, 1, STANDARDS.ANSI, "mm").text!.str).toBe(formatLength(100, "mm"));
  });

  test("flip and dimension text have shortcuts", () => {
    expect(matchShortcut({ key: "f", ctrlKey: false, metaKey: false, shiftKey: true, altKey: true })?.id).toBe("dim.flip");
    expect(matchShortcut({ key: "t", ctrlKey: false, metaKey: false, shiftKey: true, altKey: true })?.id).toBe("dim.text");
  });
});

describe("wall opening grips", () => {
  const wall = (): WallEntity => ({
    id: "w",
    layerId: "layer-1",
    kind: "wall",
    a: { x: 0, y: 0 },
    b: { x: 1000, y: 0 },
    thickness: 100,
    justify: "center",
    openings: [{ id: "o", at: 400, width: 200, swingFlip: false, symbolId: "builtin:door-single" }],
  });

  test("jamb drag resizes along the wall, the centre grip slides it, and the swing grip flips", () => {
    const w = wall();
    const names = gripsOf(w, grip).map((h) => h.name);
    expect(names).toContain("open:o:a");
    expect(names).toContain("open:o:b");
    expect(names).toContain("open:o:at");
    expect(names).toContain("open:o:swing");
    const wider = moveHandle(w, "open:o:b", { x: 600, y: 0 }, grip) as WallEntity;
    expect(wider.openings![0].width).toBeCloseTo(300, 4);
    expect(wider.openings![0].at).toBeCloseTo(450, 4);
    const slid = moveHandle(w, "open:o:at", { x: 700, y: 40 }, grip) as WallEntity;
    expect(slid.openings![0].at).toBeCloseTo(700, 4);
    expect(slid.openings![0].width).toBeCloseTo(200, 4);
    const swung = moveHandle(w, "open:o:swing", { x: 400, y: -50 }, grip) as WallEntity;
    expect(swung.openings![0].swingFlip).toBe(true);
  });

  test("an opening grip is undoable and the swing follows the wall", () => {
    const w = wall();
    add(w);
    const swung = moveHandle(w, "open:o:swing", { x: 400, y: -80 }, grip) as WallEntity;
    S().commit({ label: "Flip Swing", ops: [{ op: "replace", before: w, after: swung }] });
    expect((S().doc.entities[0] as WallEntity).openings![0].swingFlip).toBe(true);
    const flipped = solveWalls([swung]).get("w")!.frames[0].T.d;
    expect(flipped).toBeLessThan(0);
    S().undo();
    const back = S().doc.entities[0] as WallEntity;
    expect(back.openings![0].swingFlip).toBe(false);
    expect(solveWalls([back]).get("w")!.frames[0].T.d).toBeGreaterThan(0);
  });

  test("flip door swing has a shortcut", () => {
    expect(matchShortcut({ key: "s", ctrlKey: false, metaKey: false, shiftKey: true, altKey: true })?.id).toBe("wall.swing");
  });
});
