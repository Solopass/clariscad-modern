// Vector PDF plot: the display list on sheets of paper at a plot scale, tiled
// across several pages when the drawing is bigger than one sheet.
import type { BBox } from "../kernel/types";
import type { DisplayList, Mark, PaperSize } from "./plot";
import { type PdfPage, buildPdf, n, pdfString } from "./pdfWriter";
import { type PlotStyle, colorFor, penFor } from "./svgExporter";
import { LINE_HEIGHT, textLines, textWidth } from "../kernel/textMetrics";
import type { TitleMark } from "../state/titleBlock";

const PT = 72 / 25.4; // points per mm
/** Refuse plots that would need more sheets than this. */
export const MAX_SHEETS = 100;

export interface PdfOptions extends PlotStyle {
  paper: PaperSize;
  landscape: boolean;
  /** Fit the drawing on one sheet (overrides `scale`). */
  fit?: boolean;
  title?: string;
  /** Title block in paper millimetres, drawn in the corner of every sheet. */
  titleBlock?: TitleMark;
}

export interface PdfResult {
  pdf: string;
  pages: number;
  /** The scale actually used (model mm per paper mm). */
  scale: number;
}

export interface SheetLayout {
  scale: number;
  cols: number;
  rows: number;
  sheetW: number;
  sheetH: number;
  areaW: number;
  areaH: number;
  margin: number;
}

/** Sheet arrangement from the drawing's extent alone (cheap: no geometry). */
export function sheetLayout(b: BBox, o: PdfOptions): SheetLayout {
  const margin = o.margin ?? 10;
  const sheetW = o.landscape ? o.paper.h : o.paper.w;
  const sheetH = o.landscape ? o.paper.w : o.paper.h;
  const areaW = sheetW - 2 * margin;
  const areaH = sheetH - 2 * margin - 6; // room for a sheet label
  const dw = Math.max(b.maxX - b.minX, 1e-6);
  const dh = Math.max(b.maxY - b.minY, 1e-6);
  const scale = o.fit ? Math.max(dw / areaW, dh / areaH) : o.scale;
  const cols = Math.max(1, Math.ceil(dw / scale / areaW - 1e-9));
  const rows = Math.max(1, Math.ceil(dh / scale / areaH - 1e-9));
  return { scale, cols, rows, sheetW, sheetH, areaW, areaH, margin };
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return v.map((x) => (Number.isFinite(x) ? x / 255 : 0)) as [number, number, number];
}

/** A mark's extent in model mm (text approximated by its width/height). */
function markBox(m: Mark): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x: number, y: number) => {
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  };
  if (m.t === "stroke") for (const p of m.pts) grow(p.x, p.y);
  else if (m.t === "fill") for (const r of m.rings) for (const p of r) grow(p.x, p.y);
  else if (m.t === "dot") grow(m.p.x, m.p.y);
  else {
    const w = textWidth(m.str, m.height) + m.height;
    grow(m.pos.x - w, m.pos.y - w);
    grow(m.pos.x + w, m.pos.y + w);
  }
  return b;
}

export function plotPdf(dl: DisplayList, o: PdfOptions): PdfResult {
  const b = dl.bbox ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const L = sheetLayout(b, o);
  const { scale, cols, rows, sheetW, sheetH, areaW, areaH, margin } = L;
  const total = cols * rows;
  if (total > MAX_SHEETS) throw new Error(`This would need ${total} sheets. Choose a smaller scale, a bigger sheet, or Fit to one sheet.`);
  const paperW = (b.maxX - b.minX) / scale;
  const paperH = (b.maxY - b.minY) / scale;
  const boxes = dl.marks.map(markBox);

  const pages: PdfPage[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      // Paper coordinates of this tile's lower-left corner (paper y up, from the drawing's bottom).
      const tx = c * areaW;
      const ty = (rows - 1 - r) * areaH;
      // Centre a single-sheet plot on the page.
      const offX = total === 1 ? (areaW - paperW) / 2 : 0;
      const offY = total === 1 ? (areaH - paperH) / 2 : 0;
      const X = (x: number) => (margin + offX + (x - b.minX) / scale - tx) * PT;
      const Y = (y: number) => (margin + 6 + offY + (y - b.minY) / scale - ty) * PT;
      // This tile in model coordinates, for skipping marks that can't appear on it.
      const tile = { minX: b.minX + tx * scale, maxX: b.minX + (tx + areaW) * scale, minY: b.minY + ty * scale, maxY: b.minY + (ty + areaH) * scale };
      const ops: string[] = [];
      ops.push("q", `${n(margin * PT)} ${n((margin + 6) * PT)} ${n(areaW * PT)} ${n(areaH * PT)} re W n`, "1 J 1 j");
      dl.marks.forEach((m, i) => {
        const mb = boxes[i];
        if (total > 1 && (mb.maxX < tile.minX || mb.minX > tile.maxX || mb.maxY < tile.minY || mb.minY > tile.maxY)) return;
        ops.push(...markOps(m, X, Y, scale, o));
      });
      ops.push("Q");
      if (total > 1 || o.title) {
        const label = `${o.title ?? "Drawing"}${total > 1 ? `  —  sheet ${r * cols + c + 1} of ${total} (row ${r + 1}, column ${c + 1})` : ""}`;
        ops.push("0 g", `BT /F1 7 Tf ${n(margin * PT)} ${n(margin * PT)} Td ${pdfString(label)} Tj ET`);
      }
      if (o.titleBlock) ops.push(...titleBlockOps(o.titleBlock, sheetW));
      pages.push({ width: sheetW * PT, height: sheetH * PT, ops });
    }
  return { pdf: buildPdf(pages, { title: o.title }), pages: total, scale };
}

/** Title block in the lower-right of the paper, in the same arrangement as the sheet. */
function titleBlockOps(block: TitleMark, sheetW: number): string[] {
  const ox = (sheetW - block.w - 8) * PT;
  const oy = 8 * PT;
  const X = (x: number) => ox + x * PT;
  const Y = (y: number) => oy + y * PT;
  const ops = ["0 G", "0 g", "0.4 w"];
  for (const [a, b] of block.lines) ops.push(`${n(X(a.x))} ${n(Y(a.y))} m ${n(X(b.x))} ${n(Y(b.y))} l S`);
  for (const t of block.texts) {
    const size = t.h * PT;
    const w = textWidth(t.str, size);
    const shift = t.align === "center" ? -w / 2 : 0;
    ops.push(`BT /F1 ${n(size)} Tf 1 0 0 1 ${n(X(t.pos.x))} ${n(Y(t.pos.y))} Tm ${n(shift)} 0 Td ${pdfString(t.str)} Tj ET`);
  }
  return ops;
}

function markOps(m: Mark, X: (x: number) => number, Y: (y: number) => number, scale: number, o: PdfOptions): string[] {
  switch (m.t) {
    case "stroke": {
      if (m.pts.length < 2) return [];
      const [r, g, bl] = rgb(colorFor(m.color, o));
      const path = m.pts.map((p, i) => `${n(X(p.x))} ${n(Y(p.y))} ${i ? "l" : "m"}`).join(" ");
      const dash = m.dash ? `[${m.dash.map((d) => n(d * PT)).join(" ")}] 0 d` : "[] 0 d";
      return [`${n(r)} ${n(g)} ${n(bl)} RG ${n(penFor(m, o) * PT)} w ${dash}`, `${path}${m.closed ? " h" : ""} S`];
    }
    case "fill": {
      const [r, g, bl] = rgb(colorFor(m.color, o));
      const path = m.rings.map((ring) => ring.map((p, i) => `${n(X(p.x))} ${n(Y(p.y))} ${i ? "l" : "m"}`).join(" ") + " h").join(" ");
      return [`${n(r)} ${n(g)} ${n(bl)} rg`, `${path} f*`];
    }
    case "dot": {
      const [r, g, bl] = rgb(colorFor(m.color, o));
      const d = m.r * 2 * PT;
      return [`${n(r)} ${n(g)} ${n(bl)} rg`, `${n(X(m.p.x) - d / 2)} ${n(Y(m.p.y) - d / 2)} ${n(d)} ${n(d)} re f`];
    }
    case "text": {
      const size = (m.height / scale) * PT;
      if (size < 0.5) return [];
      const [r, g, bl] = rgb(colorFor(m.color, o));
      const c = Math.cos(m.angle);
      const s = Math.sin(m.angle);
      const step = LINE_HEIGHT * m.height;
      const ops = [`${n(r)} ${n(g)} ${n(bl)} rg`];
      textLines(m.str).forEach((line, i) => {
        const w = textWidth(line, size);
        const shift = m.align === "left" ? 0 : m.align === "center" ? -w / 2 : -w;
        const px = m.pos.x + s * step * i;
        const py = m.pos.y - c * step * i;
        ops.push(`BT /F1 ${n(size)} Tf ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(X(px))} ${n(Y(py))} Tm ${n(shift)} 0 Td ${pdfString(line)} Tj ET`);
      });
      return ops;
    }
  }
}
