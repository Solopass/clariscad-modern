// What a click or Select All is allowed to pick up. Locked objects and objects
// on a locked or hidden layer stay out unless Alt is held (locked objects only).
import type { CadDocument, Entity, Id } from "../kernel/types";

export function canSelect(doc: CadDocument, e: Entity, opts: { allowLocked?: boolean; filter?: string } = {}): boolean {
  if (opts.filter && opts.filter !== "all" && e.kind !== opts.filter) return false;
  if (e.locked && !opts.allowLocked) return false;
  const layer = doc.layers.find((l) => l.id === e.layerId);
  return !layer || (layer.visible && !layer.locked);
}

export function selectableIds(doc: CadDocument, opts: { allowLocked?: boolean; filter?: string } = {}): Id[] {
  return doc.entities.filter((e) => canSelect(doc, e, opts)).map((e) => e.id);
}
