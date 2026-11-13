// Undoable change of the sheet and the active layer's ruler scale.
import type { Sheet } from "../kernel/types";
import type { Op } from "./ops";
import { normalizeSheet } from "./sheetModel";
import { useDocumentStore } from "./useDocumentStore";

/** Undoable change of the sheet and, when `scale` is given, the active layer's ruler. Then frame the pages. */
export function applySheet(sheet: Sheet, scale?: number) {
  const { doc } = useDocumentStore.getState();
  const ops: Op[] = [];
  const next = normalizeSheet(sheet);
  if (JSON.stringify(next) !== JSON.stringify(normalizeSheet(doc.sheet))) {
    ops.push({ op: "docProps", before: { sheet: doc.sheet }, after: { sheet: next } });
  }
  if (scale !== undefined && scale > 0) {
    const i = doc.layers.findIndex((l) => l.id === doc.activeLayerId);
    if (i >= 0 && doc.layers[i].scale !== scale) {
      ops.push({ op: "layer", before: doc.layers[i], after: { ...doc.layers[i], scale }, index: i });
    }
  }
  if (ops.length) useDocumentStore.getState().commit({ label: "Rulers & Drawing Size", ops });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("temaricad:fit-sheet"));
}
