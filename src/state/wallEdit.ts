// Door swing, from the menu or the shortcut. The swing grip does the same for one opening.
import type { Entity, WallEntity } from "../kernel/types";
import { replacePatch } from "./ops";
import { useDocumentStore } from "./useDocumentStore";

/** Toggle the swing of every opening on the selected walls. */
export function flipDoorSwings() {
  const { doc, selection } = useDocumentStore.getState();
  const pairs: [Entity, Entity][] = [];
  for (const e of doc.entities) {
    if (!selection.has(e.id) || e.kind !== "wall" || !e.openings?.length) continue;
    const after: WallEntity = { ...e, openings: e.openings.map((o) => ({ ...o, swingFlip: !o.swingFlip })) };
    pairs.push([e, after]);
  }
  if (pairs.length) useDocumentStore.getState().commit(replacePatch("Flip Door Swing", pairs));
}
