import { beforeEach, describe, expect, test } from "bun:test";
import { type Entity, dist, EntityIndex } from "../src/kernel";
import { PATTERNS, hatchRings, fillRings, entityHatch, patternById } from "../src/kernel/hatch";
import { solveWalls } from "../src/kernel/wallSolver";
import { mirrorAcross, transformEntity } from "../src/kernel/edit";
import { symbolTransform, toPrims } from "../src/kernel/prims";
import { useDocumentStore, newDocument } from "../src/state/useDocumentStore";
import { addLayer, deleteLayer, moveLayer, moveSelectionToLayer, updateLayer } from "../src/state/layers";
import { styleSelection } from "../src/state/attributes";
import { explodeChild, explodeSelection, importLibraryOps, exportLibrary, makeSymbol, placeSymbolPatch } from "../src/state/symbols";

const S = () => useDocumentStore.getState();
const L = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({ id, layerId: "layer-1", kind: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

beforeEach(() => S().load(newDocument()));

describe("hatch patterns", () => {
  test("diagonal lines stay inside the outline", () => {
    const r = hatchRings([square], patternById("ansi31")!, 1)!;
    expect(r.segs.length).toBeGreaterThan(20);
    for (const [a, b] of r.segs)
      for (const p of [a, b]) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeLessThanOrEqual(100 + 1e-9);
      }
  });

  test("even-odd: a hole stays empty", () => {
    const hole = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
    const r = hatchRings([square, hole], patternById("crosshatch")!, 1)!;
    for (const [a, b] of r.segs) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(m.x > 40.01 && m.x < 59.99 && m.y > 40.01 && m.y < 59.99).toBe(false);
    }
  });

  test("dashes and dots are produced", () => {
    expect(hatchRings([square], patternById("brick")!, 1)!.segs.length).toBeGreaterThan(30);
    expect(hatchRings([square], patternById("sand")!, 1)!.dots.length).toBeGreaterThan(30);
  });

  test("too dense falls back to a tint", () => {
    expect(hatchRings([square], patternById("ansi31")!, 1e-4)!.dense).toBe(true);
  });

  test("every pattern renders something for a square", () => {
    for (const p of PATTERNS) {
      if (p.solid) continue;
      const r = hatchRings([square], p, 1)!;
      expect([p.id, r.segs.length + r.dots.length > 0]).toEqual([p.id, true]);
    }
  });

  test("closed outlines only", () => {
    expect(fillRings({ id: "c", layerId: "L", kind: "circle", center: { x: 0, y: 0 }, r: 5 })!.length).toBe(1);
    expect(fillRings(L("l", 0, 0, 1, 1))).toBeNull();
    expect(fillRings({ id: "p", layerId: "L", kind: "polyline", points: square, closed: false })).toBeNull();
  });

  test("hatch cache refreshes when the scale changes", () => {
    const rect: Entity = { id: "r", layerId: "L", kind: "rect", center: { x: 50, y: 50 }, width: 100, height: 100, rotation: 0, cornerRadius: 0 };
    const a = entityHatch(rect, "ansi31", 1).result!.segs.length;
    const b = entityHatch(rect, "ansi31", 2).result!.segs.length;
    expect(b).toBeLessThan(a);
  });
});

describe("walls: fills, door symbols, mirroring", () => {
  const wall = (extra: Partial<Extract<Entity, { kind: "wall" }>> = {}) =>
    ({ id: "w", layerId: "layer-1", kind: "wall", a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, thickness: 150, justify: "center", ...extra }) as Extract<Entity, { kind: "wall" }>;

  test("fill outline is split at openings", () => {
    const s = solveWalls([wall({ openings: [{ id: "o", at: 2500, width: 900 }] })]).get("w")!;
    expect(s.fill.length).toBe(2);
  });

  test("placing a door on a wall makes an opening that draws the symbol", () => {
    S().load({ ...newDocument(), entities: [wall()] });
    const p = placeSymbolPatch(S().doc, "builtin:door-single", { x: 1000, y: 40 }, 1, 0, S().doc.entities[0] as Extract<Entity, { kind: "wall" }>, "layer-1")!;
    S().commit(p);
    const w = S().doc.entities[0] as Extract<Entity, { kind: "wall" }>;
    expect(w.openings!.length).toBe(1);
    expect(w.openings![0].symbolId).toBe("builtin:door-single");
    expect(w.openings![0].swingFlip).toBe(false); // clicked on the left (+y) side
    // The built-in was copied into the drawing, and the wall now draws an arc (the swing).
    expect(S().doc.symbols.some((d) => d.id === "builtin:door-single")).toBe(true);
    expect(toPrims(w, S().index.ctx).some((q) => q.t === "arc")).toBe(true);
    // The wall's indexed box includes the swing (≈ 914 mm above the wall).
    expect(S().index.around({ x: 1000, y: 800 }, 50).length).toBe(1);
  });

  test("mirroring a wall flips door swings", () => {
    const w = wall({ openings: [{ id: "o", at: 2500, width: 900, symbolId: "builtin:door-single" }] });
    const m = transformEntity(w, mirrorAcross({ x: 0, y: 0 }, 0)) as typeof w;
    expect(m.openings![0].swingFlip).toBe(true);
  });
});

describe("layers", () => {
  test("new layer becomes active; undo removes it", () => {
    const id = addLayer();
    expect(S().doc.layers.length).toBe(2);
    expect(S().doc.activeLayerId).toBe(id);
    S().undo();
    expect(S().doc.layers.length).toBe(1);
    expect(S().doc.activeLayerId).toBe("layer-1");
  });

  test("deleting a layer takes its objects; undo restores order and contents", () => {
    const second = addLayer();
    addLayer();
    S().commit({ label: "add", ops: [{ op: "add", entity: { ...L("x", 0, 0, 1, 1), layerId: second }, index: 0 }] });
    const order = S().doc.layers.map((l) => l.id);
    expect(deleteLayer(second)).toBe(true);
    expect(S().doc.entities.length).toBe(0);
    S().undo();
    expect(S().doc.layers.map((l) => l.id)).toEqual(order);
    expect(S().doc.entities.length).toBe(1);
  });

  test("the last layer cannot be deleted", () => {
    expect(deleteLayer("layer-1")).toBe(false);
  });

  test("deleting the active layer picks another active layer", () => {
    const id = addLayer();
    deleteLayer(id);
    expect(S().doc.activeLayerId).toBe("layer-1");
  });

  test("reorder, rename, scale change re-styles dimensions", () => {
    const id = addLayer();
    moveLayer(id, -1);
    expect(S().doc.layers[0].id).toBe(id);
    updateLayer(id, { name: "Plan" });
    expect(S().doc.layers[0].name).toBe("Plan");
    const dim: Entity = { id: "d", layerId: id, kind: "dimension", dimType: "horizontal", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], refs: [null, null], linePoint: { x: 500, y: 300 } };
    S().commit({ label: "dim", ops: [{ op: "add", entity: dim, index: 0 }] });
    const before = S().index.ctx!.dimPrims!(S().doc.entities[0] as Extract<Entity, { kind: "dimension" }>);
    updateLayer(id, { scale: 1 });
    const after = S().index.ctx!.dimPrims!(S().doc.entities[0] as Extract<Entity, { kind: "dimension" }>);
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });

  test("move selection to layer", () => {
    const id = addLayer();
    S().commit({ label: "add", ops: [{ op: "add", entity: L("x", 0, 0, 1, 1), index: 0 }] });
    S().setSelection(["x"]);
    moveSelectionToLayer(id);
    expect(S().doc.entities[0].layerId).toBe(id);
  });

  test("units and standard changes are undoable", () => {
    S().setUnits("mm");
    S().setStandard("ISO");
    expect(S().doc.units).toBe("mm");
    expect(S().doc.standard).toBe("ISO");
    S().undo();
    S().undo();
    expect(S().doc.units).toBe("architectural");
    expect(S().doc.standard).toBe("ANSI");
  });
});

describe("attributes", () => {
  test("restyle the selection; empty value clears", () => {
    S().commit({ label: "add", ops: [{ op: "add", entity: { id: "r", layerId: "layer-1", kind: "rect", center: { x: 0, y: 0 }, width: 10, height: 10, rotation: 0, cornerRadius: 0 }, index: 0 }] });
    S().setSelection(["r"]);
    styleSelection({ fill: "brick", penWeight: 0.5 });
    expect(S().doc.entities[0].style).toEqual({ fill: "brick", penWeight: 0.5 });
    styleSelection({ fill: "" });
    expect(S().doc.entities[0].style).toEqual({ penWeight: 0.5 });
  });
});

describe("symbols", () => {
  test("make symbol replaces the selection with one instance; explode gives fresh ids", () => {
    S().commit({ label: "add", ops: [{ op: "add", entity: L("a", 10, 10, 20, 10), index: 0 }, { op: "add", entity: L("b", 10, 10, 10, 30), index: 1 }] });
    S().setSelection(["a", "b"]);
    const id = makeSymbol("Corner")!;
    expect(S().doc.entities.length).toBe(1);
    const inst = S().doc.entities[0];
    expect(inst.kind === "symbol" && inst.position).toEqual({ x: 10, y: 10 });
    // Same geometry in the same place.
    const segs = toPrims(inst, S().index.ctx);
    expect(segs.length).toBe(2);
    S().setSelection([inst.id]);
    explodeSelection();
    expect(S().doc.entities.length).toBe(2);
    expect(S().doc.entities.map((e) => e.id).some((x) => x === "a" || x === "b")).toBe(false);
    expect(S().doc.symbols.some((d) => d.id === id)).toBe(true);
  });

  test("exploding a stretched circle gives an ellipse", () => {
    const c: Entity = { id: "c", layerId: "", kind: "circle", center: { x: 0, y: 0 }, r: 10 };
    const T = symbolTransform({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 2, 1);
    const [e] = explodeChild(c, T, 2, 1, 0, () => "n", "layer-1");
    expect(e.kind).toBe("ellipse");
    expect(e.kind === "ellipse" && [e.rx, e.ry]).toEqual([20, 10]);
    expect(e.kind === "ellipse" && e.center).toEqual({ x: 100, y: 0 });
  });

  test("library import: identical symbols are reused, clashing ids get new ones", () => {
    S().commit({ label: "add", ops: [{ op: "add", entity: L("a", 0, 0, 10, 0), index: 0 }] });
    S().setSelection(["a"]);
    makeSymbol("Bar");
    const text = exportLibrary(S().doc.symbols);
    const again = importLibraryOps(S().doc, text);
    expect(again.added).toBe(0);
    const clash = JSON.parse(text);
    clash.symbols[0].name = "Different";
    const r = importLibraryOps(S().doc, JSON.stringify(clash));
    expect(r.added).toBe(1);
    const op = r.ops[0];
    expect(op.op === "symbolDef" && op.after!.id).not.toBe(S().doc.symbols[0].id);
    expect(() => importLibraryOps(S().doc, "{}")).toThrow();
  });

  test("editing a nested symbol re-indexes instances of the outer one", () => {
    const inner = { id: "in", name: "inner", origin: { x: 0, y: 0 }, entities: [L("l", 0, 0, 10, 0)] };
    const outer = { id: "out", name: "outer", origin: { x: 0, y: 0 }, entities: [{ id: "i", layerId: "", kind: "symbol" as const, symbolId: "in", position: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 }] };
    S().commit({
      label: "setup",
      ops: [
        { op: "symbolDef", before: null, after: inner, index: 0 },
        { op: "symbolDef", before: null, after: outer, index: 1 },
        { op: "add", entity: { id: "x", layerId: "layer-1", kind: "symbol", symbolId: "out", position: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 }, index: 0 },
      ],
    });
    expect(S().index.around({ x: 500, y: 0 }, 1).length).toBe(0);
    S().commit({ label: "edit", ops: [{ op: "symbolDef", before: inner, after: { ...inner, entities: [L("l", 0, 0, 1000, 0)] }, index: 0 }] });
    expect(S().index.around({ x: 500, y: 0 }, 1).length).toBe(1);
  });
});

export { dist, EntityIndex };

describe("review fixes (M4 final review)", () => {
  const W = (id: string, ax: number, ay: number, bx: number, by: number, openings?: Extract<Entity, { kind: "wall" }>["openings"]) =>
    ({ id, layerId: "layer-1", kind: "wall", a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 150, justify: "center", openings }) as Extract<Entity, { kind: "wall" }>;

  const simple = (ring: { x: number; y: number }[]) => {
    // No two non-adjacent edges cross.
    const n = ring.length;
    const cross = (a: any, b: any, c: any) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const [p, q, r, s] = [ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]];
        if (cross(p, q, r) * cross(p, q, s) < -1e-9 && cross(r, s, p) * cross(r, s, q) < -1e-9) return false;
      }
    return true;
  };

  test("a door asked for at a corner is kept clear of the joint and fills stay simple", () => {
    S().load({ ...newDocument(), entities: [W("a", 0, 0, 5000, 0), W("b", 0, 0, 0, 5000)] });
    const wall = S().doc.entities[0] as Extract<Entity, { kind: "wall" }>;
    S().commit(placeSymbolPatch(S().doc, "builtin:door-single", { x: 10, y: 40 }, 1, 0, wall, "layer-1")!);
    const w = S().doc.entities[0] as Extract<Entity, { kind: "wall" }>;
    expect(w.openings![0].at - w.openings![0].width / 2).toBeGreaterThanOrEqual(75 - 1e-9);
    for (const ring of S().index.ctx!.wallPrims!.get("a")!.fill) expect(simple(ring)).toBe(true);
  });

  test("overlapping openings are refused; nested gaps leave no stray fill", () => {
    const wall = W("a", 0, 0, 5000, 0, [{ id: "d", at: 2500, width: 1800 }]);
    S().load({ ...newDocument(), entities: [wall] });
    expect(placeSymbolPatch(S().doc, "builtin:window", { x: 2500, y: 10 }, 1, 0, S().doc.entities[0] as typeof wall, "layer-1")).toBeNull();
    const fill = solveWalls([W("a", 0, 0, 5000, 0, [{ id: "d", at: 2500, width: 1800 }, { id: "w", at: 2500, width: 900 }])]).get("a")!.fill;
    expect(fill.length).toBe(2);
  });

  test("hinge goes to the nearer wall end", () => {
    S().load({ ...newDocument(), entities: [W("a", 0, 0, 5000, 0)] });
    const p = placeSymbolPatch(S().doc, "builtin:door-single", { x: 4000, y: 40 }, 1, 0, S().doc.entities[0] as Extract<Entity, { kind: "wall" }>, "layer-1")!;
    const after = p.ops.find((o) => o.op === "replace")!;
    expect(after.op === "replace" && (after.after as Extract<Entity, { kind: "wall" }>).openings![0].hingeFlip).toBe(true);
  });

  test("library import reuses identical content under another id", () => {
    S().commit({ label: "add", ops: [{ op: "add", entity: L("a", 0, 0, 10, 0), index: 0 }] });
    S().setSelection(["a"]);
    makeSymbol("Bar");
    const file = JSON.parse(exportLibrary(S().doc.symbols));
    file.symbols[0].id = "someone-elses-id";
    expect(importLibraryOps(S().doc, JSON.stringify(file)).added).toBe(0);
  });

  test("stretched explode flattens nested symbols instead of dropping them", () => {
    const inner = { id: "in", name: "in", origin: { x: 0, y: 0 }, entities: [L("l", 0, 0, 10, 0)] };
    S().commit({ label: "def", ops: [{ op: "symbolDef", before: null, after: inner, index: 0 }] });
    const child: Entity = { id: "c", layerId: "", kind: "symbol", symbolId: "in", position: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1 };
    const out = explodeChild(child, symbolTransform({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 2, 1), 2, 1, 0, () => Math.random().toString(36), "layer-1");
    expect(out.length).toBe(1);
    expect(out[0].kind === "line" && out[0].b).toEqual({ x: 20, y: 0 });
  });
});
