// Enter and leave in-place symbol editing.
import type { Entity } from "../kernel/types";
import { symbolTransform } from "../kernel/prims";
import type { Op } from "./ops";
import { removePatch } from "./ops";
import { explodeChild, ensureSymbolOps, findSymbol } from "./symbols";
import { editingSymbol } from "./symbolEditOps";
import { newId, useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

export { editingSymbol } from "./symbolEditOps";

/** Open the selected symbol on top of its instance. */
export function enterSymbolEdit(): boolean {
  const { doc, selection } = store();
  if (editingSymbol(doc)) return false;
  const inst = doc.entities.find((e): e is Extract<Entity, { kind: "symbol" }> => selection.has(e.id) && e.kind === "symbol");
  if (!inst) return false;
  const def = findSymbol(doc, inst.symbolId);
  if (!def || !def.entities.length) return false;
  const T = symbolTransform(def.origin, inst.position, inst.rotation, inst.scaleX, inst.scaleY);
  const copies = def.entities.flatMap((e) => explodeChild(e, T, inst.scaleX, inst.scaleY, inst.rotation, newId, inst.layerId));
  const buffers = copies.map((e) => ({ ...e, bufferOf: def.id, bufferInst: inst.id }));
  const ops: Op[] = [...ensureSymbolOps(doc, def.id), ...buffers.map((entity, i) => ({ op: "add" as const, entity, index: doc.entities.length + i }))];
  store().commit({ label: "Edit Symbol", ops });
  store().setSelection(buffers.map((b) => b.id));
  return true;
}

/** Put the drawing back. The definition already holds the edits. */
export function exitSymbolEdit(): boolean {
  const doc = store().doc;
  const ids = doc.entities.filter((e) => e.bufferOf).map((e) => e.id);
  if (!ids.length) return false;
  const inst = doc.entities.find((e) => e.bufferInst)?.bufferInst;
  store().commit(removePatch(doc, "Finish Symbol", ids));
  store().setSelection(inst ? [inst] : []);
  return true;
}

export function toggleSymbolEdit(): boolean {
  return editingSymbol(store().doc) ? exitSymbolEdit() : enterSymbolEdit();
}
