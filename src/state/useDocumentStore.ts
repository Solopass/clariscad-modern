// The open drawing: document, selection, undo/redo. The EntityIndex is a
// mutable object kept outside reactive state; `version` bumps on every
// change so views know to redraw.
import { create } from "zustand";
import { DOCUMENT_VERSION, type CadDocument, type Id, type Layer, type UnitSystem } from "../kernel/types";
import { EntityIndex } from "../kernel/spatialIndex";
import { type Patch, applyOps, invert } from "./ops";

export function newDocument(): CadDocument {
  const layer: Layer = { id: "layer-1", name: "Layer 1", visible: true, locked: false, scale: 1 };
  return {
    version: DOCUMENT_VERSION,
    units: "architectural",
    standard: "ANSI",
    layers: [layer],
    activeLayerId: layer.id,
    entities: [],
    symbols: [],
  };
}

const symbolMap = (doc: CadDocument) => ({ symbols: new Map(doc.symbols.map((s) => [s.id, s])) });

let counter = 0;
/** Unique, sortable entity id. */
export const newId = (prefix = "e") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

const UNDO_LIMIT = 500;

export interface DocumentState {
  doc: CadDocument;
  index: EntityIndex;
  version: number;
  selection: ReadonlySet<Id>;
  undoStack: Patch[];
  redoStack: Patch[];
  /** Apply and record a patch. Empty patches are ignored. */
  commit(p: Patch): void;
  undo(): void;
  redo(): void;
  load(doc: CadDocument): void;
  setSelection(ids: Iterable<Id>): void;
  /** Display units (a preference, not an undoable edit). */
  setUnits(u: UnitSystem): void;
}

export const useDocumentStore = create<DocumentState>((set, get) => {
  const doc = newDocument();
  return {
    doc,
    index: new EntityIndex([], symbolMap(doc)),
    version: 0,
    selection: new Set(),
    undoStack: [],
    redoStack: [],

    commit(p) {
      if (!p.ops.length) return;
      const s = get();
      const next = applyOps(s.doc, s.index, p.ops);
      const undoStack = [...s.undoStack, p].slice(-UNDO_LIMIT);
      set({ doc: next, version: s.version + 1, undoStack, redoStack: [], selection: pruneSelection(s.selection, s.index) });
    },

    undo() {
      const s = get();
      const p = s.undoStack[s.undoStack.length - 1];
      if (!p) return;
      const next = applyOps(s.doc, s.index, invert(p).ops);
      set({ doc: next, version: s.version + 1, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, p], selection: pruneSelection(s.selection, s.index) });
    },

    redo() {
      const s = get();
      const p = s.redoStack[s.redoStack.length - 1];
      if (!p) return;
      const next = applyOps(s.doc, s.index, p.ops);
      set({ doc: next, version: s.version + 1, undoStack: [...s.undoStack, p], redoStack: s.redoStack.slice(0, -1), selection: pruneSelection(s.selection, s.index) });
    },

    load(doc) {
      set({ doc, index: new EntityIndex(doc.entities, symbolMap(doc)), version: get().version + 1, undoStack: [], redoStack: [], selection: new Set() });
    },

    setSelection(ids) {
      set({ selection: new Set(ids) });
    },

    setUnits(units) {
      set((s) => ({ doc: { ...s.doc, units }, version: s.version + 1 }));
    },
  };
});

function pruneSelection(sel: ReadonlySet<Id>, index: EntityIndex): ReadonlySet<Id> {
  let changed = false;
  const out = new Set<Id>();
  for (const id of sel) {
    if (index.get(id)) out.add(id);
    else changed = true;
  }
  return changed ? out : sel;
}
