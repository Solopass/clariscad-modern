// .tcad: the native file. A small wrapper around the CadDocument; the
// document's own `version` is the schema version (migrated before validation).
import { DOCUMENT_VERSION, type CadDocument, type Entity, type EntityKind, type SavedView, type TitleBlock } from "../kernel/types";
import { normalizeSheet } from "../state/sheetModel";

export const FILE_EXT = "tcad";

interface TcadFile {
  format: "tcad";
  app: string;
  savedAt: string;
  document: CadDocument;
}

export function serializeDocument(doc: CadDocument): string {
  const document = { ...doc, entities: doc.entities.filter((e) => !e.bufferOf) };
  const file: TcadFile = { format: "tcad", app: "TemariCad", savedAt: new Date().toISOString(), document };
  return JSON.stringify(file);
}

export class FileFormatError extends Error {}

/** Upgrade older documents to the current schema, one version at a time. */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  // 1 → 2 goes here when the schema changes.
};

const KINDS = new Set<EntityKind>(["text", "line", "polyline", "doubleLine", "wall", "rect", "circle", "arc", "ellipse", "polygon", "spline", "guide", "dimension", "symbol"]);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPos = (v: unknown) => isNum(v) && v > 0;
const isPt = (p: unknown) => !!p && typeof p === "object" && isNum((p as { x: unknown }).x) && isNum((p as { y: unknown }).y);
const isPts = (v: unknown, min: number) => Array.isArray(v) && v.length >= min && v.every(isPt);
const ALIGNS = new Set(["left", "center", "right"]);
const JUSTIFY = new Set(["center", "left", "right"]);
const DIM_TYPES = new Set(["horizontal", "vertical", "aligned", "angular", "radius", "diameter", "centerMark"]);

/**
 * Check (and where harmless, repair) an entity's fields. Returns false if it
 * can't be drawn safely; optional numbers that are missing get their defaults.
 */
function readViews(raw: unknown): SavedView[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SavedView[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.name === "string" && typeof o.cx === "number" && typeof o.cy === "number" && typeof o.zoom === "number" && Number.isFinite(o.zoom) && o.zoom > 0) {
      out.push({ id: o.id, name: o.name, cx: o.cx, cy: o.cy, zoom: o.zoom });
    }
  }
  return out.length ? out : undefined;
}

function readTitle(t: unknown): TitleBlock | undefined {
  if (!t || typeof t !== "object") return undefined;
  const o = t as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return { title: s("title"), drawnBy: s("drawnBy"), date: s("date"), scale: s("scale"), sheetNo: s("sheetNo") || "1" };
}

function entityOk(e: Entity): boolean {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.layerId !== "string" || !KINDS.has(e.kind)) return false;
  const any = e as unknown as Record<string, unknown>;
  if (e.locked !== undefined && typeof e.locked !== "boolean") delete any.locked;
  if (e.kind !== "dimension" && typeof any.groupId === "string") {
    e.groups = [any.groupId as string, ...(e.groups ?? [])];
    delete any.groupId;
  }
  if (e.groups !== undefined) {
    const ids = e.groups.filter((id) => typeof id === "string");
    if (ids.length) e.groups = ids;
    else delete any.groups;
  }
  const ending = (k: "startEnding" | "endEnding") => {
    const v = e.style?.[k];
    if (v !== undefined && v !== "arrow" && v !== "open" && v !== "tick" && v !== "dot") delete (e.style as Record<string, unknown>)[k];
  };
  if (e.style) {
    ending("startEnding");
    ending("endEnding");
  }
  const def = (k: string, v: unknown) => {
    if (any[k] === undefined) any[k] = v;
  };
  if (e.style && typeof e.style !== "object") delete any.style;
  switch (e.kind) {
    case "line":
      return isPt(e.a) && isPt(e.b);
    case "doubleLine":
      def("justify", "center");
      def("capStart", true);
      def("capEnd", true);
      return isPt(e.a) && isPt(e.b) && isPos(e.width) && JUSTIFY.has(e.justify);
    case "wall":
      def("justify", "center");
      if (e.openings !== undefined && !(Array.isArray(e.openings) && e.openings.every((o) => o && isNum(o.at) && isPos(o.width)))) delete any.openings;
      return isPt(e.a) && isPt(e.b) && isPos(e.thickness) && JUSTIFY.has(e.justify);
    case "polyline":
      def("closed", false);
      if (e.bulges !== undefined && !(Array.isArray(e.bulges) && e.bulges.every(isNum))) delete any.bulges;
      return isPts(e.points, 2) && typeof e.closed === "boolean";
    case "polygon":
      return isPts(e.points, 3);
    case "spline":
      def("closed", false);
      if (e.knots !== undefined && !(Array.isArray(e.knots) && e.knots.every(isNum))) delete any.knots;
      if (e.weights !== undefined && !(Array.isArray(e.weights) && e.weights.every(isPos))) delete any.weights;
      return isPts(e.points, 2) && (e.mode === "bspline" || e.mode === "interpolated");
    case "rect":
      def("rotation", 0);
      def("cornerRadius", 0);
      return isPt(e.center) && isPos(e.width) && isPos(e.height) && isNum(e.rotation) && isNum(e.cornerRadius);
    case "circle":
      return isPt(e.center) && isPos(e.r);
    case "arc":
      return isPt(e.center) && isPos(e.r) && isNum(e.start) && isNum(e.end);
    case "ellipse":
      def("rotation", 0);
      if ((e.start === undefined) !== (e.end === undefined) || (e.start !== undefined && !(isNum(e.start) && isNum(e.end)))) {
        delete any.start;
        delete any.end;
      }
      return isPt(e.center) && isPos(e.rx) && isPos(e.ry) && isNum(e.rotation);
    case "guide":
      return isPt(e.point) && isPt(e.dir) && (e.dir.x !== 0 || e.dir.y !== 0);
    case "dimension":
      if (!Array.isArray(e.refs)) any.refs = [];
      return DIM_TYPES.has(e.dimType) && isPts(e.points, e.dimType === "centerMark" ? 1 : e.dimType === "angular" ? 4 : 2) && isPt(e.linePoint);
    case "symbol":
      def("rotation", 0);
      def("scaleX", 1);
      def("scaleY", 1);
      return typeof e.symbolId === "string" && isPt(e.position) && isNum(e.rotation) && isNum(e.scaleX) && isNum(e.scaleY) && e.scaleX !== 0 && e.scaleY !== 0;
    case "text":
      def("rotation", 0);
      def("align", "left");
      return isPt(e.position) && typeof e.text === "string" && isPos(e.height) && isNum(e.rotation) && ALIGNS.has(e.align);
  }
}

export interface LoadResult {
  doc: CadDocument;
  /** Things that were repaired or dropped while loading. */
  warnings: string[];
}

/** Symbol definitions with their contents checked like top-level objects. */
function symbols(d: CadDocument, warnings: string[]) {
  if (!Array.isArray(d.symbols)) return [];
  let bad = 0;
  const out = d.symbols
    .filter((s) => s && typeof s.id === "string" && Array.isArray(s.entities) && isPt(s.origin))
    .map((s) => {
      const ok = s.entities.filter(entityOk);
      bad += s.entities.length - ok.length;
      return { ...s, name: typeof s.name === "string" ? s.name : s.id, entities: ok };
    });
  if (bad) warnings.push(`${bad} damaged object(s) inside symbols were left out.`);
  return out;
}

export function parseDocument(text: string): LoadResult {
  let file: Partial<TcadFile>;
  try {
    file = JSON.parse(text);
  } catch {
    throw new FileFormatError("This file is damaged or is not a TemariCad drawing.");
  }
  if (file.format !== "tcad" || !file.document) throw new FileFormatError("Not a TemariCad drawing (.tcad).");
  let raw = file.document as unknown as Record<string, unknown>;
  let v = typeof raw.version === "number" ? raw.version : 1;
  if (v > DOCUMENT_VERSION) throw new FileFormatError("This drawing was saved by a newer version of TemariCad.");
  while (v < DOCUMENT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new FileFormatError(`Don't know how to upgrade a version ${v} drawing.`);
    raw = step(raw);
    v++;
  }
  const d = raw as unknown as CadDocument;
  const warnings: string[] = [];
  const layers = Array.isArray(d.layers) ? d.layers.filter((l) => l && typeof l.id === "string") : [];
  if (!layers.length) {
    layers.push({ id: "layer-1", name: "Layer 1", visible: true, locked: false, scale: 1 });
    warnings.push("The drawing had no layers; one was added.");
  }
  for (const l of layers) if (!(l.scale > 0)) l.scale = 1;
  const layerIds = new Set(layers.map((l) => l.id));
  const entities = (Array.isArray(d.entities) ? d.entities : []).filter((e) => {
    if (e?.bufferOf) return false;
    const ok = entityOk(e);
    if (ok && !layerIds.has(e.layerId)) e.layerId = layers[0].id;
    return ok;
  });
  const dropped = (Array.isArray(d.entities) ? d.entities.length : 0) - entities.length;
  if (dropped) warnings.push(`${dropped} damaged object(s) were left out.`);
  const doc: CadDocument = {
    version: DOCUMENT_VERSION,
    units: d.units ?? "architectural",
    standard: d.standard ?? "ANSI",
    layers,
    activeLayerId: layerIds.has(d.activeLayerId) ? d.activeLayerId : layers[0].id,
    entities,
    symbols: symbols(d, warnings),
    sheet: normalizeSheet(d.sheet),
    ...(readTitle(d.titleBlock) ? { titleBlock: readTitle(d.titleBlock) } : {}),
    ...(readViews(d.views) ? { views: readViews(d.views) } : {}),
  };
  return { doc, warnings };
}
