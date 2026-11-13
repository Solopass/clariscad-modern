// Cut, copy and paste. The clipboard is the drawing's own entities (kept in
// this tab and in localStorage so another TemariCAD tab on the same site can
// paste them). A pasted group is a new group, not still tied to the original.
import type { Entity } from "../kernel/types";
import { translation } from "../kernel/transform";
import { removePatch } from "./ops";
import { copyEntities } from "./arrange";
import { useDocumentStore } from "./useDocumentStore";
import { useToolStore } from "./useToolStore";

const KEY = "temaricad.clip.v1";
let memory: string | null = null;

const store = () => useDocumentStore.getState();

function selected(): Entity[] {
  const { doc, selection } = store();
  return doc.entities.filter((e) => selection.has(e.id));
}

function write(entities: Entity[]) {
  const text = JSON.stringify({ format: "temaricad-clip", entities });
  memory = text;
  try {
    localStorage.setItem(KEY, text);
  } catch {
    /* private mode */
  }
  void navigator.clipboard?.writeText(text).catch(() => {});
}

function read(): Entity[] | null {
  const text = memory ?? (typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as { format?: string; entities?: Entity[] };
    if (data.format !== "temaricad-clip" || !Array.isArray(data.entities) || !data.entities.length) return null;
    return data.entities;
  } catch {
    return null;
  }
}

export function copySelection(): boolean {
  const src = selected();
  if (!src.length) return false;
  write(src);
  return true;
}

export function cutSelection(): boolean {
  const src = selected();
  if (!src.length) return false;
  write(src);
  const { doc } = store();
  store().commit(removePatch(doc, "Cut", src.map((e) => e.id)));
  store().setSelection([]);
  return true;
}

/** Paste a copy, shifted by one grid step so it doesn't sit on the original. */
export function pasteSelection(): boolean {
  const src = read();
  if (!src?.length) return false;
  const g = useToolStore.getState().settings.gridSpacing || 25.4;
  const copies = copyEntities(src, translation(g, -g));
  const { doc } = store();
  // Land on the active layer. Groups keep the ids copyEntities just assigned.
  const placed = copies.map((e) => ({ ...e, layerId: doc.activeLayerId }));
  store().commit({ label: "Paste", ops: placed.map((entity, k) => ({ op: "add" as const, entity, index: doc.entities.length + k })) });
  store().setSelection(placed.map((e) => e.id));
  return true;
}
