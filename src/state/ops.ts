// Undoable document changes. Every edit is a Patch: a label plus a list of
// typed ops. applyOps() is the only function that changes a document; it
// updates the CadDocument (immutably) and the EntityIndex together, and is
// used for commit, undo, redo and file load alike.
import type { CadDocument, DraftingStandard, Entity, Id, Layer, Sheet, SymbolDef, TitleBlock, UnitSystem, WallEntity } from "../kernel/types";
import type { EntityIndex } from "../kernel/spatialIndex";
import type { WallSolveEntry } from "../kernel/prims";
import { type Transform2D, invert as invertT } from "../kernel/transform";
import { BUILTIN_SYMBOLS } from "../kernel/builtinSymbols";
import { solveWalls } from "../kernel/wallSolver";
import { STANDARDS, dimGeometry, geometryPrims } from "../kernel/dimensions";

export type Op =
  | { op: "add"; entity: Entity; index: number }
  | { op: "remove"; entity: Entity; index: number }
  /**
   * How dimensions attached to the entity should follow it:
   *   transform – a rigid/similarity edit (move, rotate, flip, scale): each attached point is
   *               mapped through it and re-attached at its new position.
   *   grip      – a handle drag: refs to that handle follow it; others re-attach by position.
   *   neither   – (trim, split, fillet, ...) refs re-attach where the old point still is.
   */
  | { op: "replace"; before: Entity; after: Entity; transform?: Transform2D; grip?: Grip }
  | { op: "reorder"; before: Id[]; after: Id[] }
  /** Add (before null), remove (after null) or change a layer; `index` is its position in the list. */
  | { op: "layer"; before: Layer | null; after: Layer | null; index: number }
  | { op: "layerOrder"; before: Id[]; after: Id[] }
  | { op: "symbolDef"; before: SymbolDef | null; after: SymbolDef | null; index: number }
  | { op: "activeLayer"; before: Id; after: Id }
  /** Document-wide settings (display units, drafting standard). */
  | { op: "docProps"; before: DocProps; after: DocProps };

export interface DocProps {
  units?: UnitSystem;
  standard?: DraftingStandard;
  sheet?: Sheet;
  titleBlock?: TitleBlock;
}

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
      return { op: "replace", before: o.after, after: o.before, ...(o.transform ? { transform: invertT(o.transform) } : {}), ...(o.grip ? { grip: o.grip } : {}) };
    case "reorder":
    case "layer":
    case "layerOrder":
    case "symbolDef":
    case "activeLayer":
    case "docProps":
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
  let props: DocProps = { units: doc.units, standard: doc.standard, sheet: doc.sheet, titleBlock: doc.titleBlock };
  const touchedSymbols: Id[] = [];
  let wallsTouched = false;
  let layersTouched = false;
  const own = () => {
    if (entities === doc.entities) entities = entities.slice();
  };

  for (const o of ops) {
    if ((o.op === "add" || o.op === "remove") && o.entity.kind === "wall") wallsTouched = true;
    if (o.op === "replace" && (o.before.kind === "wall" || o.after.kind === "wall")) wallsTouched = true;
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
        layersTouched = true;
        const id = (o.after ?? o.before)!.id;
        layers = layers.filter((l) => l.id !== id);
        if (o.after) layers.splice(Math.min(o.index, layers.length), 0, o.after);
        break;
      }
      case "layerOrder": {
        const byId = new Map(layers.map((l) => [l.id, l]));
        layers = o.after.map((id) => byId.get(id)!).filter(Boolean);
        break;
      }
      case "symbolDef": {
        const id = (o.after ?? o.before)!.id;
        symbols = symbols.filter((s) => s.id !== id);
        if (o.after) symbols.splice(Math.min(o.index, symbols.length), 0, o.after);
        touchedSymbols.push(id);
        break;
      }
      case "docProps":
        props = { ...props, ...o.after };
        layersTouched = true;
        break;
      case "activeLayer":
        activeLayerId = o.after;
        break;
    }
  }

  const next = {
    ...doc,
    entities,
    layers,
    symbols,
    activeLayerId,
    units: props.units ?? doc.units,
    standard: props.standard ?? doc.standard,
    sheet: props.sheet,
    titleBlock: props.titleBlock,
  };
  syncContext(next, index, { symbols: touchedSymbols, walls: wallsTouched, dims: layersTouched });
  return next;
}

/**
 * Refresh document-level geometry inputs on the index's context, one field at a
 * time (never replacing the object), and re-index what depends on them.
 *   symbols: ids of changed symbol definitions → their instances are re-indexed
 *   walls:   re-run the wall solver
 *   dims:    layer scales / units / standard changed → rebuild dimension geometry
 */
export function syncContext(doc: CadDocument, index: EntityIndex, what: { symbols?: Id[] | "all"; walls?: boolean; dims?: boolean }) {
  const ctx = (index.ctx ??= {});
  let symbolsChanged: Set<Id> | null = null;
  if (what.symbols === "all" || (what.symbols && what.symbols.length)) {
    ctx.symbols = new Map([...BUILTIN_SYMBOLS, ...doc.symbols].map((s) => [s.id, s]));
    // A change reaches every symbol that nests it, at any depth.
    const affected = new Set(what.symbols === "all" ? doc.symbols.map((s) => s.id) : what.symbols);
    for (let grew = true; grew; ) {
      grew = false;
      for (const def of doc.symbols)
        if (!affected.has(def.id) && def.entities.some((c) => c.kind === "symbol" && affected.has(c.symbolId))) {
          affected.add(def.id);
          grew = true;
        }
    }
    for (const id of affected) index.reindexSymbol(id);
    symbolsChanged = affected;
  }
  if (what.dims || !ctx.dimPrims) {
    const scales = new Map(doc.layers.map((l) => [l.id, l.scale]));
    ctx.layerScale = (id) => scales.get(id) ?? 1;
    const style = STANDARDS[doc.standard] ?? STANDARDS.ANSI;
    const units = doc.units;
    ctx.dimPrims = (e) => geometryPrims(dimGeometry(e, scales.get(e.layerId) ?? 1, style, units));
    // Annotation sizes follow the layer scale: re-index dimensions and text.
    if (what.dims) for (const e of doc.entities) if (e.kind === "dimension" || e.kind === "text") index.upsert(e);
  }
  const walls = doc.entities.filter((e): e is WallEntity => e.kind === "wall");
  if (what.walls) {
    const solved = solveWalls(walls);
    const map = new Map<Id, WallSolveEntry>();
    for (const w of walls) {
      const s = solved.get(w.id);
      if (s) map.set(w.id, { entity: w, ...s });
    }
    ctx.wallPrims = map;
  }
  // Wall boxes depend on the solve (mitres) and on door/window symbols: re-index after both.
  if (what.walls) for (const w of walls) index.upsert(w);
  else if (symbolsChanged) for (const w of walls) if (w.openings?.some((o) => o.symbolId && symbolsChanged!.has(o.symbolId))) index.upsert(w);
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

/** A handle drag: which handle, and where it was dropped. */
export interface Grip {
  handle: string;
  to: { x: number; y: number };
}

export function replacePatch(label: string, pairs: [Entity, Entity][], link: { transform?: Transform2D; grip?: Grip } = {}): Patch {
  return { label, ops: pairs.map(([before, after]) => ({ op: "replace", before, after, ...link })) };
}

/** Patch for a kernel EditResult (trim, fillet, ...). */
export function editPatch(doc: CadDocument, label: string, r: { replace: Entity[]; remove: Id[]; add: Entity[] }): Patch {
  const byId = new Map(doc.entities.map((e) => [e.id, e]));
  const ops: Op[] = [];
  for (const after of r.replace) {
    const before = byId.get(after.id);
    if (before) ops.push({ op: "replace", before, after });
  }
  ops.push(...removePatch(doc, label, r.remove).ops);
  // Adds go after removals have shrunk the list.
  const n = doc.entities.length - r.remove.filter((id) => byId.has(id)).length;
  r.add.forEach((entity, k) => ops.push({ op: "add", entity, index: n + k }));
  return { label, ops };
}
