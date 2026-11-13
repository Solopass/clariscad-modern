// Display list for plotting: the drawing as renderer-neutral marks.
// Units: geometry and text height in MODEL mm; pen widths, dash lengths and
// dot radii in PAPER mm (they never scale with the plot scale). Guides are
// construction lines and are not plotted.
import type { CadDocument, Entity, Layer, Id } from "../kernel/types";
import { type PrimContext, flattenPrim, primsOf, symbolTexts, symbolTransform, entityBBox, unionBox } from "../kernel/prims";
import { STANDARDS, dimGeometry } from "../kernel/dimensions";
import { entityHatch, fillRings, outlineOf, patternById } from "../kernel/hatch";
import { type Transform2D, apply, multiply } from "../kernel/transform";
import type { TextAlign } from "../kernel/textMetrics";
import type { BBox } from "../kernel/types";
import type { Vec2 } from "../kernel/vec";

export type Mark =
  | { t: "stroke"; pts: Vec2[]; closed: boolean; /** paper mm */ pen: number; color: string; /** paper mm */ dash?: number[] }
  | { t: "fill"; rings: Vec2[][]; color: string }
  | { t: "dot"; p: Vec2; /** paper mm */ r: number; color: string }
  | { t: "text"; pos: Vec2; angle: number; str: string; /** model mm (em) */ height: number; align: TextAlign; color: string };

/** Dash patterns in paper mm (the canvas uses screen-pixel versions). */
export const PLOT_DASHES: Record<string, number[]> = {
  dashed: [3, 1.5],
  dotted: [0.3, 1],
  dashdot: [5, 1, 0.5, 1],
  center: [8, 1.5, 1.5, 1.5],
  hidden: [2, 1],
};

export interface DisplayList {
  marks: Mark[];
  bbox: BBox | null;
}

const DEFAULT_PEN = 0.25;
const HATCH_PEN = 0.13;
const DIM_PEN = 0.18;

/**
 * Build the display list for every visible entity. `tol` is the curve
 * flattening tolerance in model mm (use ~0.02 paper mm × plot scale).
 */
export function buildDisplayList(doc: CadDocument, ctx: PrimContext, tol: number): DisplayList {
  const layers = new Map<Id, Layer>(doc.layers.map((l) => [l.id, l]));
  const style = STANDARDS[doc.standard] ?? STANDARDS.ANSI;
  const marks: Mark[] = [];
  let bbox: BBox | null = null;

  for (const e of doc.entities) {
    const layer = layers.get(e.layerId);
    if (layer && !layer.visible) continue;
    if (e.kind === "guide") continue;
    const k = layer?.scale ?? 1;
    const ink = e.style?.color ?? layer?.color ?? "#000000";
    const b = entityBBox(e, ctx);
    if (b) bbox = bbox ? unionBox(bbox, b) : b;

    if (e.style?.fill) fillMarks(e, ctx, k, ink, marks);
    if (e.kind === "symbol") {
      symbolFills(e, ctx, ink, marks);
      for (const t of symbolTexts(e, ctx)) marks.push({ t: "text", pos: t.position, angle: t.rotation, str: t.text, height: t.height * k, align: t.align, color: t.style?.color ?? ink });
    }

    if (e.kind === "dimension") {
      const g = dimGeometry(e, k, style, doc.units);
      for (const [a, c] of g.lines) marks.push({ t: "stroke", pts: [a, c], closed: false, pen: DIM_PEN, color: ink });
      for (const a of g.arcs) marks.push({ t: "stroke", pts: flattenPrim({ t: "arc", ...a }, tol).pts, closed: false, pen: DIM_PEN, color: ink });
      for (const poly of g.arrows) marks.push(g.filledArrows ? { t: "fill", rings: [poly], color: ink } : { t: "stroke", pts: poly, closed: true, pen: DIM_PEN, color: ink });
      if (g.text) marks.push({ t: "text", angle: g.text.angle, str: g.text.str, height: g.text.height, align: "center", color: ink, ...verticalCenter(g.text) });
      continue;
    }
    if (e.kind === "text") {
      marks.push({ t: "text", pos: e.position, angle: e.rotation, str: e.text, height: e.height * k, align: e.align, color: ink });
      continue;
    }
    const pen = e.style?.penWeight ?? DEFAULT_PEN;
    const dash = e.style?.dash ? PLOT_DASHES[e.style.dash] : undefined;
    for (const p of primsOf(e, ctx)) {
      if (p.t === "xline") continue;
      const { pts } = flattenPrim(p, tol);
      marks.push({ t: "stroke", pts, closed: false, pen, color: ink, ...(dash ? { dash } : {}) });
    }
  }
  return { marks, bbox };
}

/** Dimension text is anchored at its middle; shift to a baseline anchor. */
function verticalCenter(t: { pos: Vec2; angle: number; height: number }): { pos: Vec2 } {
  const down = 0.28 * t.height; // ≈ half the cap height
  return { pos: { x: t.pos.x + Math.sin(t.angle) * down, y: t.pos.y - Math.cos(t.angle) * down } };
}

function fillMarks(e: Entity, ctx: PrimContext, k: number, ink: string, out: Mark[]) {
  const pat = patternById(e.style?.fill);
  if (!pat) return;
  const scale = k * (e.style?.fillScale ?? 1);
  if (pat.solid) {
    const rings = outlineOf(e, ctx);
    if (rings) out.push({ t: "fill", rings, color: pat.solid === "#000000" ? ink : pat.solid });
    return;
  }
  const { rings, result } = entityHatch(e, pat.id, scale, ctx);
  if (!rings || !result) return;
  if (result.dense) {
    out.push({ t: "fill", rings, color: "#c8c8c8" });
    return;
  }
  for (const [a, b] of result.segs) out.push({ t: "stroke", pts: [a, b], closed: false, pen: HATCH_PEN, color: ink });
  for (const d of result.dots) out.push({ t: "dot", p: d, r: 0.15, color: ink });
}

function symbolFills(inst: Extract<Entity, { kind: "symbol" }>, ctx: PrimContext, ink: string, out: Mark[], parent?: Transform2D, depth = 0) {
  const defs = ctx.symbols;
  const def = defs instanceof Map ? defs.get(inst.symbolId) : defs?.[inst.symbolId];
  if (!def || depth > 8) return;
  const own = symbolTransform(def.origin, inst.position, inst.rotation, inst.scaleX, inst.scaleY);
  const T = parent ? multiply(parent, own) : own;
  for (const child of def.entities) {
    if (child.kind === "symbol") {
      symbolFills(child, ctx, ink, out, T, depth + 1);
      continue;
    }
    const pat = patternById(child.style?.fill);
    const rings = pat?.solid ? fillRings(child) : null;
    if (!pat || !rings) continue;
    out.push({ t: "fill", rings: rings.map((r) => r.map((p) => apply(T, p))), color: pat.solid === "#000000" ? (child.style?.color ?? ink) : pat.solid! });
  }
}

// ---------------------------------------------------------------- paper

export interface PaperSize {
  id: string;
  label: string;
  /** Portrait width × height in mm. */
  w: number;
  h: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: "letter", label: "Letter (8.5 × 11 in)", w: 215.9, h: 279.4 },
  { id: "legal", label: "Legal (8.5 × 14 in)", w: 215.9, h: 355.6 },
  { id: "tabloid", label: "Tabloid / ANSI B (11 × 17 in)", w: 279.4, h: 431.8 },
  { id: "ansiC", label: "ANSI C (17 × 22 in)", w: 431.8, h: 558.8 },
  { id: "ansiD", label: "ANSI D (22 × 34 in)", w: 558.8, h: 863.6 },
  { id: "a4", label: "A4", w: 210, h: 297 },
  { id: "a3", label: "A3", w: 297, h: 420 },
  { id: "a2", label: "A2", w: 420, h: 594 },
  { id: "a1", label: "A1", w: 594, h: 841 },
];

/** MacPlot-style pen table: plot width (paper mm) by entity colour. */
export const PEN_BY_COLOR: Record<string, number> = {
  "#000000": 0.35,
  "#d6001c": 0.18,
  "#0a7d32": 0.25,
  "#1f4fd1": 0.5,
  "#c06000": 0.7,
  "#7a3db8": 0.13,
  "#00838f": 0.25,
  "#808080": 0.13,
};
