import { describe, expect, test } from "bun:test";
import { type CadDocument, type Entity, type Id, EntityIndex, dist } from "../src/kernel";
import { type Patch, addPatch, applyOps, invert, removePatch, replacePatch } from "../src/state/ops";
import { newDocument } from "../src/state/useDocumentStore";
import { methodDef } from "../src/tools/defs";
import { DrawTool, SelectTool, type PointerInfo, type ToolContext } from "../src/tools/runtime";
import { displayGridStep } from "../src/canvas/render";
import { screenToWorld, worldToScreen, zoomAt } from "../src/canvas/camera";

const line = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({ id, layerId: "layer-1", kind: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });

/** Minimal headless document session mirroring the store. */
function session(entities: Entity[] = []) {
  let doc: CadDocument = { ...newDocument(), entities: [] };
  const index = new EntityIndex();
  doc = applyOps(doc, index, addPatch(doc, "seed", entities).ops);
  const undo: Patch[] = [];
  let selection: ReadonlySet<Id> = new Set();
  let n = 0;
  const ctx: ToolContext = {
    doc: () => doc,
    index: () => index,
    commit: (p) => {
      doc = applyOps(doc, index, p.ops);
      undo.push(p);
    },
    selection: () => selection,
    setSelection: (ids) => (selection = new Set(ids)),
    settings: () => ({
      gridSpacing: 10,
      gridVisible: true,
      angleStep: 15,
      doubleLineWidth: 6,
      doubleLineCaps: true,
      polygonSides: 6,
      cornerRadius: 0,
      arcRadius: 5,
      guideAngle: 45,
      penWeight: 0.25,
      dash: "solid",
      showWeights: false,
    }),
    tolerance: () => 0.5,
    newId: () => `n${n++}`,
  };
  return {
    ctx,
    index,
    undo,
    get doc() {
      return doc;
    },
    undoLast() {
      doc = applyOps(doc, index, invert(undo.pop()!).ops);
    },
  };
}

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({
  p: { x, y },
  raw: { x, y },
  screen: { x: x * 10, y: -y * 10 },
  shift: false,
  alt: false,
  ctrl: false,
  ...extra,
});
const click = (t: { down(e: PointerInfo): void; up(e: PointerInfo): void }, x: number, y: number, extra?: Partial<PointerInfo>) => {
  t.down(at(x, y, extra));
  t.up(at(x, y, extra));
};

describe("ops: apply / invert", () => {
  test("remove + undo restores draw order", () => {
    const s = session([line("a", 0, 0, 1, 0), line("b", 0, 1, 1, 1), line("c", 0, 2, 1, 2)]);
    s.ctx.commit(removePatch(s.doc, "Delete", ["a", "c"]));
    expect(s.doc.entities.map((e) => e.id)).toEqual(["b"]);
    s.undoLast();
    expect(s.doc.entities.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  test("replace + undo, and the index follows", () => {
    const s = session([line("a", 0, 0, 1, 0)]);
    const before = s.doc.entities[0];
    s.ctx.commit(replacePatch("Move", [[before, line("a", 100, 0, 101, 0)]]));
    expect(s.index.around({ x: 100, y: 0 }, 1).length).toBe(1);
    expect(s.index.around({ x: 0, y: 0 }, 1).length).toBe(0);
    s.undoLast();
    expect(s.index.around({ x: 0, y: 0 }, 1).length).toBe(1);
    expect(s.index.around({ x: 100, y: 0 }, 1).length).toBe(0);
  });

  test("live index matches a rebuilt index after many edits", () => {
    const s = session();
    for (let i = 0; i < 30; i++) s.ctx.commit(addPatch(s.doc, "add", [line(`l${i}`, i, 0, i, 5)]));
    s.ctx.commit(removePatch(s.doc, "del", ["l3", "l7", "l20"]));
    s.ctx.commit(replacePatch("mv", [[s.doc.entities[0], line("l0", 50, 50, 60, 60)]]));
    s.undoLast();
    s.undoLast();
    const rebuilt = new EntityIndex(s.doc.entities);
    const box = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    expect(s.index.spatial.search(box).sort()).toEqual(rebuilt.spatial.search(box).sort());
  });

  test("committed entities are frozen", () => {
    const s = session([line("a", 0, 0, 1, 0)]);
    expect(Object.isFrozen(s.doc.entities[0])).toBe(true);
    expect(Object.isFrozen((s.doc.entities[0] as Extract<Entity, { kind: "line" }>).a)).toBe(true);
  });
});

describe("drawing tools", () => {
  test("two-point line: click, click", () => {
    const s = session();
    const t = new DrawTool(methodDef("line", "twoPoint"), s.ctx);
    click(t, 0, 0);
    expect(t.busy()).toBe(true);
    click(t, 3, 4);
    expect(t.busy()).toBe(false);
    expect(s.doc.entities.length).toBe(1);
    const e = s.doc.entities[0] as Extract<Entity, { kind: "line" }>;
    expect(dist(e.a, e.b)).toBe(5);
    expect(e.layerId).toBe("layer-1");
  });

  test("press-drag-release also draws a line", () => {
    const s = session();
    const t = new DrawTool(methodDef("line", "twoPoint"), s.ctx);
    t.down(at(0, 0));
    t.move(at(2, 2));
    t.up(at(5, 0));
    expect(s.doc.entities.length).toBe(1);
  });

  test("continuous line finishes on Enter, closes on C", () => {
    const s = session();
    const t = new DrawTool(methodDef("line", "continuous"), s.ctx);
    click(t, 0, 0);
    click(t, 1, 0);
    click(t, 1, 1);
    t.key("Enter");
    const pl = s.doc.entities[0] as Extract<Entity, { kind: "polyline" }>;
    expect(pl.points.length).toBe(3);
    expect(pl.closed).toBe(false);
    click(t, 0, 0);
    click(t, 1, 0);
    click(t, 1, 1);
    t.key("c");
    expect((s.doc.entities[1] as Extract<Entity, { kind: "polyline" }>).closed).toBe(true);
  });

  test("double-click does not add a duplicate vertex", () => {
    const s = session();
    const t = new DrawTool(methodDef("spline", "interpolated"), s.ctx);
    click(t, 0, 0);
    click(t, 1, 1);
    click(t, 2, 0);
    click(t, 2, 0);
    t.dblclick();
    expect((s.doc.entities[0] as Extract<Entity, { kind: "spline" }>).points.length).toBe(3);
  });

  test("Escape cancels, Backspace removes the last point", () => {
    const s = session();
    const t = new DrawTool(methodDef("line", "continuous"), s.ctx);
    click(t, 0, 0);
    click(t, 1, 0);
    t.key("Backspace");
    expect(t.from()).toEqual({ x: 0, y: 0 });
    expect(t.key("Escape")).toBe(true);
    expect(t.busy()).toBe(false);
    expect(s.doc.entities.length).toBe(0);
  });

  test("typed points act like clicks", () => {
    const s = session();
    const t = new DrawTool(methodDef("circle", "centerRadius"), s.ctx);
    t.typed({ x: 0, y: 0 });
    t.typed({ x: 0, y: 7 });
    expect((s.doc.entities[0] as Extract<Entity, { kind: "circle" }>).r).toBe(7);
  });

  test("every method builds something sensible from generic clicks", () => {
    const cases: [string, string, [number, number][]][] = [
      ["doubleLine", "center", [[0, 0], [10, 0]]],
      ["rect", "corner", [[0, 0], [4, 3]]],
      ["rect", "center", [[0, 0], [4, 3]]],
      ["rect", "threePoint", [[0, 0], [4, 0], [2, 3]]],
      ["circle", "diameter", [[0, 0], [4, 0]]],
      ["circle", "threePoint", [[1, 0], [0, 1], [-1, 0]]],
      ["arc", "threePoint", [[1, 0], [0, 1], [-1, 0]]],
      ["arc", "centerStartEnd", [[0, 0], [2, 0], [0, 2]]],
      ["arc", "startEndRadius", [[0, 0], [4, 0], [2, 1]]],
      ["ellipse", "box", [[0, 0], [6, 2]]],
      ["ellipse", "centerAxes", [[0, 0], [3, 3], [0, 1]]],
      ["polygon", "inscribed", [[0, 0], [2, 0]]],
      ["polygon", "edge", [[0, 0], [2, 0]]],
      ["guide", "horizontal", [[0, 5]]],
      ["guide", "twoPoint", [[0, 0], [1, 1]]],
    ];
    for (const [tool, method, pts] of cases) {
      const s = session();
      const t = new DrawTool(methodDef(tool as never, method), s.ctx);
      for (const [x, y] of pts) click(t, x, y);
      expect([tool, method, s.doc.entities.length]).toEqual([tool, method, 1]);
    }
  });

  test("tangent-tangent-radius picks existing lines", () => {
    const s = session([line("h", -10, 0, 10, 0), line("v", 0, -10, 0, 10)]);
    const t = new DrawTool(methodDef("circle", "ttr"), s.ctx);
    click(t, 5, 0.1);
    click(t, 0.1, 5);
    const c = s.doc.entities[2] as Extract<Entity, { kind: "circle" }>;
    expect(c.kind).toBe("circle");
    expect(dist(c.center, { x: 5, y: 5 })).toBeLessThan(1e-9);
  });
});

describe("select tool", () => {
  const scene = () => session([line("a", 0, 0, 10, 0), line("b", 20, 0, 30, 0), line("c", 0, 20, 30, 20)]);

  test("click selects, shift-click toggles, empty click clears", () => {
    const s = scene();
    const t = new SelectTool(s.ctx);
    click(t, 5, 0.1);
    expect([...s.ctx.selection()]).toEqual(["a"]);
    click(t, 25, 0.1, { shift: true });
    expect([...s.ctx.selection()].sort()).toEqual(["a", "b"]);
    click(t, 25, 0.1, { shift: true });
    expect([...s.ctx.selection()]).toEqual(["a"]);
    click(t, 50, 50);
    expect(s.ctx.selection().size).toBe(0);
  });

  test("marquee left→right selects only enclosed; right→left crosses", () => {
    const s = scene();
    const t = new SelectTool(s.ctx);
    t.down(at(-1, -1));
    t.move(at(25, 25));
    t.up(at(25, 25));
    expect([...s.ctx.selection()]).toEqual(["a"]);
    t.down(at(25, 25));
    t.move(at(-1, -1));
    t.up(at(-1, -1));
    expect([...s.ctx.selection()].sort()).toEqual(["a", "b", "c"]);
  });

  test("dragging a selection is one undoable move", () => {
    const s = scene();
    const t = new SelectTool(s.ctx);
    click(t, 5, 0.1);
    t.down(at(5, 0));
    t.move(at(6, 3));
    t.move(at(7, 5));
    t.up(at(7, 5));
    expect(s.undo.length).toBe(1); // the seed is applied directly; only the move is recorded
    const a = s.doc.entities[0] as Extract<Entity, { kind: "line" }>;
    expect(a.a).toEqual({ x: 2, y: 5 });
    s.undoLast();
    expect((s.doc.entities[0] as Extract<Entity, { kind: "line" }>).a).toEqual({ x: 0, y: 0 });
  });

  test("Delete removes the selection", () => {
    const s = scene();
    const t = new SelectTool(s.ctx);
    click(t, 5, 0.1);
    t.key("Delete", { shift: false, ctrl: false });
    expect(s.doc.entities.map((e) => e.id)).toEqual(["b", "c"]);
  });
});

describe("camera and grid", () => {
  test("zoom keeps the point under the cursor fixed", () => {
    const cam = { cx: 100, cy: 50, zoom: 2, width: 800, height: 600 };
    const s = { x: 123, y: 456 };
    const w = screenToWorld(cam, s);
    const z = zoomAt(cam, s, 3.7);
    const back = worldToScreen(z, w);
    expect(Math.abs(back.x - s.x) + Math.abs(back.y - s.y)).toBeLessThan(1e-9);
  });

  test("y is up in world space", () => {
    const cam = { cx: 0, cy: 0, zoom: 1, width: 100, height: 100 };
    expect(worldToScreen(cam, { x: 0, y: 10 }).y).toBeLessThan(50);
  });

  test("display grid lands on multiples of the snap spacing", () => {
    for (const zoom of [0.01, 0.1, 0.5, 1, 5]) {
      const { step } = displayGridStep(25.4, zoom);
      expect(step * zoom).toBeGreaterThanOrEqual(12);
      expect(Math.abs(step / 25.4 - Math.round(step / 25.4))).toBeLessThan(1e-9);
    }
  });
});
