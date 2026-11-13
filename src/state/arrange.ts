// Arrange menu commands on the current selection. Each is one undo step.
import type { Entity, Id } from "../kernel/types";
import type { Transform2D } from "../kernel/transform";
import { translation } from "../kernel/transform";
import { mirrorAcross, rotateAbout, scaleAbout, transformEntity } from "../kernel/edit";
import { entityBBox, unionBox } from "../kernel/prims";
import type { Vec2 } from "../kernel/vec";
import { addPatch, replacePatch, type Patch } from "./ops";
import { newId, useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

function selected(): Entity[] {
  const { doc, selection } = store();
  return doc.entities.filter((e) => selection.has(e.id));
}

/** Centre of the selection's bounding box (guides excluded). */
export function selectionCenter(): Vec2 | null {
  const { index } = store();
  let box = null;
  for (const e of selected()) {
    const b = entityBBox(e, index.ctx);
    if (b) box = box ? unionBox(box, b) : b;
  }
  return box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : null;
}

/**
 * Copies of `ents` under `T` with fresh ids. A copied dimension's refs follow
 * the copies of the entities it measures; refs to anything not copied are
 * dropped, so the copy does not snap back to the original geometry.
 */
export function copyEntities(ents: Entity[], T: Transform2D, idFn: () => Id = newId): Entity[] {
  const map = new Map<Id, Id>();
  for (const e of ents) map.set(e.id, idFn());
  return ents.map((e) => {
    const c = transformEntity(e, T);
    if (c.kind === "dimension") {
      return { ...c, id: map.get(e.id)!, refs: c.refs.map((r) => (r && map.has(r.entityId) ? { ...r, entityId: map.get(r.entityId)! } : null)) };
    }
    return { ...c, id: map.get(e.id)! };
  });
}

function commitAndSelect(p: Patch, select: Id[]) {
  if (!p.ops.length) return;
  store().commit(p);
  store().setSelection(select);
}

export function duplicate(offset: Vec2) {
  const src = selected();
  if (!src.length) return;
  const copies = copyEntities(src, translation(offset.x, offset.y));
  commitAndSelect(addPatch(store().doc, "Duplicate", copies), copies.map((e) => e.id));
}

/** `n` more copies, each `d` further along. */
export function stepAndRepeat(n: number, d: Vec2) {
  const src = selected();
  if (!src.length || n < 1) return;
  const all: Entity[] = [];
  for (let k = 1; k <= n; k++) all.push(...copyEntities(src, translation(d.x * k, d.y * k)));
  commitAndSelect(addPatch(store().doc, "Step and Repeat", all), all.map((e) => e.id));
}

/**
 * Polar array: `count` items in total (the original plus count-1 copies) spread
 * over `totalDeg` about `center`. A full 360° spreads them evenly without a
 * duplicate at the start.
 */
export function polarArray(count: number, totalDeg: number, center: Vec2) {
  const src = selected();
  if (!src.length || count < 2) return;
  const full = Math.abs(Math.abs(totalDeg) - 360) < 1e-9;
  const step = ((full ? totalDeg / count : totalDeg / (count - 1)) * Math.PI) / 180;
  const all: Entity[] = [];
  for (let k = 1; k < count; k++) all.push(...copyEntities(src, rotateAbout(center, step * k)));
  commitAndSelect(addPatch(store().doc, "Polar Array", all), all.map((e) => e.id));
}

function transformSelection(label: string, T: Transform2D) {
  const src = selected();
  if (!src.length) return;
  store().commit(
    replacePatch(
      label,
      src.map((e) => [e, transformEntity(e, T)]),
      { transform: T },
    ),
  );
}

export const rotateSelection = (deg: number, about: Vec2) => transformSelection("Rotate", rotateAbout(about, (deg * Math.PI) / 180));
export const scaleSelection = (k: number, about: Vec2) => transformSelection("Scale", scaleAbout(about, k));
/** Flip horizontal mirrors left↔right (across a vertical axis); vertical mirrors top↔bottom. */
export const flipSelection = (dir: "horizontal" | "vertical", about: Vec2) =>
  transformSelection(dir === "horizontal" ? "Flip Horizontal" : "Flip Vertical", mirrorAcross(about, dir === "horizontal" ? Math.PI / 2 : 0));

export function reorder(where: "front" | "back") {
  const { doc, selection } = store();
  if (!selection.size) return;
  const before = doc.entities.map((e) => e.id);
  const sel = before.filter((id) => selection.has(id));
  const rest = before.filter((id) => !selection.has(id));
  const after = where === "front" ? [...rest, ...sel] : [...sel, ...rest];
  if (after.every((id, i) => id === before[i])) return;
  store().commit({ label: where === "front" ? "Bring to Front" : "Send to Back", ops: [{ op: "reorder", before, after }] });
}

