// Groups: a shared groupId, not a new kind of object. Members stay real
// entities (so dimensions, grips-after-ungroup, and snaps keep working) and
// are selected, moved and copied as one.
import type { CadDocument, Entity, Id } from "../kernel/types";
import { replacePatch } from "./ops";
import { newId, useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

/**
 * Turn a hit list into the objects that should actually be selected.
 *  click    – one member stands for the whole group
 *  crossing – any touched member pulls the group in
 *  inside   – the group joins only when every member was already hit
 */
export function expandSelection(doc: CadDocument, ids: Iterable<Id>, mode: "click" | "inside" | "crossing"): Id[] {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const byGroup = new Map<Id, Id[]>();
  for (const e of doc.entities) {
    if (!e.groupId) continue;
    const g = byGroup.get(e.groupId) ?? [];
    g.push(e.id);
    byGroup.set(e.groupId, g);
  }
  const picked = new Set(ids);
  const out = new Set<Id>();
  for (const id of picked) {
    const e = byId.get(id);
    if (!e?.groupId) {
      out.add(id);
      continue;
    }
    const members = byGroup.get(e.groupId) ?? [id];
    if (mode === "inside" && !members.every((m) => picked.has(m))) continue;
    for (const m of members) out.add(m);
  }
  return [...out];
}

/** Give the selection one group id. Two or more objects; a group inside the selection is merged in. */
export function groupSelection() {
  const { doc, selection } = store();
  const src = doc.entities.filter((e) => selection.has(e.id));
  if (src.length < 2) return;
  const gid = newId("grp");
  const pairs: [Entity, Entity][] = src.map((e) => [e, { ...e, groupId: gid }]);
  store().commit(replacePatch("Group", pairs));
  store().setSelection(src.map((e) => e.id));
}

/** Clear the groups the selection belongs to, including members that weren't clicked. */
export function ungroupSelection() {
  const { doc, selection } = store();
  const gids = new Set<Id>();
  for (const e of doc.entities) if (selection.has(e.id) && e.groupId) gids.add(e.groupId);
  if (!gids.size) return;
  const pairs: [Entity, Entity][] = [];
  const ids: Id[] = [];
  for (const e of doc.entities) {
    if (!e.groupId || !gids.has(e.groupId)) continue;
    const rest = { ...e };
    delete rest.groupId;
    pairs.push([e, rest]);
    ids.push(e.id);
  }
  store().commit(replacePatch("Ungroup", pairs));
  store().setSelection(ids);
}
