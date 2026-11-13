// Dimension text and side, without redrawing the dimension.
import type { DimensionEntity, Entity } from "../kernel/types";
import { flipDimension } from "../kernel/dimensions";
import { replacePatch } from "./ops";
import { useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

const selectedDims = (): DimensionEntity[] => {
  const { doc, selection } = store();
  return doc.entities.filter((e): e is DimensionEntity => e.kind === "dimension" && selection.has(e.id));
};

/** Prompt for one dimension, or for every selected dimension when none is passed. Blank restores the measured value. */
export function editDimensionText(only?: DimensionEntity) {
  const dims = only ? [only] : selectedDims();
  if (!dims.length) return;
  const current = dims.length === 1 ? (dims[0].textOverride ?? "") : "";
  const text = window.prompt("Dimension text. Leave blank for the measured value. <> stands for the measurement.", current);
  if (text === null) return;
  const pairs = dims.map((d) => [d, { ...d, textOverride: text }] as [Entity, Entity]);
  store().commit(replacePatch(text === "" ? "Clear Dimension Text" : "Dimension Text", pairs));
}

/** Mirror the dimension line to the other side of what it measures. */
export function flipSelectedDimensions() {
  const pairs: [Entity, Entity][] = [];
  for (const d of selectedDims()) {
    const after = flipDimension(d);
    if (after.linePoint.x !== d.linePoint.x || after.linePoint.y !== d.linePoint.y) pairs.push([d, after]);
  }
  if (pairs.length) store().commit(replacePatch("Flip Dimension", pairs));
}
