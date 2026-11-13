// The open drawing: document, selection, undo/redo. The EntityIndex is a
// mutable object kept outside reactive state; `version` bumps on every
// change so views know to redraw.
import { create } from "zustand";
import { DEFAULT_SHEET, DOCUMENT_VERSION, type CadDocument, type DraftingStandard, type Id, type Layer, type UnitSystem } from "../kernel/types";
import { normalizeSheet } from "./sheetModel";
import { EntityIndex } from "../kernel/spatialIndex";
import { type Patch, applyOps, invert, syncContext } from "./ops";
import { withDependents } from "./dependents";

export function newDocument(): CadDocument {
  const layer: Layer = { id: "layer-1", name: "Layer 1", visible: true, locked: false, scale: 48 };
  return {
    version: DOCUMENT_VERSION,
    units: "architectural",
    standard: "ANSI",
    layers: [layer],
    activeLayerId: layer.id,
    entities: [],
    symbols: [],
    sheet: DEFAULT_SHEET,
  };
}

/** Fresh index with its geometry context (symbols, wall solve, dimension geometry) in place. */
export function buildIndex(doc: CadDocument): EntityIndex {
  const index = new EntityIndex([], {});
  syncContext(doc, index, { symbols: "all", walls: true, dims: true });
  for (const e of doc.entities) index.upsert(e);
  return index;
}

let counter = 0;
/** Unique, sortable entity id. */
export const newId = (prefix = "e") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

const UNDO_LIMIT = 500;

/** Marker for "has never matched any undo state" (a restored, unsaved drawing). */
export const NEVER_SAVED = Symbol("never-saved");

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
  /** Replace the drawing. `dirty` marks it unsaved (e.g. a restored recovery copy). */
  load(doc: CadDocument, file?: { name?: string; path?: string | null; dirty?: boolean }): void;
  setSelection(ids: Iterable<Id>): void;
  /** File name shown in the title ("Untitled" until saved). */
  fileName: string;
  /** Where the drawing was opened from / saved to (desktop path, or null). */
  filePath: string | null;
  /**
   * The undo-stack top when the drawing was last saved (null = saved/new with nothing
   * done). Unsaved = the current top is a different patch, so undoing back to the
   * saved state counts as clean again.
   */
  savedTop: Patch | null | typeof NEVER_SAVED;
  markSaved(file: { name: string; path?: string | null }): void;
  isDirty(): boolean;
  /** Display units (undoable). */
  setUnits(u: UnitSystem): void;
  /** Drafting standard for dimensions (undoable). */
  setStandard(s: DraftingStandard): void;
}

export const useDocumentStore = create<DocumentState>((set, get) => {
  const doc = newDocument();
  return {
    doc,
    index: buildIndex(doc),
    version: 0,
    selection: new Set(),
    undoStack: [],
    redoStack: [],
    fileName: "Untitled",
    filePath: null,
    savedTop: null,

    markSaved(file) {
      set({ fileName: file.name, filePath: file.path ?? get().filePath, savedTop: get().undoStack.at(-1) ?? null });
    },

    isDirty() {
      const s = get();
      return (s.undoStack.at(-1) ?? null) !== s.savedTop;
    },

    commit(p) {
      if (!p.ops.length) return;
      const s = get();
      // Associated dimensions follow in the same undo step.
      const full = withDependents(s.doc, p);
      const next = applyOps(s.doc, s.index, full.ops);
      const undoStack = [...s.undoStack, full].slice(-UNDO_LIMIT);
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

    load(doc, file = {}) {
      const next = { ...doc, sheet: normalizeSheet(doc.sheet) };
      set({
        doc: next,
        index: buildIndex(next),
        version: get().version + 1,
        undoStack: [],
        redoStack: [],
        selection: new Set(),
        fileName: file.name ?? "Untitled",
        filePath: file.path ?? null,
        savedTop: file.dirty ? NEVER_SAVED : null,
      });
      try {
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("temaricad:fit"));
      } catch {
        /* no window in tests */
      }
    },

    setSelection(ids) {
      set({ selection: new Set(ids) });
    },

    setUnits(units) {
      const d = get().doc;
      if (d.units !== units) get().commit({ label: "Change Units", ops: [{ op: "docProps", before: { units: d.units }, after: { units } }] });
    },

    setStandard(standard) {
      const d = get().doc;
      if (d.standard !== standard) get().commit({ label: "Change Standard", ops: [{ op: "docProps", before: { standard: d.standard }, after: { standard } }] });
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
