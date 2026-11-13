// Groups nest. Each object carries `groups`, outermost first: a click selects
// everyone who shares groups[0], and Ungroup peels only that outer id so the
// groups inside it remain.
import type { Entity, Id } from "../kernel/types";
import { replacePatch } from "./ops";
import { newId, useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

export const membership = (e: Entity): Id[] => e.groups ?? [];
export const outerGroup = (e: Entity): Id | undefined => e.groups?.[0];

/**
 * Turn a hit list into the objects that should actually be selected.
 *  click    – one member stands for the outermost group
 *  crossing – any touched member pulls that group in
 *  inside   – the group joins only when every member was already hit
 */
export function expandSelection(doc: { entities: Entity[] }, ids: Iterable<Id>, mode: "click" | "inside" | "crossing"): Id[] {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const byOuter = new Map<Id, Id[]>();
  for (const e of doc.entities) {
    const g = outerGroup(e);
    if (!g) continue;
    const list = byOuter.get(g) ?? [];
    list.push(e.id);
    byOuter.set(g, list);
  }
  const picked = new Set(ids);
  const out = new Set<Id>();
  for (const id of picked) {
    const e = byId.get(id);
    const g = e && outerGroup(e);
    if (!e || !g) {
      out.add(id);
      continue;
    }
    const members = byOuter.get(g) ?? [id];
    if (mode === "inside" && !members.every((m) => picked.has(m))) continue;
    for (const m of members) out.add(m);
  }
  return [...out];
}

/** Wrap the selection in a new outer group. Objects already grouped stay grouped inside it. */
export function groupSelection() {
  const { doc, selection } = store();
  const src = doc.entities.filter((e) => selection.has(e.id));
  if (src.length < 2) return;
  const gid = newId("grp");
  const pairs: [Entity, Entity][] = src.map((e) => [e, { ...e, groups: [gid, ...membership(e)] }]);
  store().commit(replacePatch("Group", pairs));
  store().setSelection(src.map((e) => e.id));
}

/** Peel one level. Nested groups underneath become the new outer groups. */
export function ungroupSelection() {
  const { doc, selection } = store();
  const outers = new Set<Id>();
  for (const e of doc.entities) {
    const g = outerGroup(e);
    if (selection.has(e.id) && g) outers.add(g);
  }
  if (!outers.size) return;
  const pairs: [Entity, Entity][] = [];
  const ids: Id[] = [];
  for (const e of doc.entities) {
    const g = outerGroup(e);
    if (!g || !outers.has(g)) continue;
    const rest = e.groups!.slice(1);
    const after: Entity = { ...e };
    if (rest.length) after.groups = rest;
    else delete after.groups;
    pairs.push([e, after]);
    ids.push(e.id);
  }
  store().commit(replacePatch("Ungroup", pairs));
  store().setSelection(ids);
}

/** Lock the selection. Locked objects stay visible and snappable. */
export function lockSelection() {
  const { doc, selection } = store();
  const pairs: [Entity, Entity][] = [];
  for (const e of doc.entities) if (selection.has(e.id) && !e.locked) pairs.push([e, { ...e, locked: true }]);
  if (pairs.length) {
    store().commit(replacePatch("Lock", pairs));
    store().setSelection([]);
  }
}

/** Unlock the selection, or every locked object when none of the selection is locked. */
export function unlockSelection() {
  const { doc, selection } = store();
  const chosen = doc.entities.filter((e) => selection.has(e.id) && e.locked);
  const targets = chosen.length ? chosen : doc.entities.filter((e) => e.locked);
  const pairs: [Entity, Entity][] = targets.map((e) => {
    const after = { ...e };
    delete after.locked;
    return [e, after];
  });
  if (!pairs.length) return;
  store().commit(replacePatch("Unlock", pairs));
  store().setSelection(targets.map((e) => e.id));
}
