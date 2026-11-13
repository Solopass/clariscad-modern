// Pure part of in-place symbol editing: no store import, so commit() can call it.
import type { CadDocument, Entity, SymbolDef, SymbolInstanceEntity } from "../kernel/types";
import { symbolTransform } from "../kernel/prims";
import { invert } from "../kernel/transform";
import type { Op } from "./ops";
import { explodeChild } from "./symbols";

export function editingSymbol(doc: CadDocument): { defId: string; instanceId: string } | null {
  const b = doc.entities.find((e) => e.bufferOf && e.bufferInst);
  return b?.bufferOf && b.bufferInst ? { defId: b.bufferOf, instanceId: b.bufferInst } : null;
}

const strip = (e: Entity): Entity => {
  if (!e.bufferOf && !e.bufferInst) return e;
  const { bufferOf: _a, bufferInst: _b, ...rest } = e;
  return rest as Entity;
};

function roundVal(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 1e4) / 1e4;
  if (Array.isArray(v)) return v.map(roundVal);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (k !== "bufferOf" && k !== "bufferInst") o[k] = roundVal(val);
    return o;
  }
  return v;
}

function toLocal(inst: SymbolInstanceEntity, def: SymbolDef, bufs: Entity[]): Entity[] {
  const T = symbolTransform(def.origin, inst.position, inst.rotation, inst.scaleX, inst.scaleY);
  const inv = invert(T);
  return bufs.flatMap((e) => {
    const clean = strip(e);
    return explodeChild(clean, inv, 1 / inst.scaleX, 1 / inst.scaleY, -inst.rotation, () => clean.id, clean.layerId).map(strip);
  });
}

/** A symbolDef op that makes the definition match the in-place copies, or null when it already does. */
export function symbolEditOp(before: CadDocument, after: CadDocument, label: string): Op | null {
  const session = editingSymbol(before);
  if (!session) return null;
  const inst = after.entities.find((e) => e.id === session.instanceId);
  if (!inst || inst.kind !== "symbol") return null;
  const index = before.symbols.findIndex((s) => s.id === session.defId);
  const def = index >= 0 ? before.symbols[index] : undefined;
  if (!def) return null;
  const bufs = after.entities.filter((e) => e.bufferOf === session.defId && e.bufferInst === session.instanceId);
  if (!bufs.length) {
    if (label === "Finish Symbol") return null;
    if (!before.entities.some((e) => e.bufferOf === session.defId)) return null;
    return { op: "symbolDef", before: def, after: { ...def, entities: [] }, index };
  }
  const local = toLocal(inst, def, bufs);
  if (JSON.stringify(roundVal(def.entities)) === JSON.stringify(roundVal(local))) return null;
  return { op: "symbolDef", before: def, after: { ...def, entities: local }, index };
}
