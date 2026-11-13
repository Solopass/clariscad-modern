import { describe, expect, test } from "bun:test";
import {
  type CadDocument,
  type Entity,
  type Id,
  type Prim,
  EntityIndex,
  chamfer,
  dist,
  extendTo,
  fillet,
  offsetEntity,
  splitAt,
  trimAt,
  trimPiece,
  toPath,
  paramOf,
  subPath,
  segsToEntity,
} from "../src/kernel";
import { mirrorAcross, rotateAbout, transformEntity } from "../src/kernel/edit";
import { solveWalls } from "../src/kernel/wallSolver";
import { handleAt, handlesOf, moveHandle, resolveHandle } from "../src/kernel/handles";
import { STANDARDS, dimGeometry } from "../src/kernel/dimensions";
import { applyOps, editPatch, invert, replacePatch, syncContext, addPatch, type Patch } from "../src/state/ops";
import { withDependents } from "../src/state/dependents";
import { newDocument } from "../src/state/useDocumentStore";
import { methodDef } from "../src/tools/defs";
import { DrawTool, SelectTool, type PointerInfo, type ToolContext } from "../src/tools/runtime";

type Line = Extract<Entity, { kind: "line" }>;
type Arc = Extract<Entity, { kind: "arc" }>;
const L = (id: string, ax: number, ay: number, bx: number, by: number): Line => ({ id, layerId: "layer-1", kind: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });
let ids = 0;
const nid = () => `n${ids++}`;
const close = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 1e-9) => expect(dist(a, b)).toBeLessThanOrEqual(tol);

describe("path model", () => {
  test("rect becomes a closed path; sub-path back to a polyline", () => {
    const p = toPath({ id: "r", layerId: "L", kind: "rect", center: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0, cornerRadius: 0 })!;
    expect(p.closed).toBe(true);
    expect(p.segs.length).toBe(4);
    const e = segsToEntity(subPath(p, 0.5, 2.5), "x", { layerId: "L" })!;
    expect(e.kind).toBe("polyline");
    expect((e as Extract<Entity, { kind: "polyline" }>).points.length).toBe(4);
  });

  test("clockwise bulge arcs keep their walk direction", () => {
    const p = toPath({ id: "p", layerId: "L", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], closed: false, bulges: [-1, 0] })!;
    expect(p.segs[0].reversed).toBe(true);
    // Walking from (0,0) to (2,0) clockwise passes over the top.
    const half = subPath(p, 0, 0.5);
    const e = segsToEntity(half, "h", { layerId: "L" })! as Arc;
    expect(e.kind).toBe("arc");
    const ends = [{ x: e.center.x + e.r * Math.cos(e.start), y: e.center.y + e.r * Math.sin(e.start) }, { x: e.center.x + e.r * Math.cos(e.end), y: e.center.y + e.r * Math.sin(e.end) }];
    expect(ends.some((q) => dist(q, { x: 0, y: 0 }) < 1e-9)).toBe(true);
    expect(ends.some((q) => dist(q, { x: 1, y: 1 }) < 1e-9)).toBe(true);
  });

  test("paramOf finds the right segment", () => {
    const p = toPath({ id: "p", layerId: "L", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false })!;
    expect(paramOf(p, { x: 10.1, y: 5 }).s).toBeCloseTo(1.5, 9);
  });
});

describe("trim / split / extend", () => {
  const cutters = [L("v1", 3, -5, 3, 5), L("v2", 7, -5, 7, 5)];

  test("trimming the middle of a line leaves two pieces; the first keeps the id", () => {
    const r = trimAt(L("h", 0, 0, 10, 0), { x: 5, y: 0 }, cutters, nid)!;
    expect(r.replace.length).toBe(1);
    expect(r.add.length).toBe(1);
    expect(r.replace[0].id).toBe("h");
    const pieces = [...r.replace, ...r.add] as Line[];
    close(pieces[0].b, { x: 3, y: 0 });
    close(pieces[1].a, { x: 7, y: 0 });
  });

  test("trimming an end piece leaves one line", () => {
    const r = trimAt(L("h", 0, 0, 10, 0), { x: 9, y: 0 }, cutters, nid)!;
    expect(r.add.length).toBe(0);
    close((r.replace[0] as Line).b, { x: 7, y: 0 });
  });

  test("nothing to trim without crossings", () => {
    expect(trimAt(L("h", 0, 0, 10, 0), { x: 5, y: 0 }, [], nid)).toBeNull();
  });

  test("trimming a circle between two lines leaves an arc", () => {
    const c: Entity = { id: "c", layerId: "L", kind: "circle", center: { x: 0, y: 0 }, r: 5 };
    const r = trimAt(c, { x: 5, y: 0 }, [L("v", 3, -10, 3, 10)], nid)!;
    const a = r.replace[0] as Arc;
    expect(a.kind).toBe("arc");
    // Remaining arc runs round the left side: it contains (-5, 0) and not (5, 0).
    const sweep = (((a.end - a.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const inArc = (ang: number) => (((ang - a.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) <= sweep;
    expect(inArc(Math.PI)).toBe(true);
    expect(inArc(0)).toBe(false);
  });

  test("trimming a rectangle side opens it into a polyline", () => {
    const rect: Entity = { id: "r", layerId: "L", kind: "rect", center: { x: 0, y: 0 }, width: 10, height: 4, rotation: 0, cornerRadius: 0 };
    const r = trimAt(rect, { x: 0, y: -2 }, [L("a", -2, -5, -2, 5), L("b", 2, -5, 2, 5)], nid)!;
    const pl = r.replace[0] as Extract<Entity, { kind: "polyline" }>;
    expect(pl.kind).toBe("polyline");
    expect(pl.closed).toBe(false);
    close(pl.points[0], { x: 2, y: -2 });
    close(pl.points[pl.points.length - 1], { x: -2, y: -2 });
  });

  test("trimPiece previews exactly the removed part", () => {
    const piece = trimPiece(L("h", 0, 0, 10, 0), { x: 5, y: 0 }, cutters) as Line;
    close(piece.a, { x: 3, y: 0 });
    close(piece.b, { x: 7, y: 0 });
  });

  test("split a line; split a circle opens it", () => {
    const r = splitAt(L("h", 0, 0, 10, 0), { x: 4, y: 0 }, nid)!;
    expect((r.replace[0] as Line).b).toEqual({ x: 4, y: 0 });
    expect((r.add[0] as Line).a).toEqual({ x: 4, y: 0 });
    const c = splitAt({ id: "c", layerId: "L", kind: "circle", center: { x: 0, y: 0 }, r: 1 }, { x: 0, y: 1 }, nid)!;
    expect(c.replace[0].kind).toBe("arc");
  });

  test("extend a line to a boundary, from the nearer end", () => {
    const r = extendTo(L("h", 0, 0, 5, 0), { x: 4.5, y: 0 }, [L("wall", 9, -5, 9, 5), L("far", 20, -5, 20, 5)])!;
    close((r.replace[0] as Line).b, { x: 9, y: 0 });
    const s = extendTo(L("h", 0, 0, 5, 0), { x: 0.5, y: 0 }, [L("left", -4, -5, -4, 5)])!;
    close((s.replace[0] as Line).a, { x: -4, y: 0 });
  });

  test("extend ignores hits on a boundary's extension", () => {
    expect(extendTo(L("h", 0, 0, 5, 0), { x: 4.5, y: 0 }, [L("short", 9, 1, 9, 5)])).toBeNull();
  });

  test("extend an arc around to a line", () => {
    const a: Arc = { id: "a", layerId: "L", kind: "arc", center: { x: 0, y: 0 }, r: 5, start: 0, end: Math.PI / 4 };
    const r = extendTo(a, { x: 3.5, y: 3.5 }, [L("v", -10, 0.0001, 10, 0.0001), L("y", 0, -10, 0, 10)])!;
    expect((r.replace[0] as Arc).end).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("offset", () => {
  test("line offset to the picked side", () => {
    const r = offsetEntity(L("h", 0, 0, 10, 0), 2, { x: 5, y: -3 }, nid)!;
    const l = r.add[0] as Line;
    expect(l.a.y).toBeCloseTo(-2, 12);
    expect(l.id).not.toBe("h");
  });

  test("circle offset inward and outward", () => {
    const c: Entity = { id: "c", layerId: "L", kind: "circle", center: { x: 0, y: 0 }, r: 5 };
    expect((offsetEntity(c, 1, { x: 1, y: 0 }, nid)!.add[0] as Extract<Entity, { kind: "circle" }>).r).toBe(4);
    expect((offsetEntity(c, 1, { x: 9, y: 0 }, nid)!.add[0] as Extract<Entity, { kind: "circle" }>).r).toBe(6);
  });

  test("closed polygon offset outward keeps mitred corners", () => {
    const sq: Entity = { id: "s", layerId: "L", kind: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };
    const r = offsetEntity(sq, 1, { x: 10, y: 2 }, nid)!;
    const p = r.add[0] as Extract<Entity, { kind: "polygon" }>;
    expect(p.kind).toBe("polygon");
    const xs = p.points.map((q) => q.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-1, 9);
    expect(xs[3]).toBeCloseTo(5, 9);
  });

  test("polyline with an arc offsets concentrically", () => {
    const pl: Entity = { id: "p", layerId: "L", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false, bulges: [0, Math.tan(Math.PI / 8), 0] };
    const r = offsetEntity(pl, 1, { x: 5, y: -5 }, nid);
    expect(r).not.toBeNull();
  });
});

describe("fillet / chamfer", () => {
  const h = L("h", 0, 0, 10, 0);
  const v = L("v", 0, 0, 0, 10);

  test("fillet two lines meeting at a corner", () => {
    const r = fillet(h, { x: 8, y: 0 }, v, { x: 0, y: 8 }, 2, "both", nid)!;
    const nh = r.replace.find((e) => e.id === "h") as Line;
    const nv = r.replace.find((e) => e.id === "v") as Line;
    close(nh.a, { x: 2, y: 0 });
    close(nv.a, { x: 0, y: 2 });
    const arc = r.add[0] as Arc;
    close(arc.center, { x: 2, y: 2 });
    expect(arc.r).toBe(2);
    // Minor arc from (2,0) to (0,2): angles 270° → 180° the short way.
    expect((((arc.end - arc.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo(Math.PI / 2, 9);
  });

  test("fillet extends lines that stop short of the corner", () => {
    const r = fillet(L("h", 3, 0, 10, 0), { x: 8, y: 0 }, L("v", 0, 3, 0, 10), { x: 0, y: 8 }, 1, "both", nid)!;
    close((r.replace[0] as Line).a, { x: 1, y: 0 });
  });

  test("radius 0 makes a sharp corner", () => {
    const r = fillet(L("h", 0, 0, 10, 0), { x: 8, y: 0 }, L("v", 3, -5, 3, 10), { x: 3, y: 8 }, 0, "both", nid)!;
    expect(r.add.length).toBe(0);
    close((r.replace[0] as Line).a, { x: 3, y: 0 });
    close((r.replace[1] as Line).a, { x: 3, y: 0 });
  });

  test("radius too big for the lines is refused", () => {
    expect(fillet(L("h", 0, 0, 1, 0), { x: 0.5, y: 0 }, L("v", 0, 0, 0, 1), { x: 0, y: 0.5 }, 5, "both", nid)).toBeNull();
  });

  test("fillet a line and an arc with the tangent arc", () => {
    // Arc bottom is at y = 1, so a radius-1 fillet fits between it and the line y = 0.
    const arc: Arc = { id: "a", layerId: "L", kind: "arc", center: { x: 0, y: 4 }, r: 3, start: Math.PI, end: 2 * Math.PI };
    const r = fillet(L("h", -10, 0, 10, 0), { x: 4, y: 0 }, arc, { x: 2.9, y: 3.2 }, 1, "both", nid)!;
    const f = r.add[0] as Arc;
    expect(Math.abs(f.center.y - 1)).toBeLessThan(1e-9);
    expect(Math.abs(dist(f.center, { x: 0, y: 4 }) - 4)).toBeLessThan(1e-9);
    expect(f.center.x).toBeGreaterThan(0);
  });

  test("chamfer by distances and by angle", () => {
    const r = chamfer(h, { x: 8, y: 0 }, v, { x: 0, y: 8 }, { d1: 2, d2: 3 }, "both", nid)!;
    const c = r.add[0] as Line;
    close(c.a, { x: 2, y: 0 });
    close(c.b, { x: 0, y: 3 });
    const a = chamfer(h, { x: 8, y: 0 }, v, { x: 0, y: 8 }, { d1: 2, angle: Math.PI / 4 }, "both", nid)!;
    close((a.add[0] as Line).b, { x: 0, y: 2 });
  });

  test("trim mode 'first' only cuts the first line", () => {
    const r = fillet(h, { x: 8, y: 0 }, v, { x: 0, y: 8 }, 2, "first", nid)!;
    expect(r.replace.map((e) => e.id)).toEqual(["h"]);
  });
});

describe("transforms", () => {
  test("rotate an arc 90°", () => {
    const a: Arc = { id: "a", layerId: "L", kind: "arc", center: { x: 1, y: 0 }, r: 1, start: 0, end: Math.PI / 2 };
    const r = transformEntity(a, rotateAbout({ x: 0, y: 0 }, Math.PI / 2)) as Arc;
    close(r.center, { x: 0, y: 1 });
    expect(r.start).toBeCloseTo(Math.PI / 2, 12);
    expect(r.end).toBeCloseTo(Math.PI, 12);
  });

  test("mirror an arc keeps it CCW over the mirrored span", () => {
    const a: Arc = { id: "a", layerId: "L", kind: "arc", center: { x: 0, y: 0 }, r: 1, start: 0, end: Math.PI / 2 };
    const m = transformEntity(a, mirrorAcross({ x: 0, y: 0 }, Math.PI / 2)) as Arc; // flip horizontally
    expect(m.start).toBeCloseTo(Math.PI / 2, 12);
    expect(m.end).toBeCloseTo(Math.PI, 12);
  });

  test("mirror swaps double-line justification and bulge signs", () => {
    const d = transformEntity({ id: "d", layerId: "L", kind: "doubleLine", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: 1, justify: "left", capStart: true, capEnd: true }, mirrorAcross({ x: 0, y: 0 }, 0));
    expect(d.kind === "doubleLine" && d.justify).toBe("right");
    const p = transformEntity({ id: "p", layerId: "L", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: false, bulges: [0.5, 0] }, mirrorAcross({ x: 0, y: 0 }, 0));
    expect(p.kind === "polyline" && p.bulges![0]).toBe(-0.5);
  });
});

describe("wall solver", () => {
  const W = (id: string, ax: number, ay: number, bx: number, by: number, t = 2) =>
    ({ id, layerId: "L", kind: "wall", a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t, justify: "center" }) as Extract<Entity, { kind: "wall" }>;
  const segs = (prims: Prim[]) => prims.filter((p): p is Extract<Prim, { t: "seg" }> => p.t === "seg");
  const hasSeg = (prims: Prim[], a: { x: number; y: number }, b: { x: number; y: number }) =>
    segs(prims).some((s) => (dist(s.a, a) < 1e-9 && dist(s.b, b) < 1e-9) || (dist(s.a, b) < 1e-9 && dist(s.b, a) < 1e-9));

  test("lone wall: two faces and two caps", () => {
    const p = solveWalls([W("a", 0, 0, 10, 0)]).get("a")!.prims;
    expect(p.length).toBe(4);
  });

  test("L corner mitres and drops caps at the joint", () => {
    const out = solveWalls([W("a", 0, 0, 10, 0), W("b", 0, 0, 0, 10)]);
    const a = out.get("a")!.prims;
    // Outer face runs to the outer corner (-1,-1); inner face starts at the inner corner (1,1).
    expect(hasSeg(a, { x: -1, y: -1 }, { x: 10, y: -1 })).toBe(true);
    expect(hasSeg(a, { x: 1, y: 1 }, { x: 10, y: 1 })).toBe(true);
    expect(a.length).toBe(3); // two faces + far cap
  });

  test("T join: the stem stops at the near face, which gets a gap", () => {
    const out = solveWalls([W("base", 0, 0, 20, 0), W("stem", 10, 0, 10, 10)]);
    const stem = out.get("stem")!.prims;
    expect(hasSeg(stem, { x: 9, y: 1 }, { x: 9, y: 10 })).toBe(true);
    const base = out.get("base")!.prims;
    expect(hasSeg(base, { x: 0, y: 1 }, { x: 9, y: 1 })).toBe(true);
    expect(hasSeg(base, { x: 11, y: 1 }, { x: 20, y: 1 })).toBe(true);
    expect(hasSeg(base, { x: 0, y: -1 }, { x: 20, y: -1 })).toBe(true); // far face untouched
  });

  test("X crossing: both walls broken inside each other", () => {
    const out = solveWalls([W("h", -10, 0, 10, 0), W("v", 0, -10, 0, 10)]);
    const h = out.get("h")!.prims;
    expect(hasSeg(h, { x: -10, y: 1 }, { x: -1, y: 1 })).toBe(true);
    expect(hasSeg(h, { x: 1, y: 1 }, { x: 10, y: 1 })).toBe(true);
  });

  test("opening: faces broken with jambs", () => {
    const w = { ...W("a", 0, 0, 10, 0), openings: [{ id: "o", at: 5, width: 2 }] };
    const p = solveWalls([w]).get("a")!.prims;
    expect(hasSeg(p, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(true);
    expect(hasSeg(p, { x: 6, y: 1 }, { x: 10, y: 1 })).toBe(true);
    expect(hasSeg(p, { x: 4, y: -1 }, { x: 4, y: 1 })).toBe(true);
  });
});

describe("handles and grips", () => {
  test("handle names resolve and match by position", () => {
    const l = L("l", 0, 0, 4, 0);
    expect(resolveHandle(l, "mid")).toEqual({ x: 2, y: 0 });
    expect(handleAt(l, { x: 4, y: 0 })).toBe("b");
    expect(handlesOf({ id: "c", layerId: "L", kind: "circle", center: { x: 0, y: 0 }, r: 1 }).length).toBe(5);
  });

  test("dragging a rectangle corner keeps the opposite corner", () => {
    const r: Entity = { id: "r", layerId: "L", kind: "rect", center: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0, cornerRadius: 0 };
    const m = moveHandle(r, "corner:2", { x: 4, y: 3 }) as Extract<Entity, { kind: "rect" }>;
    expect(m.width).toBe(6);
    expect(m.height).toBe(4);
    close(m.center, { x: 1, y: 1 });
  });

  test("dragging an arc end changes its angle, not its radius", () => {
    const a: Arc = { id: "a", layerId: "L", kind: "arc", center: { x: 0, y: 0 }, r: 2, start: 0, end: Math.PI / 2 };
    const m = moveHandle(a, "end", { x: -5, y: 0 }) as Arc;
    expect(m.end).toBeCloseTo(Math.PI, 12);
    expect(m.r).toBe(2);
  });
});

describe("dimensions", () => {
  const dim = (extra: Partial<Extract<Entity, { kind: "dimension" }>> = {}): Extract<Entity, { kind: "dimension" }> => ({
    id: "d",
    layerId: "layer-1",
    kind: "dimension",
    dimType: "horizontal",
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
    refs: [null, null],
    linePoint: { x: 500, y: 300 },
    ...extra,
  });

  test("horizontal measures x distance and formats in units", () => {
    const g = dimGeometry(dim(), 1, STANDARDS.ANSI, "mm");
    expect(g.value).toBe(1000);
    expect(g.text!.str).toBe("1000.00 mm");
    expect(g.lines.length).toBeGreaterThanOrEqual(3);
    expect(g.arrows.length).toBe(2);
  });

  test("aligned and vertical", () => {
    expect(dimGeometry(dim({ dimType: "aligned", points: [{ x: 0, y: 0 }, { x: 300, y: 400 }] }), 1, STANDARDS.ISO, "mm").value).toBeCloseTo(500, 9);
    expect(dimGeometry(dim({ dimType: "vertical", points: [{ x: 0, y: 0 }, { x: 300, y: 400 }] }), 1, STANDARDS.ISO, "mm").value).toBeCloseTo(400, 9);
  });

  test("angular picks the sector containing the placement point", () => {
    const g = dimGeometry(
      dim({ dimType: "angular", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }], linePoint: { x: 3, y: 3 } }),
      1,
      STANDARDS.ANSI,
      "mm",
    );
    expect(g.value).toBeCloseTo(Math.PI / 2, 12);
    expect(g.text!.str).toBe("90°");
  });

  test("radius and text override", () => {
    const g = dimGeometry(dim({ dimType: "radius", points: [{ x: 0, y: 0 }, { x: 25.4, y: 0 }], linePoint: { x: 100, y: 100 }, textOverride: "<> TYP" }), 1, STANDARDS.ANSI, "inches");
    expect(g.text!.str).toBe('R1.0000" TYP');
  });

  test("text stays upright", () => {
    const g = dimGeometry(dim({ dimType: "aligned", points: [{ x: 10, y: 0 }, { x: 0, y: 0 }], linePoint: { x: 5, y: 5 } }), 1, STANDARDS.ISO, "mm");
    expect(Math.abs(g.text!.angle)).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------- store-level behaviour

function session(entities: Entity[]) {
  let doc: CadDocument = { ...newDocument(), entities: [] };
  const index = new EntityIndex([], {});
  syncContext(doc, index, { symbols: "all", walls: true, dims: true });
  doc = applyOps(doc, index, addPatch(doc, "seed", entities).ops);
  const undo: Patch[] = [];
  let selection: ReadonlySet<Id> = new Set();
  const commit = (p: Patch) => {
    const full = withDependents(doc, p);
    doc = applyOps(doc, index, full.ops);
    undo.push(full);
  };
  const ctx: ToolContext = {
    doc: () => doc,
    index: () => index,
    commit,
    selection: () => selection,
    setSelection: (x) => (selection = new Set(x)),
    settings: () =>
      ({
        gridSpacing: 10,
        angleStep: 15,
        wallThickness: 2,
        wallJustify: "center",
        openingWidth: 2,
        offsetDistance: 0,
        filletRadius: 1,
        trimMode: "both",
        chamferD1: 1,
        chamferD2: 1,
        chamferAngle: 45,
        chamferByAngle: false,
        penWeight: 0.25,
        dash: "solid",
      }) as ToolContext["settings"] extends () => infer S ? S : never,
    tolerance: () => 0.5,
    newId: nid,
  };
  return {
    ctx,
    index,
    get doc() {
      return doc;
    },
    commit,
    undoLast() {
      doc = applyOps(doc, index, invert(undo.pop()!).ops);
    },
  };
}

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ p: { x, y }, raw: { x, y }, screen: { x: x * 10, y: -y * 10 }, shift: false, alt: false, ctrl: false, ...extra });
const click = (t: { down(e: PointerInfo): void; up(e: PointerInfo): void }, x: number, y: number, extra?: Partial<PointerInfo>) => {
  t.down(at(x, y, extra));
  t.up(at(x, y, extra));
};

describe("associative dimensions in the store", () => {
  const dimOn = (lineId: string): Entity => ({
    id: "dim",
    layerId: "layer-1",
    kind: "dimension",
    dimType: "horizontal",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    refs: [
      { entityId: lineId, handle: "a" },
      { entityId: lineId, handle: "b" },
    ],
    linePoint: { x: 5, y: 3 },
  });

  test("moving the line moves the dimension in the same undo step", () => {
    const s = session([L("l", 0, 0, 10, 0), dimOn("l")]);
    const l = s.doc.entities[0];
    s.commit(replacePatch("Reshape", [[l, { ...(l as Line), b: { x: 20, y: 5 } }]], { grip: { handle: "b", to: { x: 20, y: 5 } } }));
    const d = s.doc.entities[1] as Extract<Entity, { kind: "dimension" }>;
    expect(d.points[1]).toEqual({ x: 20, y: 5 });
    expect(dimGeometry(d, 1, STANDARDS.ANSI, "mm").value).toBe(20);
    s.undoLast();
    expect((s.doc.entities[1] as Extract<Entity, { kind: "dimension" }>).points[1]).toEqual({ x: 10, y: 0 });
  });

  test("trimming the measured end re-attaches by position or detaches", () => {
    const s = session([L("l", 0, 0, 10, 0), L("cut", 6, -5, 6, 5), dimOn("l")]);
    const r = trimAt(s.doc.entities[0], { x: 9, y: 0 }, [s.doc.entities[1]], nid)!;
    s.commit(editPatch(s.doc, "Trim", r));
    const d = s.doc.entities.find((e) => e.id === "dim") as Extract<Entity, { kind: "dimension" }>;
    // 'a' is still there; 'b' was cut away, so the ref is dropped and the old point kept.
    expect(d.refs[0]).toEqual({ entityId: "l", handle: "a" });
    expect(d.refs[1]).toBeNull();
    expect(d.points[1]).toEqual({ x: 10, y: 0 });
  });

  test("dimension tool attaches refs from snapped picks", () => {
    const s = session([L("l", 0, 0, 10, 0)]);
    const t = new DrawTool(methodDef("dimension", "horizontal"), s.ctx);
    click(t, 0, 0, { ids: ["l"] });
    click(t, 10, 0, { ids: ["l"] });
    click(t, 5, 4);
    const d = s.doc.entities[1] as Extract<Entity, { kind: "dimension" }>;
    expect(d.refs).toEqual([
      { entityId: "l", handle: "a" },
      { entityId: "l", handle: "b" },
    ]);
  });
});

describe("edit tools end to end", () => {
  test("trim tool needs a hit, then trims", () => {
    const s = session([L("h", 0, 0, 10, 0), L("v1", 3, -5, 3, 5), L("v2", 7, -5, 7, 5)]);
    const t = new DrawTool(methodDef("trim", "trim"), s.ctx);
    click(t, 50, 50); // empty space: ignored
    expect(t.busy()).toBe(false);
    click(t, 5, 0.1);
    expect(s.doc.entities.length).toBe(4);
    expect(s.doc.entities.filter((e) => e.kind === "line" && (e as Line).a.y === 0 && (e as Line).b.y === 0).length).toBe(2);
  });

  test("fillet tool on two lines adds an arc", () => {
    const s = session([L("h", 0, 0, 10, 0), L("v", 0, 0, 0, 10)]);
    const t = new DrawTool(methodDef("fillet", "fillet"), s.ctx);
    click(t, 8, 0.1);
    click(t, 0.1, 8);
    expect(s.doc.entities.some((e) => e.kind === "arc")).toBe(true);
  });

  test("continuous walls share corners and solve as L joints", () => {
    const s = session([]);
    const t = new DrawTool(methodDef("wall", "continuous"), s.ctx);
    click(t, 0, 0);
    click(t, 10, 0);
    click(t, 10, 10);
    t.key("Enter");
    expect(s.doc.entities.filter((e) => e.kind === "wall").length).toBe(2);
    const solved = s.index.ctx!.wallPrims!;
    expect(solved.get(s.doc.entities[0].id)!.prims.length).toBe(3);
  });

  test("opening tool adds an opening to the wall under the cursor", () => {
    const s = session([{ id: "w", layerId: "layer-1", kind: "wall", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 2, justify: "center" }]);
    const t = new DrawTool(methodDef("wall", "opening"), s.ctx);
    click(t, 5, 0.3);
    const w = s.doc.entities[0] as Extract<Entity, { kind: "wall" }>;
    expect(w.openings?.length).toBe(1);
    expect(w.openings![0].at).toBeCloseTo(5, 12);
  });

  test("select tool: drag a line end handle (grip)", () => {
    const s = session([L("l", 0, 0, 10, 0)]);
    const t = new SelectTool(s.ctx);
    click(t, 5, 0.1);
    t.down(at(10, 0));
    t.move(at(12, 3));
    t.up(at(12, 3));
    expect((s.doc.entities[0] as Line).b).toEqual({ x: 12, y: 3 });
  });

  test("lasso selects what is enclosed", () => {
    const s = session([L("in", 1, 1, 2, 2), L("out", 1, 1, 20, 20)]);
    const t = new SelectTool(s.ctx, "lasso");
    t.down(at(0, 0));
    for (const [x, y] of [
      [5, 0],
      [5, 5],
      [0, 5],
    ])
      t.move(at(x, y));
    t.up(at(0, 0.5));
    expect([...s.ctx.selection()]).toEqual(["in"]);
  });
});

describe("review fixes (M3 final review)", () => {
  const dimOnHandles = (refs: [string, string][], pts: { x: number; y: number }[], lp = { x: 0, y: 5 }): Entity => ({
    id: "dim",
    layerId: "layer-1",
    kind: "dimension",
    dimType: "aligned",
    points: pts,
    refs: refs.map(([entityId, handle]) => ({ entityId, handle })),
    linePoint: lp,
  });

  test("flipping an arc keeps a dimension on the same physical end", () => {
    const arc: Arc = { id: "a", layerId: "layer-1", kind: "arc", center: { x: 0, y: 0 }, r: 2, start: 0, end: Math.PI / 2 };
    const s = session([arc, L("ref", 10, 0, 10, 5), dimOnHandles([["a", "start"], ["ref", "a"]], [{ x: 2, y: 0 }, { x: 10, y: 0 }], { x: 6, y: -3 })]);
    const T = mirrorAcross({ x: 0, y: 0 }, Math.PI / 2); // flip horizontally about the origin
    s.commit(replacePatch("Flip", [[s.doc.entities[0], transformEntity(s.doc.entities[0], T)]], { transform: T }));
    const d = s.doc.entities.find((e) => e.id === "dim") as Extract<Entity, { kind: "dimension" }>;
    // The arc's old start (2,0) is now at (-2,0) – which is the flipped arc's *end*.
    close(d.points[0], { x: -2, y: 0 });
    expect(d.refs[0]).toEqual({ entityId: "a", handle: "end" });
  });

  test("rotating a circle re-attaches quadrant refs by position", () => {
    const c: Entity = { id: "c", layerId: "layer-1", kind: "circle", center: { x: 0, y: 0 }, r: 1 };
    const s = session([c, L("ref", 10, 0, 10, 5), dimOnHandles([["c", "quad:1"], ["ref", "a"]], [{ x: 0, y: 1 }, { x: 10, y: 0 }])]);
    const T = rotateAbout({ x: 0, y: 0 }, Math.PI / 2);
    s.commit(replacePatch("Rotate", [[s.doc.entities[0], transformEntity(s.doc.entities[0], T)]], { transform: T }));
    const d = s.doc.entities.find((e) => e.id === "dim") as Extract<Entity, { kind: "dimension" }>;
    close(d.points[0], { x: -1, y: 0 });
    expect(d.refs[0]).toEqual({ entityId: "c", handle: "quad:2" });
  });

  test("rect corner dragged past its opposite keeps the dimension on the dragged corner", () => {
    const r: Entity = { id: "r", layerId: "layer-1", kind: "rect", center: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0, cornerRadius: 0 };
    const s = session([r, L("ref", 10, 0, 10, 5), dimOnHandles([["r", "corner:2"], ["ref", "a"]], [{ x: 2, y: 1 }, { x: 10, y: 0 }])]);
    const to = { x: -5, y: -4 };
    s.commit(replacePatch("Reshape", [[s.doc.entities[0], moveHandle(s.doc.entities[0], "corner:2", to)]], { grip: { handle: "corner:2", to } }));
    const d = s.doc.entities.find((e) => e.id === "dim") as Extract<Entity, { kind: "dimension" }>;
    close(d.points[0], to);
  });

  test("a dimension moved on its own lets go of the geometry", () => {
    const s = session([L("l", 0, 0, 10, 0), dimOnHandles([["l", "a"], ["l", "b"]], [{ x: 0, y: 0 }, { x: 10, y: 0 }])]);
    const dm = s.doc.entities[1];
    s.commit(replacePatch("Move", [[dm, { ...(dm as Extract<Entity, { kind: "dimension" }>), points: [{ x: 0, y: 50 }, { x: 10, y: 50 }], linePoint: { x: 0, y: 55 } }]]));
    const d = s.doc.entities[1] as Extract<Entity, { kind: "dimension" }>;
    expect(d.refs).toEqual([null, null]);
  });

  test("moving one end keeps the dimension line where it was relative to the geometry", () => {
    const s = session([L("l", 0, 0, 10, 0), { ...dimOnHandles([["l", "a"], ["l", "b"]], [{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 5, y: 3 }), dimType: "horizontal" } as Entity]);
    const l = s.doc.entities[0] as Line;
    s.commit(replacePatch("Reshape", [[l, { ...l, b: { x: 20, y: 0 } }]], { grip: { handle: "b", to: { x: 20, y: 0 } } }));
    const d = s.doc.entities[1] as Extract<Entity, { kind: "dimension" }>;
    expect(d.linePoint.y).toBeCloseTo(3, 12);
  });

  test("offset of a polyline arc goes to the side that was clicked", () => {
    // CCW bulge arc from (-1,0) to (1,0) through (0,-1): clicking further out (0,-1.5) offsets outward.
    const pl: Entity = { id: "p", layerId: "L", kind: "polyline", points: [{ x: -1, y: 0 }, { x: 1, y: 0 }], closed: false, bulges: [1, 0] };
    const r = offsetEntity(pl, 0.25, { x: 0, y: -1.5 }, nid)!;
    const out = r.add[0];
    expect(out.kind).toBe("arc");
    expect((out as Arc).r).toBeCloseTo(1.25, 12);
  });

  test("very sharp wall corners are capped, not mitred to infinity", () => {
    const W = (id: string, b: { x: number; y: number }) => ({ id, layerId: "L", kind: "wall", a: { x: 0, y: 0 }, b, thickness: 1, justify: "center" }) as Extract<Entity, { kind: "wall" }>;
    const ang = (10 * Math.PI) / 180;
    const out = solveWalls([W("a", { x: 20, y: 0 }), W("b", { x: 20 * Math.cos(ang), y: 20 * Math.sin(ang) })]);
    for (const { prims } of out.values())
      for (const p of prims) if (p.t === "seg") for (const q of [p.a, p.b]) expect(dist(q, { x: 0, y: 0 })).toBeLessThan(25);
  });

  test("dragging a wall end keeps openings where they are", () => {
    const w = { id: "w", layerId: "L", kind: "wall", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 1, justify: "center", openings: [{ id: "o", at: 6, width: 2 }] } as Extract<Entity, { kind: "wall" }>;
    const m = moveHandle(w, "a", { x: 2, y: 0 }) as typeof w;
    expect(m.openings![0].at).toBeCloseTo(4, 12); // still centred at x = 6
    const short = moveHandle(w, "b", { x: 5, y: 0 }) as typeof w;
    expect(short.openings).toEqual([]); // no longer fits
  });
});
