import { beforeEach, describe, expect, test } from "bun:test";
import type { DimensionEntity, Entity, WallEntity } from "../src/kernel/types";
import { dist } from "../src/kernel/vec";
import { STANDARDS, dimGeometry, flipDimension } from "../src/kernel/dimensions";
import { gripsOf, moveHandle } from "../src/kernel/handles";
import { formatLength } from "../src/kernel/units";
import { newDocument, useDocumentStore } from "../src/state/useDocumentStore";
import { translation } from "../src/kernel/transform";
import { matchShortcut } from "../src/input/keymap";
import { applyMatch } from "../src/state/match";
import { toolDef } from "../src/tools/defs";
import { solveWalls } from "../src/kernel/wallSolver";
import { setTitleBlock, titleBlockLocal } from "../src/state/titleBlock";
import { buildDisplayList, PAPER_SIZES } from "../src/io/plot";
import { plotPdf } from "../src/io/pdfPlotter";
import { exportDxf, importDxf } from "../src/io/dxfCodec";
import { parseDocument, serializeDocument } from "../src/io/nativeJson";
import { makeSymbol } from "../src/state/symbols";
import { enterSymbolEdit, exitSymbolEdit } from "../src/state/symbolEdit";

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

describe("match properties", () => {
  test("copies only the checked properties", () => {
    const src: Entity = { id: "s", layerId: "layer-2", kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, style: { penWeight: 0.7, dash: "dashed", startEnding: "arrow", endEnding: "dot", fill: "ansi31" } };
    const dst: Entity = { id: "t", layerId: "layer-1", kind: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 1 }, style: { penWeight: 0.25, dash: "solid" } };
    const pen = applyMatch(src, dst, { pen: true, dash: false, endings: false, fill: false, layer: false })!;
    expect(pen.style?.penWeight).toBe(0.7);
    expect(pen.style?.dash).toBe("solid");
    expect(pen.layerId).toBe("layer-1");
    const all = applyMatch(src, dst, { pen: true, dash: true, endings: true, fill: true, layer: true })!;
    expect(all.layerId).toBe("layer-2");
    expect(all.style).toMatchObject({ dash: "dashed", startEnding: "arrow", endEnding: "dot", fill: "ansi31" });
    expect(applyMatch(src, dst, { pen: false, dash: false, endings: false, fill: false, layer: false })).toBeNull();
  });

  test("the eyedropper is a tool with a key", () => {
    const tool = toolDef("match");
    expect(tool.key).toBe("n");
    expect(tool.methods.map((m) => m.id)).toEqual(["selection", "pick"]);
    expect(matchShortcut({ key: "n", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })?.id).toBe("tool:match");
  });
});

describe("title block", () => {
  test("fields are undoable, drawn from one layout, and land on the PDF page", () => {
    setTitleBlock({ title: "Kitchen", drawnBy: "Ada", date: "13 Nov 2026", scale: "1:48", sheetNo: "3" });
    const words = titleBlockLocal(S().doc).texts.map((t) => t.str);
    expect(words).toEqual(["Kitchen", "Ada", "13 Nov 2026", "1:48", "3"]);
    const loaded = parseDocument(serializeDocument(S().doc));
    expect(loaded.doc.titleBlock?.title).toBe("Kitchen");
    expect(loaded.doc.titleBlock?.sheetNo).toBe("3");
    const dl = buildDisplayList(S().doc, S().index.ctx!, 1);
    const pdf = plotPdf(dl, { scale: 48, paper: PAPER_SIZES.find((p) => p.id === "letter")!, landscape: true, titleBlock: titleBlockLocal(S().doc) });
    expect(pdf.pdf).toContain("Kitchen");
    expect(pdf.pdf).toContain("Ada");
    S().undo();
    expect(S().doc.titleBlock).toBeUndefined();
    expect(matchShortcut({ key: "b", ctrlKey: false, metaKey: false, shiftKey: true, altKey: true })?.id).toBe("layout.title");
  });
});

describe("symbol editing", () => {
  test("an edit updates the definition for every instance and undoes", () => {
    add({ id: "l", layerId: "layer-1", kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    S().setSelection(["l"]);
    const id = makeSymbol("Mark");
    expect(id).toBeTruthy();
    const inst = S().doc.entities.find((e) => e.kind === "symbol")!;
    add({ ...inst, id: "i2", position: { x: 100, y: 0 } });
    S().setSelection([inst.id]);
    expect(enterSymbolEdit()).toBe(true);
    expect(S().doc.entities.some((e) => e.bufferOf === id)).toBe(true);
    const buf = S().doc.entities.find((e) => e.bufferOf && e.kind === "line") as Extract<Entity, { kind: "line" }>;
    S().commit({ label: "Stretch", ops: [{ op: "replace", before: buf, after: { ...buf, b: { x: buf.b.x + 5, y: buf.b.y } } }] });
    const child = S().doc.symbols.find((s) => s.id === id)!.entities.find((e) => e.kind === "line") as Extract<Entity, { kind: "line" }>;
    expect(dist(child.a, child.b)).toBeCloseTo(15, 3);
    S().undo();
    const back = S().doc.symbols.find((s) => s.id === id)!.entities.find((e) => e.kind === "line") as Extract<Entity, { kind: "line" }>;
    expect(dist(back.a, back.b)).toBeCloseTo(10, 3);
    expect(exitSymbolEdit()).toBe(true);
    expect(S().doc.entities.some((e) => e.bufferOf)).toBe(false);
    expect(S().doc.entities.filter((e) => e.kind === "symbol")).toHaveLength(2);
    expect(matchShortcut({ key: "e", ctrlKey: false, metaKey: false, shiftKey: true, altKey: true })?.id).toBe("symbol.edit");
  });
});

describe("DXF annotations", () => {
  test("arrows, hatches and dimensions survive a round trip", () => {
    const { line, dim } = linearDim();
    const marked: Entity = { ...line, style: { startEnding: "arrow", endEnding: "dot" } };
    const hatched: Entity = { id: "r", layerId: "layer-1", kind: "rect", center: { x: 50, y: 40 }, width: 30, height: 20, rotation: 0, cornerRadius: 0, style: { fill: "ansi31" } };
    const over: DimensionEntity = { ...dim, textOverride: "WIDTH", textShift: { x: 4, y: 2 } };
    add(marked, hatched, over);
    const dxf = exportDxf(S().doc, S().index.ctx!);
    expect(dxf).toContain("\nHATCH\r\n");
    expect(dxf).toContain("ANSI31");
    expect(dxf).toContain("\nDIMENSION\r\n");
    expect(dxf).toContain("start=arrow");
    const back = importDxf(dxf);
    const lineBack = back.doc.entities.find((e) => e.kind === "line") as Extract<Entity, { kind: "line" }>;
    expect(lineBack.style?.startEnding).toBe("arrow");
    expect(lineBack.style?.endEnding).toBe("dot");
    const rect = back.doc.entities.find((e) => e.kind === "rect" || (e.kind === "polyline" && e.style?.fill) || (e.kind === "polygon" && e.style?.fill));
    expect(rect?.style?.fill).toBe("ansi31");
    const d = back.doc.entities.find((e) => e.kind === "dimension") as DimensionEntity;
    expect(d.dimType).toBe("horizontal");
    expect(d.textOverride).toBe("WIDTH");
    expect(d.textShift!.x).toBeCloseTo(4, 4);
    expect(dimGeometry(d, 1, STANDARDS.ANSI, "mm").value).toBeCloseTo(100, 3);
    expect(back.doc.entities.filter((e) => e.kind === "dimension")).toHaveLength(1);
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
