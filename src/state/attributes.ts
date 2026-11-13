// Attribute edits on the selection (pen weight, dash, colour, fill). One undo step.
import type { Entity, StyleRef } from "../kernel/types";
import { useDocumentStore } from "./useDocumentStore";
import { replacePatch } from "./ops";

export const PEN_WEIGHTS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0];
export const COLORS: [string, string][] = [
  ["", "By layer"],
  ["#000000", "Black"],
  ["#d6001c", "Red"],
  ["#0a7d32", "Green"],
  ["#1f4fd1", "Blue"],
  ["#c06000", "Orange"],
  ["#7a3db8", "Purple"],
  ["#00838f", "Cyan"],
  ["#808080", "Gray"],
];

/** Merge `changes` into the style of every selected entity (empty strings clear a field). */
export function styleSelection(changes: Partial<StyleRef>) {
  const { doc, selection, commit } = useDocumentStore.getState();
  const pairs: [Entity, Entity][] = [];
  for (const e of doc.entities) {
    if (!selection.has(e.id)) continue;
    const style: StyleRef = { ...e.style };
    for (const [k, v] of Object.entries(changes) as [keyof StyleRef, StyleRef[keyof StyleRef]][]) {
      if (v === "" || v === undefined) delete style[k];
      else (style as Record<string, unknown>)[k] = v;
    }
    const after = { ...e, style } as Entity;
    if (JSON.stringify(after.style) !== JSON.stringify(e.style)) pairs.push([e, after]);
  }
  if (pairs.length) commit(replacePatch("Change Attributes", pairs));
}
