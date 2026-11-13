// The title block drawn in the corner of every sheet. One layout, used by the
// on-screen page, the Plot dialog's preview, and the PDF.
import type { CadDocument, TitleBlock } from "../kernel/types";
import type { Vec2 } from "../kernel/vec";
import { activeScale } from "./sheetModel";
import { scaleLabel } from "./layers";
import { useDocumentStore } from "./useDocumentStore";

export interface TitleMark {
  /** Paper millimetres, origin at the block's lower left. */
  w: number;
  h: number;
  lines: [Vec2, Vec2][];
  texts: { pos: Vec2; str: string; h: number; align: "left" | "center" }[];
}

export function titleBlockOf(doc: CadDocument): TitleBlock {
  const t = doc.titleBlock;
  return {
    title: t?.title ?? "",
    drawnBy: t?.drawnBy ?? "",
    date: t?.date ?? "",
    scale: t?.scale ?? "",
    sheetNo: t?.sheetNo || "1",
  };
}

/** The block's lines and words, independent of where on the page it sits. */
export function titleBlockLocal(doc: CadDocument): TitleMark {
  const tb = titleBlockOf(doc);
  const scale = tb.scale || scaleLabel(activeScale(doc));
  const w = 168;
  const h = 22;
  const lines: [Vec2, Vec2][] = [
    [{ x: 0, y: 0 }, { x: w, y: 0 }],
    [{ x: w, y: 0 }, { x: w, y: h }],
    [{ x: w, y: h }, { x: 0, y: h }],
    [{ x: 0, y: h }, { x: 0, y: 0 }],
    [{ x: 0, y: 11 }, { x: w - 28, y: 11 }],
    [{ x: w - 28, y: 0 }, { x: w - 28, y: h }],
    [{ x: 56, y: 0 }, { x: 56, y: 11 }],
    [{ x: 112, y: 0 }, { x: 112, y: 11 }],
  ];
  return {
    w,
    h,
    lines,
    texts: [
      { pos: { x: 3, y: 14.2 }, str: tb.title || "Untitled", h: 4.2, align: "left" },
      { pos: { x: 2, y: 3.4 }, str: tb.drawnBy || "Drawn by", h: 2.6, align: "left" },
      { pos: { x: 58, y: 3.4 }, str: tb.date || "Date", h: 2.6, align: "left" },
      { pos: { x: 114, y: 3.4 }, str: scale, h: 2.6, align: "left" },
      { pos: { x: w - 14, y: 8 }, str: tb.sheetNo, h: 4, align: "center" },
    ],
  };
}

export function setTitleBlock(next: TitleBlock) {
  const { doc, commit } = useDocumentStore.getState();
  commit({ label: "Title Block", ops: [{ op: "docProps", before: { titleBlock: doc.titleBlock }, after: { titleBlock: next } }] });
}
