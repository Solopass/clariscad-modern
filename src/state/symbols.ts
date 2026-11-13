// Symbols: make, explode, place, import/export, and the built-in starter set.
import type { CadDocument, Entity, Id, SymbolDef, WallEntity } from "../kernel/types";
import { entityBBox, symbolTransform, toPrims, unionBox, flattenPrim } from "../kernel/prims";
import { similarityOf, transformEntity, uprightText } from "../kernel/edit";
import { apply, multiply, type Transform2D } from "../kernel/transform";
import { fitOpening, wallParam } from "../kernel/wallSolver";
import { type Vec2, cross, dist, normAngle, sub } from "../kernel/vec";
import { BUILTIN_SYMBOLS } from "../kernel/builtinSymbols";

export { BUILTIN_SYMBOLS };
import { type Op, type Patch, removePatch } from "./ops";
import { newId, useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

/** A symbol by id: from the drawing, else the built-in set. */
export function findSymbol(doc: CadDocument, id: Id): SymbolDef | undefined {
  return doc.symbols.find((s) => s.id === id) ?? BUILTIN_SYMBOLS.find((s) => s.id === id);
}

/** Ops that copy a built-in (and anything it nests) into the drawing if it is not there yet. */
export function ensureSymbolOps(doc: CadDocument, id: Id): Op[] {
  const ops: Op[] = [];
  const have = new Set(doc.symbols.map((s) => s.id));
  const visit = (sid: Id) => {
    if (have.has(sid)) return;
    const def = BUILTIN_SYMBOLS.find((s) => s.id === sid);
    if (!def) return;
    have.add(sid);
    for (const c of def.entities) if (c.kind === "symbol") visit(c.symbolId);
    ops.push({ op: "symbolDef", before: null, after: def, index: doc.symbols.length + ops.length });
  };
  visit(id);
  return ops;
}

// ---------------------------------------------------------------- make / explode

/** Turn the selection (dimensions excluded) into a symbol and replace it with one instance. */
export function makeSymbol(name: string): Id | null {
  const { doc, selection, index } = store();
  const picked = doc.entities.filter((e) => selection.has(e.id) && e.kind !== "dimension" && e.kind !== "guide");
  if (!picked.length) return null;
  let box = null;
  for (const e of picked) {
    const b = entityBBox(e, index.ctx);
    if (b) box = box ? unionBox(box, b) : b;
  }
  if (!box) return null;
  const origin = { x: box.minX, y: box.minY };
  const def: SymbolDef = { id: newId("sym"), name, origin, entities: picked.map((e) => ({ ...e, id: newId("c") })) };
  const inst: Entity = { id: newId(), layerId: doc.activeLayerId, kind: "symbol", symbolId: def.id, position: origin, rotation: 0, scaleX: 1, scaleY: 1 };
  const rem = removePatch(
    doc,
    "",
    picked.map((e) => e.id),
  ).ops;
  const ops: Op[] = [{ op: "symbolDef", before: null, after: def, index: doc.symbols.length }, ...rem, { op: "add", entity: inst, index: doc.entities.length - rem.length }];
  store().commit({ label: "Make Symbol", ops });
  store().setSelection([inst.id]);
  return def.id;
}

/**
 * A child entity under a possibly non-uniform placement transform (one level of
 * explode). Nested symbols stay symbols under similarity transforms and are
 * exploded recursively otherwise.
 */
export function explodeChild(child: Entity, T: Transform2D, sx: number, sy: number, rot: number, idFn: () => Id, layerId: Id, depth = 0): Entity[] {
  let isSim = true;
  try {
    similarityOf(T);
  } catch {
    isSim = false;
  }
  const id = idFn();
  if (isSim) return [{ ...transformEntity(child, T), id, layerId }];
  const m = (p: Vec2) => apply(T, p);
  switch (child.kind) {
    case "symbol": {
      const def = findSymbol(store().doc, child.symbolId);
      if (!def || depth > 8) return [];
      const inner = multiply(T, symbolTransform(def.origin, child.position, child.rotation, child.scaleX, child.scaleY));
      return def.entities.flatMap((c) => explodeChild(c, inner, sx * child.scaleX, sy * child.scaleY, rot + child.rotation, idFn, layerId, depth + 1));
    }
    case "wall":
      // Bands keep their width as the geometric mean of the two scales.
      return [{ ...child, id, layerId, a: m(child.a), b: m(child.b), thickness: child.thickness * Math.sqrt(Math.abs(sx * sy)), openings: undefined }];
    case "doubleLine":
      return [{ ...child, id, layerId, a: m(child.a), b: m(child.b), width: child.width * Math.sqrt(Math.abs(sx * sy)) }];
    case "text": {
      const dir = { x: Math.cos(child.rotation), y: Math.sin(child.rotation) };
      const md = { x: T.a * dir.x + T.c * dir.y, y: T.b * dir.x + T.d * dir.y };
      const up = sx * sy < 0 ? uprightText(Math.atan2(md.y, md.x), child.align) : { rotation: Math.atan2(md.y, md.x), align: child.align };
      return [{ ...child, id, layerId, position: m(child.position), rotation: up.rotation, align: up.align, height: child.height * Math.sqrt(Math.abs(sx * sy)) }];
    }
    case "line":
      return [{ ...child, id, layerId, a: m(child.a), b: m(child.b) }];
    case "polygon":
    case "spline":
      return [{ ...child, id, layerId, points: child.points.map(m) }];
    case "polyline":
      if (!child.bulges?.some((b) => b !== 0)) return [{ ...child, id, layerId, points: child.points.map(m) }];
      break;
    case "circle":
      return [{ id, layerId, style: child.style, kind: "ellipse", center: m(child.center), rx: child.r * Math.abs(sx), ry: child.r * Math.abs(sy), rotation: rot }];
    case "arc": {
      // Scaling (sx, sy) in the symbol's frame turns a circular arc into an elliptical one;
      // a mirror in one axis reverses its direction.
      const map = (u: number) => Math.atan2(Math.sign(sy) * Math.sin(u), Math.sign(sx) * Math.cos(u));
      let s = map(child.start);
      let e = map(child.end);
      if (sx * sy < 0) [s, e] = [e, s];
      return [{ id, layerId, style: child.style, kind: "ellipse", center: m(child.center), rx: child.r * Math.abs(sx), ry: child.r * Math.abs(sy), rotation: rot, start: normAngle(s), end: normAngle(e) }];
    }
  }
  // Anything else (ellipses, bulged polylines, rects...): each primitive as a mapped polyline.
  const out: Entity[] = [];
  for (const p of toPrims(child, store().index.ctx)) {
    const pts: Vec2[] = [];
    for (const q of flattenPrim(p, 1).pts) {
      const mq = m(q);
      if (!pts.length || dist(pts[pts.length - 1], mq) > 1e-9) pts.push(mq);
    }
    if (pts.length < 2) continue;
    const closed = pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6;
    out.push({ id: out.length ? idFn() : id, layerId, style: child.style, kind: "polyline", points: closed ? pts.slice(0, -1) : pts, closed });
  }
  return out;
}

/** Replace selected symbol instances with their (transformed) contents. */
export function explodeSelection() {
  const { doc, selection } = store();
  const insts = doc.entities.filter((e): e is Extract<Entity, { kind: "symbol" }> => selection.has(e.id) && e.kind === "symbol");
  if (!insts.length) return;
  const added: Entity[] = [];
  for (const inst of insts) {
    const def = findSymbol(doc, inst.symbolId);
    if (!def) continue;
    const T = symbolTransform(def.origin, inst.position, inst.rotation, inst.scaleX, inst.scaleY);
    for (const c of def.entities) added.push(...explodeChild(c, T, inst.scaleX, inst.scaleY, inst.rotation, () => newId(), inst.layerId));
  }
  const rem = removePatch(
    doc,
    "",
    insts.map((e) => e.id),
  ).ops;
  const n = doc.entities.length - rem.length;
  store().commit({ label: "Explode", ops: [...rem, ...added.map((entity, k) => ({ op: "add" as const, entity, index: n + k }))] });
  store().setSelection(added.map((e) => e.id));
}

// ---------------------------------------------------------------- placing

/**
 * Patch that places symbol `id` at `p`. Door/window symbols clicked on a wall go into
 * a new opening there instead (hinge side and swing side from where the click is).
 */
export function placeSymbolPatch(doc: CadDocument, id: Id, p: Vec2, scaleK: number, rotDeg: number, wall: WallEntity | null, layerId: Id): Patch | null {
  const def = findSymbol(doc, id);
  if (!def) return null;
  const ops = ensureSymbolOps(doc, id);
  if (def.opening && wall) {
    const len = dist(wall.a, wall.b);
    const width = def.opening.width * scaleK;
    const along = wallParam(wall, p);
    const at = fitOpening(wall, along, width);
    if (at === null) return null;
    const d = sub(wall.b, wall.a);
    // Swing toward the side that was clicked; hinge at the nearer end of the wall.
    const swingFlip = cross(d, sub(p, wall.a)) < 0;
    const hingeFlip = along > len / 2;
    const after: WallEntity = { ...wall, openings: [...(wall.openings ?? []), { id: newId("op"), at, width, symbolId: id, hingeFlip, swingFlip }] };
    ops.push({ op: "replace", before: wall, after });
    return { label: `Place ${def.name}`, ops };
  }
  const inst: Entity = { id: newId(), layerId, kind: "symbol", symbolId: id, position: p, rotation: (rotDeg * Math.PI) / 180, scaleX: scaleK, scaleY: scaleK };
  ops.push({ op: "add", entity: inst, index: doc.entities.length });
  return { label: `Place ${def.name}`, ops };
}

// ---------------------------------------------------------------- library files

export interface SymbolLibraryFile {
  format: "tcsym";
  version: 1;
  symbols: SymbolDef[];
}

export function exportLibrary(defs: SymbolDef[]): string {
  const file: SymbolLibraryFile = { format: "tcsym", version: 1, symbols: defs };
  return JSON.stringify(file, null, 2);
}

const sameContent = (a: SymbolDef, b: SymbolDef) => JSON.stringify({ ...a, id: "" }) === JSON.stringify({ ...b, id: "" });

/**
 * Ops that add a library's symbols. Identical symbols already present are reused;
 * id clashes with different content get fresh ids, and nested references follow.
 */
export function importLibraryOps(doc: CadDocument, text: string): { ops: Op[]; added: number } {
  const file = JSON.parse(text) as Partial<SymbolLibraryFile>;
  if (file.format !== "tcsym" || !Array.isArray(file.symbols)) throw new Error("Not a TemariCad symbol library (.tcsym)");
  const existing = new Map(doc.symbols.map((s) => [s.id, s]));
  const remap = new Map<Id, Id>();
  const fresh: SymbolDef[] = [];
  for (const def of file.symbols) {
    // Reuse any symbol already in the drawing with the same content, whatever its id.
    const same = [...existing.values()].find((s) => sameContent(s, def));
    if (same) {
      remap.set(def.id, same.id);
      continue;
    }
    const id = existing.has(def.id) ? newId("sym") : def.id;
    remap.set(def.id, id);
    fresh.push({ ...def, id });
  }
  const fix = (e: Entity): Entity => {
    if (e.kind === "symbol") return { ...e, symbolId: remap.get(e.symbolId) ?? e.symbolId };
    if (e.kind === "wall" && e.openings) return { ...e, openings: e.openings.map((o) => (o.symbolId ? { ...o, symbolId: remap.get(o.symbolId) ?? o.symbolId } : o)) };
    return e;
  };
  const ops: Op[] = fresh.map((def, k) => ({ op: "symbolDef", before: null, after: { ...def, entities: def.entities.map(fix) }, index: doc.symbols.length + k }));
  // Built-ins the library refers to but does not include are copied in too.
  const working: CadDocument = { ...doc, symbols: [...doc.symbols, ...fresh] };
  for (const def of fresh)
    for (const e of def.entities.map(fix)) {
      const refs = e.kind === "symbol" ? [e.symbolId] : e.kind === "wall" ? (e.openings ?? []).map((o) => o.symbolId).filter((x): x is string => !!x) : [];
      for (const r of refs)
        for (const o of ensureSymbolOps(working, r)) {
          const sd = o as Extract<Op, { op: "symbolDef" }>;
          ops.push({ ...sd, index: working.symbols.length });
          working.symbols.push(sd.after!);
        }
    }
  return { ops, added: fresh.length };
}

/** Is a symbol used anywhere (instances, nested, or in wall openings)? */
export function symbolInUse(doc: CadDocument, id: Id): boolean {
  const uses = (e: Entity) => (e.kind === "symbol" && e.symbolId === id) || (e.kind === "wall" && !!e.openings?.some((o) => o.symbolId === id));
  return doc.entities.some(uses) || doc.symbols.some((s) => s.entities.some(uses));
}

export function deleteSymbol(id: Id): boolean {
  const { doc } = store();
  const i = doc.symbols.findIndex((s) => s.id === id);
  if (i < 0 || symbolInUse(doc, id)) return false;
  store().commit({ label: "Delete Symbol", ops: [{ op: "symbolDef", before: doc.symbols[i], after: null, index: i }] });
  return true;
}

