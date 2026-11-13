import { beforeEach, describe, expect, test } from "bun:test";
import { type CadDocument, type Entity, dist } from "../src/kernel";
import { textWidth } from "../src/kernel/textMetrics";
import { mirrorAcross, transformEntity } from "../src/kernel/edit";
import { useDocumentStore, newDocument } from "../src/state/useDocumentStore";
import { buildPdf, pdfString } from "../src/io/pdfWriter";
import { buildDisplayList } from "../src/io/plot";
import { exportSvg } from "../src/io/svgExporter";
import { plotPdf } from "../src/io/pdfPlotter";
import { PAPER_SIZES } from "../src/io/plot";
import { exportDxf, importDxf, hexToAci, aciToHex } from "../src/io/dxfCodec";
import { FileFormatError, parseDocument, serializeDocument } from "../src/io/nativeJson";

const S = () => useDocumentStore.getState();
const L = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({ id, layerId: "layer-1", kind: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });
const add = (...es: Entity[]) => S().commit({ label: "add", ops: es.map((entity, i) => ({ op: "add" as const, entity, index: S().doc.entities.length + i })) });
const text = (extra: Partial<Extract<Entity, { kind: "text" }>> = {}): Entity => ({ id: "t", layerId: "layer-1", kind: "text", position: { x: 0, y: 0 }, text: "Kitchen", height: 3, rotation: 0, align: "left", ...extra });

beforeEach(() => S().load(newDocument()));

describe("text", () => {
  test("Helvetica widths", () => {
    expect(textWidth("ii", 10)).toBeCloseTo(4.44, 9);
    expect(textWidth("MW", 1)).toBeCloseTo(1.777, 9);
  });

  test("text box follows the layer scale and is pickable inside", () => {
    add(text());
    const k = S().doc.layers[0].scale; // 48 by default
    const w = textWidth("Kitchen", 3 * k);
    expect(S().index.around({ x: w / 2, y: 0.3 * 3 * k }, 1).length).toBe(1);
    const hit = S().index.nearest({ x: w / 2, y: 0.3 * 3 * k }, 1);
    expect(hit[0].distance).toBe(0);
  });

  test("mirrored text stays readable", () => {
    const t = transformEntity(text({ position: { x: 10, y: 0 } }), mirrorAcross({ x: 0, y: 0 }, Math.PI / 2)) as Extract<Entity, { kind: "text" }>;
    expect(dist(t.position, { x: -10, y: 0 })).toBeLessThan(1e-9);
    expect(Math.abs(Math.cos(t.rotation))).toBeCloseTo(1, 9); // baseline still horizontal, not mirrored glyphs
  });
});

describe("PDF writer", () => {
  test("xref offsets point at each object", () => {
    const pdf = buildPdf([{ width: 612, height: 792, ops: ["0 0 m 100 100 l S", `BT /F1 12 Tf 10 10 Td ${pdfString("Ø 12°")} Tj ET`] }]);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    const startxref = +pdf.slice(pdf.lastIndexOf("startxref") + 10).split("\n")[0];
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const entries = pdf.slice(startxref).split("\n").slice(2).filter((l) => / n $/.test(l));
    entries.forEach((e, i) => {
      const off = +e.slice(0, 10);
      expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
      expect(e.length + 1).toBe(20); // each entry is exactly 20 bytes including the newline
    });
    for (const ch of pdf) expect(ch.charCodeAt(0)).toBeLessThan(128);
  });

  test("strings escape and encode", () => {
    expect(pdfString("a(b)\\c")).toBe("(a\\(b\\)\\\\c)");
    expect(pdfString("12°")).toBe("(12\\260)");
    expect(pdfString("⌀")).toBe("(\\330)"); // substituted with Ø
  });
});

describe("plotting", () => {
  const scene = () => {
    add(L("a", 0, 0, 10000, 0), { id: "r", layerId: "layer-1", kind: "rect", center: { x: 5000, y: 2500 }, width: 4000, height: 3000, rotation: 0, cornerRadius: 0, style: { fill: "ansi31", penWeight: 0.5 } }, text({ position: { x: 1000, y: 4000 } }));
    return buildDisplayList(S().doc, S().index.ctx!, 1);
  };

  test("display list: strokes with paper pen widths, hatch, text", () => {
    const dl = scene();
    expect(dl.marks.some((m) => m.t === "stroke" && m.pen === 0.5)).toBe(true);
    expect(dl.marks.filter((m) => m.t === "stroke" && m.pen === 0.13).length).toBeGreaterThan(5);
    expect(dl.marks.some((m) => m.t === "text" && m.str === "Kitchen")).toBe(true);
    expect(dl.bbox!.maxX).toBeGreaterThanOrEqual(10000);
  });

  test("SVG is true size in millimetres", () => {
    const svg = exportSvg(scene(), { scale: 100, margin: 10 });
    expect(svg).toContain('width="120mm"');
    expect(svg).toContain("<text");
  });

  test("PDF tiles across sheets when the drawing is bigger than the paper", () => {
    const dl = scene();
    const one = plotPdf(dl, { scale: 100, paper: PAPER_SIZES.find((p) => p.id === "letter")!, landscape: true });
    expect(one.pages).toBe(1);
    const many = plotPdf(dl, { scale: 10, paper: PAPER_SIZES.find((p) => p.id === "letter")!, landscape: true });
    expect(many.pages).toBeGreaterThan(1);
    expect(many.pdf.match(/\/Type \/Page /g)!.length).toBe(many.pages);
    const fit = plotPdf(dl, { scale: 1, fit: true, paper: PAPER_SIZES.find((p) => p.id === "a4")!, landscape: false });
    expect(fit.pages).toBe(1);
  });
});

describe("DXF", () => {
  test("colours map to the AutoCAD index and back", () => {
    expect(hexToAci("#d6001c")).toBe(1);
    expect(aciToHex(5)).toBe("#0000ff");
  });

  test("round trip in millimetres: lines, arcs, bulged polylines, text, blocks", () => {
    S().setUnits("mm");
    add(
      L("l", 0, 0, 100, 50),
      { id: "c", layerId: "layer-1", kind: "circle", center: { x: 10, y: 10 }, r: 5 },
      { id: "a", layerId: "layer-1", kind: "arc", center: { x: 0, y: 0 }, r: 20, start: 0, end: Math.PI / 2 },
      { id: "p", layerId: "layer-1", kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true, bulges: [0, 0.5, 0] },
      text({ position: { x: 5, y: 5 }, align: "center" }),
    );
    S().commit({ label: "sym", ops: [{ op: "symbolDef", before: null, after: { id: "s1", name: "Door Tag", origin: { x: 1, y: 1 }, entities: [L("x", 1, 1, 3, 3)] }, index: 0 }] });
    add({ id: "i", layerId: "layer-1", kind: "symbol", symbolId: "s1", position: { x: 50, y: 50 }, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 });
    const dxf = exportDxf(S().doc, S().index.ctx!);
    expect(dxf).toContain("AC1015");
    const r = importDxf(dxf);
    const kinds = r.doc.entities.map((e) => e.kind).sort();
    expect(kinds).toEqual(["arc", "circle", "line", "polyline", "symbol", "text"]);
    const line = r.doc.entities.find((e) => e.kind === "line") as Extract<Entity, { kind: "line" }>;
    expect(dist(line.b, { x: 100, y: 50 })).toBeLessThan(1e-6);
    const pl = r.doc.entities.find((e) => e.kind === "polyline") as Extract<Entity, { kind: "polyline" }>;
    expect(pl.closed).toBe(true);
    expect(pl.bulges?.[1]).toBeCloseTo(0.5, 9);
    const sym = r.doc.entities.find((e) => e.kind === "symbol") as Extract<Entity, { kind: "symbol" }>;
    expect(sym.scaleX).toBe(2);
    expect(r.doc.symbols[0].origin).toEqual({ x: 1, y: 1 });
    const t = r.doc.entities.find((e) => e.kind === "text") as Extract<Entity, { kind: "text" }>;
    expect(t.align).toBe("center");
    // Text height: em size × layer scale out, cap height in the file, em size back in.
    expect(t.height).toBeCloseTo(3 * S().doc.layers[0].scale, 6);
  });

  test("imperial drawings are written in inches and read back in mm", () => {
    S().setUnits("architectural");
    add(L("l", 0, 0, 254, 0));
    const dxf = exportDxf(S().doc, S().index.ctx!);
    expect(dxf).toMatch(/\n11\r?\n10\.0\r?\n/); // 254 mm = 10 in
    const r = importDxf(dxf);
    expect((r.doc.entities[0] as Extract<Entity, { kind: "line" }>).b.x).toBeCloseTo(254, 9);
    expect(r.doc.units).toBe("architectural");
  });

  const dxfOf = (entities: string, header = "") => `0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;

  test("reader: LWPOLYLINE with bulge, mirrored arc, ellipse, MTEXT, $INSUNITS", () => {
    const r = importDxf(
      dxfOf(
        [
          "0\nLWPOLYLINE\n8\nA\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n",
          // Arc 0°→90° in a mirrored OCS (extrusion 0,0,-1) is 90°→180° in world space, centre at -5.
          "0\nARC\n8\nA\n10\n5\n20\n0\n40\n1\n50\n0\n51\n90\n230\n-1\n",
          "0\nELLIPSE\n8\nA\n10\n0\n20\n0\n11\n0\n21\n4\n40\n0.5\n41\n0\n42\n6.283185307179586\n",
          "0\nMTEXT\n8\nA\n10\n0\n20\n0\n40\n2.5\n71\n1\n1\n{\\fArial;Hello}\\PWorld\n",
        ].join(""),
        "9\n$INSUNITS\n70\n4\n",
      ),
    );
    const [pl, arc, ell, t1, t2] = r.doc.entities as any[];
    expect(pl.bulges[0]).toBe(1);
    expect(arc.center).toEqual({ x: -5, y: 0 });
    expect(arc.start).toBeCloseTo(Math.PI / 2, 9);
    expect(arc.end).toBeCloseTo(Math.PI, 9);
    expect(ell.rx).toBeCloseTo(4, 9);
    expect(ell.ry).toBeCloseTo(2, 9);
    expect(ell.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect([t1.text, t2.text]).toEqual(["Hello", "World"]);
    expect(r.warnings.join(" ")).not.toContain("units");
  });

  test("reader: unknown entities are reported, not fatal", () => {
    const r = importDxf(dxfOf("0\nHATCH\n8\n0\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n1\n"));
    expect(r.doc.entities.length).toBe(1);
    expect(r.warnings.join(" ")).toContain("1 HATCH");
  });
});

describe("native file", () => {
  test("save and load round trip", () => {
    add(L("a", 0, 0, 1, 1), text());
    const r = parseDocument(serializeDocument(S().doc));
    expect(r.doc.entities.length).toBe(2);
    expect(r.warnings).toEqual([]);
  });

  test("damaged objects are dropped with a warning; newer files are refused", () => {
    const doc: CadDocument = { ...newDocument(), entities: [L("a", 0, 0, 1, 1), { id: "bad", layerId: "layer-1", kind: "line" } as unknown as Entity] };
    const r = parseDocument(serializeDocument(doc));
    expect(r.doc.entities.length).toBe(1);
    expect(r.warnings[0]).toContain("1 damaged");
    expect(() => parseDocument(serializeDocument({ ...doc, version: 99 }))).toThrow(FileFormatError);
    expect(() => parseDocument("not json")).toThrow(FileFormatError);
  });

  test("unsaved-changes tracking follows undo", () => {
    expect(S().isDirty()).toBe(false);
    add(L("a", 0, 0, 1, 1));
    expect(S().isDirty()).toBe(true);
    S().markSaved({ name: "Plan.tcad" });
    expect(S().isDirty()).toBe(false);
    add(L("b", 0, 0, 2, 2));
    expect(S().isDirty()).toBe(true);
    S().undo();
    expect(S().isDirty()).toBe(false); // back to the saved state
    S().load(newDocument(), { name: "Recovered", dirty: true });
    expect(S().isDirty()).toBe(true);
  });
});

describe("review fixes (M5 final review)", () => {
  test("mirrored text is turned upright with its alignment swapped", () => {
    const t = transformEntity(text({ position: { x: 10, y: 0 }, align: "left" }), mirrorAcross({ x: 0, y: 0 }, Math.PI / 2)) as Extract<Entity, { kind: "text" }>;
    expect(Math.cos(t.rotation)).toBeCloseTo(1, 9); // reads left-to-right
    expect(t.align).toBe("right");
  });

  test("text inside symbols is plotted", () => {
    S().commit({ label: "sym", ops: [{ op: "symbolDef", before: null, after: { id: "tag", name: "Tag", origin: { x: 0, y: 0 }, entities: [text({ id: "c", layerId: "" })] }, index: 0 }] });
    add({ id: "i", layerId: "layer-1", kind: "symbol", symbolId: "tag", position: { x: 100, y: 0 }, rotation: 0, scaleX: -1, scaleY: 1 });
    const dl = buildDisplayList(S().doc, S().index.ctx!, 1);
    const t = dl.marks.find((m) => m.t === "text");
    expect(t && t.t === "text" && t.str).toBe("Kitchen");
    expect(t && t.t === "text" && t.align).toBe("right"); // mirrored placement, still readable
  });

  test("absurd sheet counts are refused before any geometry is built", () => {
    add(L("a", 0, 0, 15000, 15000));
    const dl = buildDisplayList(S().doc, S().index.ctx!, 1);
    expect(() => plotPdf(dl, { scale: 1, paper: PAPER_SIZES[0], landscape: false })).toThrow(/sheets/);
  });

  test("load drops text without a height and bad objects inside symbols", () => {
    const doc = {
      ...newDocument(),
      entities: [{ id: "t", layerId: "layer-1", kind: "text", position: { x: 0, y: 0 } } as unknown as Entity],
      symbols: [{ id: "s", name: "S", origin: { x: 0, y: 0 }, entities: [L("ok", 0, 0, 1, 1), { id: "x", layerId: "", kind: "circle" } as unknown as Entity] }],
    };
    const r = parseDocument(serializeDocument(doc));
    expect(r.doc.entities.length).toBe(0);
    expect(r.doc.symbols[0].entities.length).toBe(1);
    expect(r.warnings.length).toBe(2);
  });
});
