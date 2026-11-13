// Pure sheet geometry. Kept out of the store module so documents can be
// normalised while the store is still loading.
import type { BBox, CadDocument, Sheet } from "../kernel/types";
import { DEFAULT_SHEET } from "../kernel/types";
import { PAPER_SIZES } from "../io/plot";

function clampCount(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.max(1, Math.min(25, v));
}

/** A usable sheet. Unknown paper and out-of-range page counts fall back to the defaults. */
export function normalizeSheet(s: Partial<Sheet> | null | undefined): Sheet {
  const id = s?.paperId;
  const paperId = id && PAPER_SIZES.some((p) => p.id === id) ? id : DEFAULT_SHEET.paperId;
  return {
    paperId,
    landscape: s?.landscape !== false,
    pagesX: clampCount(s?.pagesX),
    pagesY: clampCount(s?.pagesY),
  };
}

/** Portrait width × height of the paper, in millimetres, swapped when landscape. */
export function paperMm(sheet: Sheet): { w: number; h: number } {
  const p = PAPER_SIZES.find((x) => x.id === sheet.paperId) ?? PAPER_SIZES[0];
  return sheet.landscape ? { w: Math.max(p.w, p.h), h: Math.min(p.w, p.h) } : { w: Math.min(p.w, p.h), h: Math.max(p.w, p.h) };
}

/** Model millimetres per paper millimetre for the layer new objects land on. */
export function activeScale(doc: CadDocument): number {
  const k = doc.layers.find((l) => l.id === doc.activeLayerId)?.scale;
  return k && k > 0 ? k : 1;
}

export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One rectangle per page, in model millimetres. Pages grow up and to the right from the origin. */
export function sheetPages(doc: CadDocument): PageRect[] {
  const sheet = normalizeSheet(doc.sheet);
  const paper = paperMm(sheet);
  const k = activeScale(doc);
  const w = paper.w * k;
  const h = paper.h * k;
  const pages: PageRect[] = [];
  for (let row = 0; row < sheet.pagesY; row++) for (let col = 0; col < sheet.pagesX; col++) pages.push({ x: col * w, y: row * h, w, h });
  return pages;
}

/** World box covering every page. */
export function sheetBounds(doc: CadDocument): BBox {
  const pages = sheetPages(doc);
  let maxX = 0;
  let maxY = 0;
  for (const p of pages) {
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { minX: 0, minY: 0, maxX, maxY };
}

/**
 * Screen pixels per model millimetre at which one paper inch is one CSS inch (96 px).
 * The HUD calls this 100%.
 */
export function zoomAtPaperSize(doc: CadDocument): number {
  return 96 / 25.4 / activeScale(doc);
}
