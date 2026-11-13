// DXF import/export.
//  Writer: AutoCAD 2000 ASCII (AC1015). R2000 is the oldest release that has real
//  HATCH entities and DIMENSION subclasses. Units are inches
//  for imperial drawings and millimetres otherwise. No handles.
//  Reader: R12 and R2000+ ASCII: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE/VERTEX,
//  ELLIPSE, SPLINE, XLINE/RAY, TEXT, MTEXT, SOLID, INSERT (+BLOCKS), HATCH,
//  DIMENSION (as a dimension when TemariCAD wrote it, otherwise its block),
//  layers, colours, linetypes and line-ending extended data.
import type { CadDocument, Entity, Id, Layer, SymbolDef, UnitSystem } from "../kernel/types";
import { DOCUMENT_VERSION } from "../kernel/types";
import { type PrimContext, flattenPrim, primsOf } from "../kernel/prims";
import { STANDARDS, dimGeometry } from "../kernel/dimensions";
import { endingKind, endingOutline, pathEnds } from "../kernel/endings";
import { outlineOf } from "../kernel/hatch";
import { toPath } from "../kernel/path";
import type { DimensionEntity, LineEnding } from "../kernel/types";
import { LINE_HEIGHT, textLines } from "../kernel/textMetrics";
import { TAU, normAngle } from "../kernel/vec";

// ---------------------------------------------------------------- colours

/** A few AutoCAD Colour Index entries (the ones we can name), as RGB. */
const ACI: [number, string][] = [
  [1, "#ff0000"],
  [2, "#ffff00"],
  [3, "#00ff00"],
  [4, "#00ffff"],
  [5, "#0000ff"],
  [6, "#ff00ff"],
  [7, "#000000"], // white-on-black / black-on-white
  [8, "#808080"],
  [9, "#c0c0c0"],
  [30, "#ff7f00"],
  [200, "#7f00ff"],
];

const rgbOf = (hex: string) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

export function hexToAci(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  let best = 7;
  let bd = Infinity;
  for (const [i, h] of ACI) {
    const [R, G, B] = rgbOf(h);
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export const aciToHex = (i: number): string | undefined => ACI.find(([k]) => k === Math.abs(i))?.[1];

const LTYPES: Record<string, { dxf: string; desc: string; pattern: number[] }> = {
  dashed: { dxf: "DASHED", desc: "Dashed __ __ __", pattern: [12.7, -6.35] },
  hidden: { dxf: "HIDDEN", desc: "Hidden _ _ _", pattern: [6.35, -3.175] },
  center: { dxf: "CENTER", desc: "Center ____ _ ____", pattern: [31.75, -6.35, 6.35, -6.35] },
  dotted: { dxf: "DOT", desc: "Dot . . . .", pattern: [0, -6.35] },
  dashdot: { dxf: "DASHDOT", desc: "Dash dot __ . __", pattern: [12.7, -6.35, 0, -6.35] },
};
const DXF_TO_DASH: Record<string, string> = { DASHED: "dashed", HIDDEN: "hidden", CENTER: "center", DOT: "dotted", DASHDOT: "dashdot" };

// ---------------------------------------------------------------- writer

const IMPERIAL: UnitSystem[] = ["architectural", "engineering", "inches", "feet"];

/** DXF-safe, unique names (31 chars of A-Z 0-9 $ - _). */
function nameMaker() {
  const used = new Set<string>();
  return (raw: string) => {
    let base = raw.toUpperCase().replace(/[^A-Z0-9$_-]+/g, "_").slice(0, 31) || "LAYER";
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base.slice(0, 28)}_${i}`;
    used.add(name);
    return name;
  };
}

export function exportDxf(doc: CadDocument, ctx: PrimContext): string {
  const imperial = IMPERIAL.includes(doc.units);
  const u = imperial ? 1 / 25.4 : 1;
  const out: string[] = [];
  let sink = out;
  const g = (code: number, value: string | number) => {
    sink.push(String(code));
    sink.push(typeof value === "number" ? fmt(value) : value);
  };
  const fmt = (v: number) => {
    if (!Number.isFinite(v)) return "0.0";
    const s = (Math.round(v * 1e8) / 1e8).toString();
    return s.includes(".") || s.includes("e") ? s : `${s}.0`;
  };
  const X = (v: number) => v * u;

  // Layer names.
  const layerName = nameMaker();
  const layerNames = new Map<Id, string>();
  for (const l of doc.layers) layerNames.set(l.id, layerName(l.name));
  const hasZero = [...layerNames.values()].includes("0");
  const blockName = nameMaker();
  const blockNames = new Map<Id, string>();
  for (const s of doc.symbols) blockNames.set(s.id, blockName(s.name || s.id));

  // Header.
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1015");
  g(9, "$INSUNITS");
  g(70, imperial ? 1 : 4);
  g(9, "$MEASUREMENT");
  g(70, imperial ? 0 : 1);
  g(0, "ENDSEC");

  // Tables.
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LTYPE");
  g(70, 1 + Object.keys(LTYPES).length);
  g(0, "LTYPE");
  g(2, "CONTINUOUS");
  g(70, 0);
  g(3, "Solid line");
  g(72, 65);
  g(73, 0);
  g(40, 0);
  for (const lt of Object.values(LTYPES)) {
    g(0, "LTYPE");
    g(2, lt.dxf);
    g(70, 0);
    g(3, lt.desc);
    g(72, 65);
    g(73, lt.pattern.length);
    g(40, lt.pattern.reduce((s, x) => s + Math.abs(x), 0) * u);
    for (const p of lt.pattern) g(49, p * u);
  }
  g(0, "ENDTAB");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, doc.layers.length + (hasZero ? 0 : 1));
  if (!hasZero) {
    g(0, "LAYER");
    g(2, "0");
    g(70, 0);
    g(62, 7);
    g(6, "CONTINUOUS");
  }
  for (const l of doc.layers) {
    g(0, "LAYER");
    g(2, layerNames.get(l.id)!);
    g(70, l.locked ? 4 : 0);
    const c = l.color ? hexToAci(l.color) : 7;
    g(62, l.visible ? c : -c); // negative colour = layer off
    g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "TABLE");
  g(2, "APPID");
  g(70, 1);
  g(0, "APPID");
  g(2, "TEMARICAD");
  g(70, 0);
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  const style = STANDARDS[doc.standard] ?? STANDARDS.ANSI;
  const layerScale = (id: Id) => doc.layers.find((l) => l.id === id)?.scale ?? 1;
  const tol = 0.1; // mm, for curves exported as polylines

  const common = (e: Entity, layer: string) => {
    g(8, layer);
    if (e.style?.dash && LTYPES[e.style.dash]) g(6, LTYPES[e.style.dash].dxf);
    if (e.style?.color) g(62, hexToAci(e.style.color));
  };
  const line = (e: Entity, layer: string, a: { x: number; y: number }, b: { x: number; y: number }, annotate = false) => {
    g(0, "LINE");
    common(e, layer);
    g(10, X(a.x));
    g(20, X(a.y));
    g(30, 0);
    g(11, X(b.x));
    g(21, X(b.y));
    g(31, 0);
    if (annotate) note(e);
  };
  const polyline = (e: Entity, layer: string, pts: { x: number; y: number }[], closed: boolean, bulges?: number[], tail?: () => void) => {
    if (pts.length < 2) return;
    g(0, "POLYLINE");
    common(e, layer);
    g(66, 1);
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(70, closed ? 1 : 0);
    tail?.();
    pts.forEach((p, i) => {
      g(0, "VERTEX");
      g(8, layer);
      g(10, X(p.x));
      g(20, X(p.y));
      g(30, 0);
      if (bulges?.[i]) g(42, bulges[i]);
    });
    g(0, "SEQEND");
    g(8, layer);
  };
  const note = (e: Entity) => {
    const tags: string[] = [];
    if (e.style?.startEnding) tags.push(`start=${e.style.startEnding}`);
    if (e.style?.endEnding) tags.push(`end=${e.style.endEnding}`);
    if (e.style?.fill) tags.push(`fill=${e.style.fill}`);
    if (!tags.length) return;
    g(1001, "TEMARICAD");
    for (const t of tags) g(1000, t);
  };
  const emitEndings = (e: Entity, layer: string) => {
    const k = layerScale(e.layerId);
    for (const end of pathEnds(e)) {
      const kind = endingKind(e, end.at);
      if (!kind) continue;
      const shape = endingOutline(end.tip, end.dir, kind, 3.2 * k);
      polyline(e, layer, shape.pts, !!shape.fill, undefined, () => {
        g(1001, "TEMARICAD");
        g(1000, "role=ending");
      });
    }
  };
  const emitHatch = (e: Entity, layer: string) => {
    const fill = e.style?.fill;
    if (!fill) return;
    const rings = outlineOf(e, ctx);
    if (!rings?.length) return;
    const solid = fill === "solid" || fill.startsWith("gray");
    g(0, "HATCH");
    g(100, "AcDbEntity");
    common(e, layer);
    g(100, "AcDbHatch");
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(210, 0);
    g(220, 0);
    g(230, 1);
    g(2, solid ? "SOLID" : fill.toUpperCase());
    g(70, solid ? 1 : 0);
    g(71, 0);
    g(91, rings.length);
    for (const ring of rings) {
      g(92, 3);
      g(72, 0);
      g(73, 1);
      g(93, ring.length);
      for (const p of ring) {
        g(10, X(p.x));
        g(20, X(p.y));
      }
      g(97, 0);
    }
    g(75, 1);
    g(76, 1);
    if (!solid) {
      g(52, 0);
      g(41, 1);
      g(77, 0);
      g(78, 1);
      g(53, 45);
      g(43, 0);
      g(44, 0);
      g(45, 0);
      g(46, 1);
      g(79, 0);
    }
    g(98, 0);
    g(1001, "TEMARICAD");
    g(1000, "role=pattern");
  };
  const picture = (e: DimensionEntity, layer: string) => {
    const geo = dimGeometry(e, layerScale(e.layerId), style, doc.units);
    for (const [a, b] of geo.lines) line(e, layer, a, b);
    for (const a of geo.arcs) polyline(e, layer, flattenPrim({ t: "arc", ...a }, tol).pts, false);
    for (const poly of geo.arrows) polyline(e, layer, poly, true);
    if (geo.text) {
      const down = 0.28 * geo.text.height;
      const p = { x: geo.text.pos.x + Math.sin(geo.text.angle) * down, y: geo.text.pos.y - Math.cos(geo.text.angle) * down };
      text(e, layer, p, geo.text.str, geo.text.height, geo.text.angle, "center");
    }
  };
  const dimBlocks: { name: string; body: string[] }[] = [];
  const dimName = new Map<string, string>();
  let dimN = 0;
  const ensureDim = (e: DimensionEntity) => {
    const have = dimName.get(e.id);
    if (have) return have;
    const name = `*D${++dimN}`;
    const body: string[] = [];
    const prev = sink;
    sink = body;
    picture(e, "0");
    sink = prev;
    dimBlocks.push({ name, body });
    dimName.set(e.id, name);
    return name;
  };
  const text = (e: Entity, layer: string, p: { x: number; y: number }, str: string, em: number, angle: number, align: "left" | "center" | "right") => {
    const lines = textLines(str);
    const step = LINE_HEIGHT * em;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    lines.forEach((line, i) => {
      const px = p.x + s * step * i;
      const py = p.y - c * step * i;
      g(0, "TEXT");
      common(e, layer);
      g(10, X(px));
      g(20, X(py));
      g(30, 0);
      g(40, X(em * 0.72)); // DXF height is the cap height
      g(1, line.replace(/[\r\n]+/g, " "));
      if (angle) g(50, (normAngle(angle) * 180) / Math.PI);
      if (align !== "left") {
        g(72, align === "center" ? 1 : 2);
        g(11, X(px));
        g(21, X(py));
        g(31, 0);
      }
    });
  };

  const emit = (e: Entity, layer: string) => {
    switch (e.kind) {
      case "guide":
        return; // construction lines are not exported
      case "line":
        line(e, layer, e.a, e.b, true);
        emitEndings(e, layer);
        return;
      case "circle":
        g(0, "CIRCLE");
        common(e, layer);
        g(10, X(e.center.x));
        g(20, X(e.center.y));
        g(30, 0);
        g(40, X(e.r));
        note(e);
        emitHatch(e, layer);
        return;
      case "arc":
        g(0, "ARC");
        common(e, layer);
        g(10, X(e.center.x));
        g(20, X(e.center.y));
        g(30, 0);
        g(40, X(e.r));
        g(50, (normAngle(e.start) * 180) / Math.PI);
        g(51, (normAngle(e.end) * 180) / Math.PI);
        note(e);
        emitEndings(e, layer);
        return;
      case "polyline":
      case "polygon":
      case "rect": {
        const path = toPath(e)!;
        const pts = path.segs.map((s) => (s.prim.t === "seg" ? s.prim.a : startOfArc(s)));
        if (!path.closed && path.segs.length) {
          const last = path.segs[path.segs.length - 1];
          pts.push(last.prim.t === "seg" ? last.prim.b : endOfArc(last));
        }
        const bulges = path.segs.map((s) => (s.prim.t === "arc" ? Math.tan(s.prim.sweep / 4) * (s.reversed ? -1 : 1) : 0));
        polyline(e, layer, pts, path.closed, bulges, () => note(e));
        if (!path.closed) emitEndings(e, layer);
        else emitHatch(e, layer);
        return;
      }
      case "text":
        return text(e, layer, e.position, e.text, e.height * layerScale(e.layerId), e.rotation, e.align);
      case "symbol": {
        const name = blockNames.get(e.symbolId);
        if (!name) return;
        g(0, "INSERT");
        common(e, layer);
        g(2, name);
        g(10, X(e.position.x));
        g(20, X(e.position.y));
        g(30, 0);
        if (e.scaleX !== 1) g(41, e.scaleX);
        if (e.scaleY !== 1) g(42, e.scaleY);
        if (e.rotation) g(50, (normAngle(e.rotation) * 180) / Math.PI);
        return;
      }
      case "dimension": {
        const name = ensureDim(e);
        const geo = dimGeometry(e, layerScale(e.layerId), style, doc.units);
        g(0, "DIMENSION");
        g(100, "AcDbEntity");
        common(e, layer);
        g(100, "AcDbDimension");
        g(2, name);
        g(10, X(e.linePoint.x));
        g(20, X(e.linePoint.y));
        g(30, 0);
        if (geo.text) {
          g(11, X(geo.text.pos.x));
          g(21, X(geo.text.pos.y));
          g(31, 0);
        }
        const code = e.dimType === "aligned" ? 1 : e.dimType === "angular" ? 2 : e.dimType === "diameter" ? 3 : e.dimType === "radius" ? 4 : 0;
        g(70, code);
        if (e.points[0]) {
          g(13, X(e.points[0].x));
          g(23, X(e.points[0].y));
          g(33, 0);
        }
        if (e.points[1]) {
          g(14, X(e.points[1].x));
          g(24, X(e.points[1].y));
          g(34, 0);
        }
        if (e.dimType === "horizontal") g(50, 0);
        if (e.dimType === "vertical") g(50, 90);
        if (e.textOverride) g(1, e.textOverride);
        g(100, e.dimType === "aligned" ? "AcDbAlignedDimension" : "AcDbRotatedDimension");
        g(1001, "TEMARICAD");
        g(1000, `dim=${e.dimType}`);
        g(1000, `pts=${e.points.map((p) => `${fmt(X(p.x))},${fmt(X(p.y))}`).join(";")}`);
        g(1000, `lp=${fmt(X(e.linePoint.x))},${fmt(X(e.linePoint.y))}`);
        if (e.textOverride !== undefined) g(1000, `text=${e.textOverride}`);
        if (e.textShift) g(1000, `shift=${fmt(X(e.textShift.x))},${fmt(X(e.textShift.y))}`);
        return;
      }
      default:
        // Walls (solved faces + door swings), double lines, ellipses, splines: geometry.
        for (const p of primsOf(e, ctx)) {
          if (p.t === "seg") line(e, layer, p.a, p.b);
          else if (p.t === "arc" && p.sweep >= TAU - 1e-9) {
            g(0, "CIRCLE");
            common(e, layer);
            g(10, X(p.c.x));
            g(20, X(p.c.y));
            g(30, 0);
            g(40, X(p.r));
          } else if (p.t === "arc") {
            g(0, "ARC");
            common(e, layer);
            g(10, X(p.c.x));
            g(20, X(p.c.y));
            g(30, 0);
            g(40, X(p.r));
            g(50, (normAngle(p.start) * 180) / Math.PI);
            g(51, (normAngle(p.start + p.sweep) * 180) / Math.PI);
          } else if (p.t !== "xline") polyline(e, layer, flattenPrim(p, tol).pts, false);
        }
        note(e);
        emitEndings(e, layer);
        emitHatch(e, layer);
    }
  };

  for (const e of doc.entities) if (e.kind === "dimension") ensureDim(e);
  for (const s of doc.symbols) for (const e of s.entities) if (e.kind === "dimension") ensureDim(e);

  // Blocks (symbols), with their own origin as the base point.
  g(0, "SECTION");
  g(2, "BLOCKS");
  for (const s of doc.symbols) {
    const name = blockNames.get(s.id)!;
    g(0, "BLOCK");
    g(8, "0");
    g(2, name);
    g(70, 0);
    g(10, X(s.origin.x));
    g(20, X(s.origin.y));
    g(30, 0);
    g(3, name);
    for (const c of s.entities) emit(c, "0");
    g(0, "ENDBLK");
    g(8, "0");
  }
  for (const b of dimBlocks) {
    g(0, "BLOCK");
    g(8, "0");
    g(2, b.name);
    g(70, 1);
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(3, b.name);
    for (const line of b.body) sink.push(line);
    g(0, "ENDBLK");
    g(8, "0");
  }
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");
  for (const e of doc.entities) emit(e, layerNames.get(e.layerId) ?? "0");
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

function startOfArc(s: { prim: { t: string; c?: { x: number; y: number }; r?: number; start?: number; sweep?: number }; reversed: boolean }) {
  const p = s.prim as { c: { x: number; y: number }; r: number; start: number; sweep: number };
  const a = s.reversed ? p.start + p.sweep : p.start;
  return { x: p.c.x + p.r * Math.cos(a), y: p.c.y + p.r * Math.sin(a) };
}
function endOfArc(s: { prim: { t: string }; reversed: boolean }) {
  const p = s.prim as unknown as { c: { x: number; y: number }; r: number; start: number; sweep: number };
  const a = s.reversed ? p.start : p.start + p.sweep;
  return { x: p.c.x + p.r * Math.cos(a), y: p.c.y + p.r * Math.sin(a) };
}

// ---------------------------------------------------------------- reader

/** Decode file bytes: UTF-8 for AC1021 (2007) and later, Windows-1252 before. */
export function decodeDxf(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const m = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d{4})/.exec(head);
  const ver = m ? +m[1] : 1009;
  return new TextDecoder(ver >= 1021 ? "utf-8" : "windows-1252").decode(bytes);
}

type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      i -= 1; // resync on a stray line
      continue;
    }
    out.push([code, lines[i + 1].replace(/\s+$/, "")]);
  }
  return out;
}

/** One entity's group codes. */
class Rec {
  /** POLYLINE only: its VERTEX records. */
  vertices?: Rec[];
  constructor(
    public type: string,
    public items: Pair[],
  ) {}
  str(code: number, def = "") {
    return this.items.find(([c]) => c === code)?.[1] ?? def;
  }
  num(code: number, def = 0) {
    const v = this.items.find(([c]) => c === code)?.[1];
    const n = v === undefined ? NaN : parseFloat(v);
    return Number.isFinite(n) ? n : def;
  }
  all(code: number) {
    return this.items.filter(([c]) => c === code).map(([, v]) => parseFloat(v));
  }
  /** Extrusion direction z (−1 = mirrored OCS). */
  get flip() {
    return this.num(230, 1) < 0;
  }
  /** TEMARICAD extended-data strings (1001 / 1000). */
  temari() {
    const out: string[] = [];
    let on = false;
    for (const [c, v] of this.items) {
      if (c === 1001) on = v.trim().toUpperCase() === "TEMARICAD";
      else if (on && c === 1000) out.push(v);
    }
    return out;
  }
}

const unescapeText = (s: string) =>
  s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[cC]/g, "⌀")
    .replace(/%%%/g, "%");

/** Strip MTEXT formatting codes; returns lines. */
function mtextLines(raw: string): string[] {
  const s = raw
    .replace(/\\[Pp]/g, "\n")
    .replace(/\\[ACFHQTWfhcaqtw][^;]*;/g, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/\\S([^^;]*)\^([^;]*);/g, "$1/$2")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\");
  return unescapeText(s).split("\n");
}

export interface DxfImportResult {
  doc: CadDocument;
  warnings: string[];
  /** Entities read, by DXF type. */
  counts: Record<string, number>;
}

export function importDxf(text: string, opts: { units?: UnitSystem } = {}): DxfImportResult {
  const ps = pairs(text);
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  // Split into sections.
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < ps.length; i++) {
    if (ps[i][0] === 0 && ps[i][1] === "SECTION" && ps[i + 1]?.[0] === 2) {
      const name = ps[i + 1][1];
      const start = i + 2;
      let j = start;
      while (j < ps.length && !(ps[j][0] === 0 && ps[j][1] === "ENDSEC")) j++;
      sections.set(name, ps.slice(start, j));
      i = j;
    }
  }

  // Units.
  const header = sections.get("HEADER") ?? [];
  const hv = (name: string) => {
    const i = header.findIndex(([c, v]) => c === 9 && v === name);
    return i >= 0 ? header[i + 1]?.[1] : undefined;
  };
  const insunits = hv("$INSUNITS") !== undefined ? parseInt(hv("$INSUNITS")!, 10) : undefined;
  const measurement = hv("$MEASUREMENT") !== undefined ? parseInt(hv("$MEASUREMENT")!, 10) : undefined;
  const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
  let k = 1;
  let units: UnitSystem = opts.units ?? "mm";
  if (insunits && UNIT_MM[insunits]) {
    k = UNIT_MM[insunits];
    if (!opts.units) units = insunits === 1 ? "architectural" : insunits === 2 ? "engineering" : insunits === 5 ? "cm" : insunits === 6 ? "m" : "mm";
  } else if (measurement === 0) {
    k = 25.4;
    if (!opts.units) units = "architectural";
    warnings.push("The file doesn't state its units; imperial (inches) assumed from $MEASUREMENT.");
  } else if (opts.units && IMPERIAL.includes(opts.units)) {
    k = 25.4;
  } else {
    warnings.push("The file doesn't state its units; millimetres assumed.");
  }

  // Layers.
  const layers: Layer[] = [];
  const layerByName = new Map<string, Layer>();
  const ensureLayer = (name: string) => {
    const key = name || "0";
    let l = layerByName.get(key.toUpperCase());
    if (!l) {
      l = { id: `dxf-layer-${layers.length + 1}`, name: key, visible: true, locked: false, scale: 1 };
      layers.push(l);
      layerByName.set(key.toUpperCase(), l);
    }
    return l;
  };
  const tables = sections.get("TABLES") ?? [];
  for (const rec of records(tables)) {
    if (rec.type !== "LAYER") continue;
    const l = ensureLayer(rec.str(2, "0"));
    const c = rec.num(62, 7);
    l.visible = c >= 0 && (rec.num(70) & 1) === 0;
    const hex = aciToHex(c);
    if (hex && hex !== "#000000") l.color = hex;
    if (rec.num(70) & 4) l.locked = true;
  }
  ensureLayer("0");

  let nid = 0;
  const id = () => `dxf${(nid++).toString(36)}`;
  const P = (x: number, y: number, flip = false) => ({ x: (flip ? -x : x) * k, y: y * k });

  const style = (rec: Rec): Entity["style"] | undefined => {
    const st: NonNullable<Entity["style"]> = {};
    const c = rec.num(62, 256);
    if (c !== 256 && c !== 0) {
      const hex = aciToHex(c);
      if (hex) st.color = hex;
    }
    const lt = DXF_TO_DASH[rec.str(6).toUpperCase()];
    if (lt) st.dash = lt;
    const ending = (v: string): v is LineEnding => v === "arrow" || v === "open" || v === "tick" || v === "dot";
    for (const t of rec.temari()) {
      const start = t.slice(6);
      const end = t.slice(4);
      if (t.startsWith("start=") && ending(start)) st.startEnding = start;
      if (t.startsWith("end=") && ending(end)) st.endEnding = end;
      if (t.startsWith("fill=") && t.length > 5) st.fill = t.slice(5);
    }
    return Object.keys(st).length ? st : undefined;
  };

  /** Convert one entity record (and following VERTEX/SEQEND for POLYLINE). */
  const convert = (rec: Rec, layerId: Id, out: Entity[], blocks: Map<string, BlockRec>) => {
    if (rec.temari().includes("role=ending")) return;
    const base = { id: id(), layerId, ...(style(rec) ? { style: style(rec) } : {}) };
    const f = rec.flip;
    counts[rec.type] = (counts[rec.type] ?? 0) + 1;
    switch (rec.type) {
      case "LINE":
        out.push({ ...base, kind: "line", a: P(rec.num(10), rec.num(20), f), b: P(rec.num(11), rec.num(21), f) });
        return;
      case "CIRCLE":
        out.push({ ...base, kind: "circle", center: P(rec.num(10), rec.num(20), f), r: rec.num(40) * k });
        return;
      case "ARC": {
        let s = (rec.num(50) * Math.PI) / 180;
        let e = (rec.num(51) * Math.PI) / 180;
        // In a mirrored OCS, angles reflect and the arc runs the other way.
        if (f) [s, e] = [Math.PI - e, Math.PI - s];
        out.push({ ...base, kind: "arc", center: P(rec.num(10), rec.num(20), f), r: rec.num(40) * k, start: normAngle(s), end: normAngle(e) });
        return;
      }
      case "LWPOLYLINE": {
        const pts: { x: number; y: number }[] = [];
        const bulges: number[] = [];
        let cur = -1;
        for (const [c, v] of rec.items) {
          if (c === 10) {
            pts.push({ x: parseFloat(v), y: 0 });
            bulges.push(0);
            cur = pts.length - 1;
          } else if (c === 20 && cur >= 0) pts[cur].y = parseFloat(v);
          else if (c === 42 && cur >= 0) bulges[cur] = parseFloat(v);
        }
        const closed = (rec.num(70) & 1) === 1;
        out.push({
          ...base,
          kind: "polyline",
          points: pts.map((p) => P(p.x, p.y, f)),
          closed,
          ...(bulges.some((b) => b) ? { bulges: bulges.map((b) => (f ? -b : b)) } : {}),
        });
        return;
      }
      case "POLYLINE": {
        const v = rec.vertices ?? [];
        const closed = (rec.num(70) & 1) === 1;
        const pts = v.map((r) => P(r.num(10), r.num(20), f));
        const bulges = v.map((r) => (f ? -1 : 1) * r.num(42));
        out.push({ ...base, kind: "polyline", points: pts, closed, ...(bulges.some((b) => b) ? { bulges } : {}) });
        return;
      }
      case "ELLIPSE": {
        const c = P(rec.num(10), rec.num(20), f);
        let mx = rec.num(11) * k;
        const my = rec.num(21) * k;
        if (f) mx = -mx;
        const ratio = rec.num(40, 1);
        let s = rec.num(41, 0);
        let e = rec.num(42, TAU);
        if (f) [s, e] = [-e, -s];
        const rx = Math.hypot(mx, my);
        const full = Math.abs(normAngle(e - s)) < 1e-9 || Math.abs(e - s - TAU) < 1e-9;
        out.push({ ...base, kind: "ellipse", center: c, rx, ry: rx * ratio, rotation: Math.atan2(my, mx), ...(full ? {} : { start: normAngle(s), end: normAngle(e) }) });
        return;
      }
      case "SPLINE": {
        const flags = rec.num(70);
        const closed = (flags & 1) === 1;
        const xs = rec.all(10);
        const ys = rec.all(20);
        const fx = rec.all(11);
        const fy = rec.all(21);
        if (xs.length >= 2) {
          const pts = xs.map((x, i) => P(x, ys[i] ?? 0, f));
          const weights = rec.all(41);
          out.push({
            ...base,
            kind: "spline",
            mode: "bspline",
            points: pts,
            closed,
            degree: rec.num(71, 3),
            knots: rec.all(40),
            ...(weights.length === pts.length ? { weights } : {}),
          });
        } else if (fx.length >= 2) out.push({ ...base, kind: "spline", mode: "interpolated", points: fx.map((x, i) => P(x, fy[i] ?? 0, f)), closed });
        return;
      }
      case "XLINE":
      case "RAY": {
        const d = { x: rec.num(11) * (f ? -1 : 1), y: rec.num(21) };
        if (Math.hypot(d.x, d.y) > 0) out.push({ ...base, kind: "guide", point: P(rec.num(10), rec.num(20), f), dir: d });
        return;
      }
      case "TEXT": {
        const h72 = rec.num(72);
        const anchor = h72 && (h72 === 1 || h72 === 2 || h72 === 4) ? P(rec.num(11), rec.num(21), f) : P(rec.num(10), rec.num(20), f);
        const align = h72 === 1 || h72 === 4 ? "center" : h72 === 2 ? "right" : "left";
        out.push({ ...base, kind: "text", position: anchor, text: unescapeText(rec.str(1)), height: (rec.num(40, 2.5) * k) / 0.72, rotation: (rec.num(50) * Math.PI) / 180, align });
        return;
      }
      case "MTEXT": {
        const raw = rec.items.filter(([c]) => c === 3).map(([, v]) => v).join("") + rec.str(1);
        const lines = mtextLines(raw);
        const h = (rec.num(40, 2.5) * k) / 0.72;
        const rot = rec.items.some(([c]) => c === 11) ? Math.atan2(rec.num(21), rec.num(11)) : (rec.num(50) * Math.PI) / 180;
        const att = rec.num(71, 1);
        const align = [2, 5, 8].includes(att) ? "center" : [3, 6, 9].includes(att) ? "right" : "left";
        const p0 = P(rec.num(10), rec.num(20), f);
        // First baseline sits about one cap height below a top-attached insertion point.
        const top = att <= 3 ? 0.72 * h : att <= 6 ? (0.72 * h - (lines.length - 1) * 1.4 * h) / 2 : -(lines.length - 1) * 1.4 * h;
        lines.forEach((ln, i) => {
          if (!ln.trim()) return;
          const dy = top + i * 1.4 * h;
          out.push({ ...base, id: i ? id() : base.id, kind: "text", position: { x: p0.x + Math.sin(rot) * dy, y: p0.y - Math.cos(rot) * dy }, text: ln, height: h, rotation: rot, align });
        });
        return;
      }
      case "SOLID": {
        const p = [10, 11, 12, 13].map((c) => P(rec.num(c), rec.num(c + 10), f));
        // SOLID corner order is 1-2-4-3.
        const poly = [p[0], p[1], p[3], p[2]].filter((q, i, a) => i === 0 || q.x !== a[i - 1].x || q.y !== a[i - 1].y);
        out.push({ ...base, kind: "polygon", points: poly, style: { ...base.style, fill: "solid" } });
        return;
      }
      case "INSERT": {
        const name = rec.str(2);
        if (!blocks.has(name)) {
          warnings.push(`Block "${name}" is missing; one insert skipped.`);
          return;
        }
        let sx = rec.num(41, 1);
        const sy = rec.num(42, 1);
        let rot = (rec.num(50) * Math.PI) / 180;
        if (f) {
          sx = -sx;
          rot = Math.PI - rot;
        }
        out.push({ ...base, kind: "symbol", symbolId: blockId(name), position: P(rec.num(10), rec.num(20), f), rotation: rot, scaleX: sx, scaleY: sy });
        return;
      }
      case "HATCH": {
        const tags = rec.temari();
        const pattern = rec.str(2, "SOLID");
        const fill = pattern.toUpperCase() === "SOLID" ? "solid" : pattern.toLowerCase();
        if (tags.includes("role=pattern")) {
          const prev = out[out.length - 1];
          if (prev) prev.style = { ...prev.style, fill };
          return;
        }
        const xs = rec.all(10);
        const ys = rec.all(20);
        if (xs.length >= 3) {
          out.push({ ...base, kind: "polygon", points: xs.map((x, i) => P(x, ys[i] ?? 0, f)), style: { ...base.style, fill } });
          return;
        }
        counts[rec.type]--;
        if (!counts[rec.type]) delete counts[rec.type];
        skipped.HATCH = (skipped.HATCH ?? 0) + 1;
        return;
      }
      case "DIMENSION": {
        const tags = rec.temari();
        const dimType = tags.find((t) => t.startsWith("dim="))?.slice(4);
        const known = dimType === "horizontal" || dimType === "vertical" || dimType === "aligned" || dimType === "angular" || dimType === "radius" || dimType === "diameter" || dimType === "centerMark";
        const pts = tags.find((t) => t.startsWith("pts="))?.slice(4) ?? "";
        const points = pts
          .split(";")
          .filter(Boolean)
          .map((s) => {
            const [x, y] = s.split(",").map(Number);
            return P(x, y, f);
          });
        if (known && points.length) {
          const lp = tags.find((t) => t.startsWith("lp="))?.slice(3) ?? "0,0";
          const [lx, ly] = lp.split(",").map(Number);
          const text = tags.find((t) => t.startsWith("text="))?.slice(5);
          const shift = tags.find((t) => t.startsWith("shift="))?.slice(6);
          let textShift: { x: number; y: number } | undefined;
          if (shift) {
            const [sx, sy] = shift.split(",").map(Number);
            if (Number.isFinite(sx) && Number.isFinite(sy)) textShift = P(sx, sy, f);
          }
          out.push({
            ...base,
            kind: "dimension",
            dimType,
            points,
            refs: points.map(() => null),
            linePoint: P(lx, ly, f),
            ...(text !== undefined ? { textOverride: text } : {}),
            ...(textShift ? { textShift } : {}),
          });
          return;
        }
        // No definition we understand: use the anonymous block's picture.
        const blk = blocks.get(rec.str(2));
        if (blk) for (const r of blk.recs) convert(r, layerId, out, blocks);
        else skipped.DIMENSION = (skipped.DIMENSION ?? 0) + 1;
        return;
      }
      default:
        counts[rec.type]--;
        if (!counts[rec.type]) delete counts[rec.type];
        skipped[rec.type] = (skipped[rec.type] ?? 0) + 1;
    }
  };

  // Blocks first (inserts refer to them).
  interface BlockRec {
    name: string;
    base: { x: number; y: number };
    recs: Rec[];
  }
  const blocks = new Map<string, BlockRec>();
  let cur: BlockRec | null = null;
  for (const rec of records(sections.get("BLOCKS") ?? [])) {
    if (rec.type === "BLOCK") cur = { name: rec.str(2), base: { x: rec.num(10), y: rec.num(20) }, recs: [] };
    else if (rec.type === "ENDBLK") {
      if (cur) blocks.set(cur.name, cur);
      cur = null;
    } else if (cur) cur.recs.push(rec);
  }
  const blockIds = new Map<string, Id>();
  const blockId = (name: string) => {
    let v = blockIds.get(name);
    if (!v) {
      v = `dxf-block-${blockIds.size + 1}`;
      blockIds.set(name, v);
    }
    return v;
  };

  const entities: Entity[] = [];
  for (const rec of records(sections.get("ENTITIES") ?? [])) convert(rec, ensureLayer(rec.str(8, "0")).id, entities, blocks);

  // Symbols for every block that an INSERT used (directly or nested).
  const symbols: SymbolDef[] = [];
  const done = new Set<string>();
  for (let pass = 0; pass < 32; pass++) {
    const pending = [...blockIds.keys()].filter((n) => !done.has(n));
    if (!pending.length) break;
    for (const name of pending) {
      done.add(name);
      const blk = blocks.get(name)!;
      const ents: Entity[] = [];
      for (const r of blk.recs) convert(r, ensureLayer(r.str(8, "0")).id, ents, blocks);
      symbols.push({ id: blockId(name), name: name.startsWith("*") ? `Block ${name.slice(1)}` : name, origin: { x: blk.base.x * k, y: blk.base.y * k }, entities: ents });
    }
  }

  const skippedList = Object.entries(skipped).map(([t, n]) => `${n} ${t}`);
  if (skippedList.length) warnings.push(`Not imported: ${skippedList.join(", ")}.`);
  const doc: CadDocument = {
    version: DOCUMENT_VERSION,
    units,
    standard: "ANSI",
    layers,
    activeLayerId: layers[0].id,
    entities,
    symbols,
  };
  return { doc, warnings, counts };
}

/** Group a section's pairs into entity/table records; POLYLINE collects its VERTEXes. */
function records(ps: Pair[]): (Rec & { vertices?: Rec[] })[] {
  const out: (Rec & { vertices?: Rec[] })[] = [];
  let cur: (Rec & { vertices?: Rec[] }) | null = null;
  let poly: (Rec & { vertices?: Rec[] }) | null = null;
  for (const [c, v] of ps) {
    if (c === 0) {
      if (v === "VERTEX" && poly) {
        cur = new Rec(v, []);
        poly.vertices!.push(cur);
        continue;
      }
      if (v === "SEQEND" && poly) {
        poly = null;
        cur = new Rec(v, []); // swallow its codes
        continue;
      }
      cur = new Rec(v, []);
      if (v === "POLYLINE") {
        cur.vertices = [];
        poly = cur;
      }
      out.push(cur);
      continue;
    }
    cur?.items.push([c, v]);
  }
  return out.filter((r) => r.type !== "SEQEND" && r.type !== "TABLE" && r.type !== "ENDTAB");
}
