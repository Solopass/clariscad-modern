// Associativity: before a patch is recorded, add replace ops that keep
// dimensions attached to the geometry the patch changes. Runs once in
// commit(); undo/redo just invert the recorded patch.
import type { CadDocument, DimRef, DimensionEntity, Entity, Id } from "../kernel/types";
import { handleAt, resolveHandle } from "../kernel/handles";
import { relocateLinePoint } from "../kernel/dimensions";
import { type Transform2D, apply, applyDir } from "../kernel/transform";
import { type Vec2, dist } from "../kernel/vec";
import type { Grip, Op, Patch } from "./ops";

const MATCH_TOL = 1e-6;

interface Change {
  after: Entity;
  transform?: Transform2D;
  grip?: Grip;
}

export function withDependents(doc: CadDocument, patch: Patch): Patch {
  const replaced = new Map<Id, Change>();
  const removed = new Set<Id>();
  const added: Entity[] = [];
  const dimAfter = new Map<Id, DimensionEntity>();
  for (const o of patch.ops) {
    if (o.op === "replace") {
      replaced.set(o.after.id, { after: o.after, transform: o.transform, grip: o.grip });
      if (o.after.kind === "dimension") dimAfter.set(o.after.id, o.after);
    } else if (o.op === "remove") removed.add(o.entity.id);
    else if (o.op === "add") added.push(o.entity);
  }
  if (!replaced.size && !removed.size) return patch;

  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const changed = (id: Id) => replaced.has(id) || removed.has(id);
  const extra: Op[] = [];
  const merged = new Set<Id>();

  for (const orig of doc.entities) {
    if (orig.kind !== "dimension" || removed.has(orig.id)) continue;
    const movedItself = dimAfter.has(orig.id);
    const touches = orig.refs.some((r) => r && changed(r.entityId));
    if (!touches && !movedItself) continue;
    const basis = dimAfter.get(orig.id) ?? orig;
    const points = basis.points.slice();
    const refs: (DimRef | null)[] = basis.refs.slice();
    let dirty = false;

    basis.refs.forEach((ref, i) => {
      if (!ref) return;
      const target = byId.get(ref.entityId);
      if (!changed(ref.entityId)) {
        // The dimension moved but what it measures did not: it is no longer attached there.
        const p = target && resolveHandle(target, ref.handle);
        if (!p || dist(p, points[i]) > MATCH_TOL) {
          refs[i] = null;
          dirty = true;
        }
        return;
      }
      const oldPt: Vec2 = (target && resolveHandle(target, ref.handle)) ?? orig.points[i];
      const r = replaced.get(ref.entityId);
      let want = oldPt;
      if (r?.transform) want = apply(r.transform, oldPt);
      else if (r?.grip && r.grip.handle === ref.handle) {
        // The dragged handle: whatever handle now sits at the drop point (a rectangle corner
        // dragged past its opposite corner gets a different name), else the same name.
        const name = handleAt(r.after, r.grip.to, 1e-6) ?? ref.handle;
        const p = resolveHandle(r.after, name);
        if (p) {
          refs[i] = { entityId: ref.entityId, handle: name };
          points[i] = p;
          dirty = true;
          return;
        }
      }
      // Re-attach at the (mapped) position on the result pieces.
      for (const cand of [...(r ? [r.after] : []), ...added]) {
        const name = handleAt(cand, want, MATCH_TOL * Math.max(1, Math.hypot(want.x, want.y) * 1e-6));
        if (name) {
          refs[i] = { entityId: cand.id, handle: name };
          points[i] = resolveHandle(cand, name)!;
          dirty = true;
          return;
        }
      }
      // Nothing left there: keep the point, drop the link.
      refs[i] = null;
      points[i] = oldPt;
      dirty = true;
    });
    if (!dirty) continue;
    // If everything it measures went through one transform (and the dimension itself did
    // not move), the dimension line goes through it too — mirrors keep their side.
    const Ts = basis.refs.map((r) => (r ? replaced.get(r.entityId)?.transform : undefined));
    const oneT = !movedItself && Ts.length > 0 && Ts.every((t) => t && t === Ts[0]) ? Ts[0] : undefined;
    const linePoint = oneT ? apply(oneT, basis.linePoint) : relocateLinePoint(basis, points);
    // A dragged text offset is in model space. A rigid move of the measured geometry
    // rotates that offset with it; the link to the geometry stays.
    const textShift = basis.textShift && oneT ? applyDir(oneT, basis.textShift) : basis.textShift;
    const after: DimensionEntity = textShift ? { ...basis, points, refs, linePoint, textShift } : { ...basis, points, refs, linePoint };
    extra.push({ op: "replace", before: orig, after });
    merged.add(orig.id);
  }
  if (!extra.length) return patch;
  const ops = patch.ops.filter((o) => !(o.op === "replace" && merged.has(o.after.id)));
  return { label: patch.label, ops: [...ops, ...extra] };
}
