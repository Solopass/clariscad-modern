// Layer commands. Each is one undo step.
import type { Entity, Id, Layer } from "../kernel/types";
import { type Op, removePatch } from "./ops";
import { newId, useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

/** Common drawing scales: [label, model units per paper unit]. */
export const SCALE_PRESETS: [string, number][] = [
  ["1:1 (full size)", 1],
  [`3" = 1'-0"`, 4],
  [`1" = 1'-0"`, 12],
  [`1/2" = 1'-0"`, 24],
  [`1/4" = 1'-0"`, 48],
  [`1/8" = 1'-0"`, 96],
  [`1/16" = 1'-0"`, 192],
  ["1:2", 2],
  ["1:5", 5],
  ["1:10", 10],
  ["1:20", 20],
  ["1:50", 50],
  ["1:100", 100],
  ["1:200", 200],
];

export function scaleLabel(k: number): string {
  return SCALE_PRESETS.find(([, v]) => Math.abs(v - k) < 1e-9)?.[0] ?? `1:${+k.toFixed(4)}`;
}

export function addLayer(): Id {
  const { doc } = store();
  const n = doc.layers.length + 1;
  let name = `Layer ${n}`;
  for (let i = n; doc.layers.some((l) => l.name === name); i++) name = `Layer ${i + 1}`;
  const active = doc.layers.find((l) => l.id === doc.activeLayerId);
  const layer: Layer = { id: newId("layer"), name, visible: true, locked: false, scale: active?.scale ?? 48 };
  store().commit({
    label: "New Layer",
    ops: [
      { op: "layer", before: null, after: layer, index: doc.layers.length },
      { op: "activeLayer", before: doc.activeLayerId, after: layer.id },
    ],
  });
  return layer.id;
}

export function updateLayer(id: Id, changes: Partial<Omit<Layer, "id">>, label = "Change Layer") {
  const { doc } = store();
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const before = doc.layers[i];
  const after = { ...before, ...changes };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  store().commit({ label, ops: [{ op: "layer", before, after, index: i }] });
}

/** Delete a layer and everything on it. The last layer cannot be deleted. */
export function deleteLayer(id: Id): boolean {
  const { doc } = store();
  if (doc.layers.length <= 1) return false;
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return false;
  const ops: Op[] = [];
  const doomed = doc.entities.filter((e) => e.layerId === id).map((e) => e.id);
  ops.push(...removePatch(doc, "", doomed).ops);
  if (doc.activeLayerId === id) {
    const next = doc.layers[i === 0 ? 1 : i - 1];
    ops.push({ op: "activeLayer", before: id, after: next.id });
  }
  ops.push({ op: "layer", before: doc.layers[i], after: null, index: i });
  store().commit({ label: "Delete Layer", ops });
  return true;
}

export function setActiveLayer(id: Id) {
  const { doc } = store();
  if (doc.activeLayerId === id || !doc.layers.some((l) => l.id === id)) return;
  store().commit({ label: "Set Active Layer", ops: [{ op: "activeLayer", before: doc.activeLayerId, after: id }] });
}

export function moveLayer(id: Id, delta: -1 | 1) {
  const { doc } = store();
  const before = doc.layers.map((l) => l.id);
  const i = before.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= before.length) return;
  const after = before.slice();
  [after[i], after[j]] = [after[j], after[i]];
  store().commit({ label: "Reorder Layers", ops: [{ op: "layerOrder", before, after }] });
}

export function moveSelectionToLayer(id: Id) {
  const { doc, selection } = store();
  const ops: Op[] = [];
  for (const e of doc.entities)
    if (selection.has(e.id) && e.layerId !== id) ops.push({ op: "replace", before: e, after: { ...e, layerId: id } as Entity });
  if (ops.length) store().commit({ label: "Move to Layer", ops });
}
