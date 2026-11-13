// Undoable document changes. Every edit is a Patch: a label plus a list of
// typed ops. applyOps() is the only function that changes a document; it
// updates the CadDocument (immutably) and the EntityIndex together, and is
// used for commit, undo, redo and file load alike.
import type { CadDocument, Entity, Id, Layer, SymbolDef } from "../kernel/types";
import type { EntityIndex } from "../kernel/spatialIndex";

export type Op =
  | { op: "add"; entity: Entity; index: number }
  | { op: "remove"; entity: Entity; index: number }
  | { op: "replace"; before: Entity; after: Entity }
  | { op: "reorder"; before: Id[]; after: Id[] }
  | { op: "layer"; before: Layer | null; after: Layer | null }
  | { op: "symbolDef"; before: SymbolDef | null; after: SymbolDef | null }
  | { op: "activeLayer"; before: Id; after: Id };

export interface Patch {
  label: string;
  ops: Op[];
}

function invertOp(o: Op): Op {
  switch (o.op) {
    case "add":
      return { op: "remove", entity: o.entity, index: o.index };
    case "remove":
      return { op: "add", entity: o.entity, index: o.index };
    case "replace":
      return { op: "replace", before: o.after, after: o.before };
    case "reorder":
    case "layer":
    case "symbolDef":
    case "activeLayer":
      return { ...o, before: o.after, after: o.before } as Op;
  }
}

export const invert = (p: Patch): Patch => ({ label: p.label, ops: p.ops.map(invertOp).reverse() });

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/** Freeze committed entities in development so accidental in-place edits throw. */
const FREEZE = (import.meta as { env?: { PROD?: boolean } }).env?.PROD !== true;

/** Apply ops in order. Returns the new document; mutates `index` to match. */
export function applyOps(doc: CadDocument, index: EntityIndex, ops: Op[]): CadDocument {
  let entities = doc.entities;
  let layers = doc.layers;
  let symbols = doc.symbols;
  let activeLayerId = doc.activeLayerId;
  const touchedSymbols: Id[] = [];
  const own = () => {
    if (entities === doc.entities) entities = entities.slice();
  };

  for (const o of ops) {
    switch (o.op) {
      case "add": {
        own();
        if (FREEZE) deepFreeze(o.entity);
        entities.splice(Math.min(o.index, entities.length), 0, o.entity);
        index.upsert(o.entity);
        break;
      }
      case "remove": {
        own();
        const i = entities[o.index]?.id === o.entity.id ? o.index : entities.findIndex((e) => e.id === o.entity.id);
        if (i < 0) throw new Error(`remove: entity ${o.entity.id} not found`);
        entities.splice(i, 1);
        index.remove(o.entity.id);
        break;
      }
      case "replace": {
        own();
        const i = entities.findIndex((e) => e.id === o.before.id);
        if (i < 0) throw new Error(`replace: entity ${o.before.id} not found`);
        if (FREEZE) deepFreeze(o.after);
        entities[i] = o.after;
        index.upsert(o.after);
        break;
      }
      case "reorder": {
        const byId = new Map(entities.map((e) => [e.id, e]));
        entities = o.after.map((id) => {
          const e = byId.get(id);
          if (!e) throw new Error(`reorder: entity ${id} not found`);
          return e;
        });
        break;
      }
      case "layer": {
        const id = (o.after ?? o.before)!.id;
        layers = layers.filter((l) => l.id !== id);
        if (o.after) {
          const at = doc.layers.findIndex((l) => l.id === id);
          layers.splice(at < 0 ? layers.length : at, 0, o.after);
        }
        break;
      }
      case "symbolDef": {
        const id = (o.after ?? o.before)!.id;
        symbols = symbols.filter((s) => s.id !== id);
        if (o.after) symbols.push(o.after);
        touchedSymbols.push(id);
        break;
      }
      case "activeLayer":
        activeLayerId = o.after;
        break;
    }
  }

  if (touchedSymbols.length) {
    const map = new Map(symbols.map((s) => [s.id, s]));
    index.ctx = { symbols: map };
    for (const id of touchedSymbols) index.reindexSymbol(id);
  }
  return { ...doc, entities, layers, symbols, activeLayerId };
}

// ---------------------------------------------------------------- patch builders

export function addPatch(doc: CadDocument, label: string, entities: Entity[]): Patch {
  const n = doc.entities.length;
  return { label, ops: entities.map((entity, k) => ({ op: "add", entity, index: n + k })) };
}

/** Remove by id; ops run from the highest index down so each recorded index is exact. */
export function removePatch(doc: CadDocument, label: string, ids: Iterable<Id>): Patch {
  const want = new Set(ids);
  const ops: Op[] = [];
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    const e = doc.entities[i];
    if (want.has(e.id)) ops.push({ op: "remove", entity: e, index: i });
  }
  return { label, ops };
}

export function replacePatch(label: string, pairs: [Entity, Entity][]): Patch {
  return { label, ops: pairs.map(([before, after]) => ({ op: "replace", before, after })) };
}
