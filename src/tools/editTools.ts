// Walls, dimensions and the editing tools (trim, extend, split, offset,
// fillet, chamfer), defined the same declarative way as the drawing tools.
import type { DimRef, DimensionType, Entity, Id, WallEntity } from "../kernel/types";
import { entityBBox, primsOf, closestOnPrim } from "../kernel/prims";
import { chamfer, extendTo, fillet, offsetEntity, splitAt, trimAt, trimPiece, type EditResult } from "../kernel/booleanOps";
import { handleAt } from "../kernel/handles";
import { breakForCrossing, extendToBar, fitOpening, wallParam } from "../kernel/wallSolver";
import { findEnclosedRegion, ringArea, ringPerimeter } from "../kernel/regionOps";
import { formatAngle, formatArea, formatLength } from "../kernel/units";
import { type Vec2, add, angleOf, dist, normalize, perp, scale, sub } from "../kernel/vec";
import { editPatch, replacePatch } from "../state/ops";
import { applyMatch } from "../state/match";
import { findSymbol, placeSymbolPatch } from "../state/symbols";
import { useDocumentStore } from "../state/useDocumentStore";
import type { BuildCtx, MethodDef, Shape, ToolDef } from "./defs";

/** Strip id/layer so an entity can be shown as a preview shape. */
export function shapeOf(e: Entity): Shape {
  const { id: _id, layerId: _layer, ...rest } = e;
  return rest as Shape;
}

const resultShapes = (r: EditResult | null): Shape[] => (r ? [...r.replace, ...r.add].map(shapeOf) : []);

/** Entities near `target` that could cut or bound it. */
function neighbours(target: Entity, ctx: BuildCtx): Entity[] {
  const index = ctx.index();
  const box = entityBBox(target, index.ctx);
  if (!box) return [];
  const layers = new Map(ctx.doc().layers.map((l) => [l.id, l]));
  return index.spatial
    .search(box)
    .map((id) => index.get(id)!)
    .filter((e) => e && e.id !== target.id && e.kind !== "dimension" && layers.get(e.layerId)?.visible !== false);
}

/** Every visible entity (extend may reach far). */
function allVisible(ctx: BuildCtx): Entity[] {
  const layers = new Map(ctx.doc().layers.map((l) => [l.id, l]));
  return ctx.doc().entities.filter((e) => e.kind !== "dimension" && layers.get(e.layerId)?.visible !== false);
}

const distanceTo = (e: Entity, p: Vec2, ctx: BuildCtx) => Math.min(...primsOf(e, ctx.index().ctx).map((q) => closestOnPrim(q, p).distance));

// ---------------------------------------------------------------- walls

const wallShape = (a: Vec2, b: Vec2, ctx: BuildCtx): Shape => ({ kind: "wall", a, b, thickness: ctx.settings.wallThickness, justify: ctx.settings.wallJustify });

const WALL: ToolDef = {
  id: "wall",
  label: "Wall",
  key: "w",
  methods: [
    { id: "twoPoint", label: "Single", points: 2, prompts: ["Wall start", "Wall end"], build: ([a, b], ctx) => (dist(a, b) > 0 ? wallShape(a, b, ctx) : null) },
    {
      id: "continuous",
      label: "Continuous",
      points: "many",
      min: 2,
      prompts: ["First corner", "Next corner (Enter or double-click to finish, C to close)"],
      build: (pts, ctx) => {
        const out: Shape[] = [];
        for (let i = 0; i + 1 < pts.length; i++) if (dist(pts[i], pts[i + 1]) > 0) out.push(wallShape(pts[i], pts[i + 1], ctx));
        return out.length ? out : null;
      },
    },
    {
      id: "opening",
      label: "Opening",
      points: 1,
      prompts: ["Click a wall where the opening is centred (width in Methods bar)"],
      preview: ([p], ctx) => {
        const w = ctx.entityAt(p);
        if (w?.kind !== "wall") return {};
        const at = openingAt(w, p, ctx.settings.openingWidth);
        if (at === null) return {};
        const d = normalize(sub(w.b, w.a));
        const n = scale(perp(d), w.thickness);
        const jamb = (u: number): Shape => {
          const c = add(w.a, scale(d, u));
          return { kind: "line", a: add(c, scale(n, -0.75)), b: add(c, scale(n, 0.75)) };
        };
        return { highlight: [jamb(at - ctx.settings.openingWidth / 2), jamb(at + ctx.settings.openingWidth / 2)] };
      },
      edit: ([p], ctx) => {
        const w = ctx.entityAt(p);
        if (w?.kind !== "wall") return null;
        const width = ctx.settings.openingWidth;
        const at = openingAt(w, p, width);
        if (at === null) return null;
        const after: WallEntity = { ...w, openings: [...(w.openings ?? []), { id: ctx.newId(), at, width }] };
        return replacePatch("Add Opening", [[w, after]]);
      },
    },
  ],
};

/** Opening centre along the wall, kept fully inside it; null if it does not fit. */
function openingAt(w: WallEntity, p: Vec2, width: number): number | null {
  return fitOpening(w, wallParam(w, p), width);
}

// ---------------------------------------------------------------- dimensions

function refFor(p: Vec2, ids: Id[] | undefined, ctx: BuildCtx): DimRef | null {
  for (const id of ids ?? []) {
    const e = ctx.index().get(id);
    if (!e || e.kind === "dimension") continue;
    const name = handleAt(e, p, 1e-6);
    if (name) return { entityId: id, handle: name };
  }
  return null;
}

/** Horizontal or vertical, from where the dimension line is placed relative to the span. */
function autoHV(p1: Vec2, p2: Vec2, lp: Vec2): "horizontal" | "vertical" {
  const lo = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y) };
  const hi = { x: Math.max(p1.x, p2.x), y: Math.max(p1.y, p2.y) };
  const outY = lp.y > hi.y || lp.y < lo.y;
  const outX = lp.x > hi.x || lp.x < lo.x;
  if (outY && !outX) return "horizontal";
  if (outX && !outY) return "vertical";
  return Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? "horizontal" : "vertical";
}

function linear(type: DimensionType, p1: Vec2, p2: Vec2, lp: Vec2, refs: (DimRef | null)[], groupId?: Id): Shape {
  return { kind: "dimension", dimType: type, points: [p1, p2], refs, linePoint: lp, ...(groupId ? { groupId } : {}) };
}

const linearMethod = (type: "horizontal" | "vertical" | "aligned", label: string): MethodDef => ({
  id: type,
  label,
  points: 3,
  prompts: ["First point", "Second point", "Place the dimension line"],
  build: (pts, ctx) => {
    if (pts.length < 3) return pts.length === 2 && dist(pts[0], pts[1]) > 0 ? { kind: "line", a: pts[0], b: pts[1] } : null;
    const [p1, p2, lp] = pts;
    if (dist(p1, p2) === 0) return null;
    return linear(type, p1, p2, lp, [refFor(p1, ctx.pickIds[0], ctx), refFor(p2, ctx.pickIds[1], ctx)]);
  },
});

/** Layer scale of the active layer (model mm per paper mm). */
const activeScale = (ctx: BuildCtx) => {
  const doc = ctx.doc();
  return doc.layers.find((l) => l.id === doc.activeLayerId)?.scale ?? 1;
};

const seriesMethod = (kind: "chain" | "baseline", label: string): MethodDef => ({
  id: kind,
  label,
  points: "many",
  min: 3,
  prompts: ["First point", "Second point", "Place the dimension line", `Next point (Enter or double-click to finish)`],
  build: (pts, ctx) => {
    if (pts.length < 3) return pts.length === 2 && dist(pts[0], pts[1]) > 0 ? { kind: "line", a: pts[0], b: pts[1] } : null;
    const [p1, p2, lp] = pts;
    if (dist(p1, p2) === 0) return null;
    const type = autoHV(p1, p2, lp);
    const group = ctx.newId();
    const out: Shape[] = [linear(type, p1, p2, lp, [refFor(p1, ctx.pickIds[0], ctx), refFor(p2, ctx.pickIds[1], ctx)], group)];
    const rest = pts.slice(3);
    // Baseline dimensions stack outward from the first one.
    const step = 10 * activeScale(ctx);
    const away = type === "horizontal" ? Math.sign(lp.y - p1.y) || 1 : Math.sign(lp.x - p1.x) || 1;
    rest.forEach((p, k) => {
      const i = k + 3;
      if (kind === "chain") {
        const prev = i === 3 ? p2 : pts[i - 1];
        const prevIds = i === 3 ? ctx.pickIds[1] : ctx.pickIds[i - 1];
        out.push(linear(type, prev, p, lp, [refFor(prev, prevIds, ctx), refFor(p, ctx.pickIds[i], ctx)], group));
      } else {
        const off = step * (k + 1) * away;
        const l = type === "horizontal" ? { x: lp.x, y: lp.y + off } : { x: lp.x + off, y: lp.y };
        out.push(linear(type, p1, p, l, [refFor(p1, ctx.pickIds[0], ctx), refFor(p, ctx.pickIds[i], ctx)], group));
      }
    });
    return out;
  },
});

const DIMENSION: ToolDef = {
  id: "dimension",
  label: "Dimension",
  key: "m",
  methods: [
    linearMethod("horizontal", "Horizontal"),
    linearMethod("vertical", "Vertical"),
    linearMethod("aligned", "Aligned"),
    seriesMethod("chain", "Chain"),
    seriesMethod("baseline", "Baseline"),
    {
      id: "angular",
      label: "Angular",
      points: 3,
      rawPicks: [0, 1],
      prompts: ["Pick the first line", "Pick the second line", "Place the arc"],
      build: (pts, ctx) => {
        if (pts.length < 3) return null;
        const l1 = ctx.entityAt(pts[0]);
        const l2 = ctx.entityAt(pts[1]);
        if (l1?.kind !== "line" || l2?.kind !== "line" || l1.id === l2.id) return null;
        return {
          kind: "dimension",
          dimType: "angular",
          points: [l1.a, l1.b, l2.a, l2.b],
          refs: [
            { entityId: l1.id, handle: "a" },
            { entityId: l1.id, handle: "b" },
            { entityId: l2.id, handle: "a" },
            { entityId: l2.id, handle: "b" },
          ],
          linePoint: pts[2],
        };
      },
    },
    ...(["radius", "diameter"] as const).map(
      (t): MethodDef => ({
        id: t,
        label: t === "radius" ? "Radius" : "Diameter",
        points: 2,
        rawPicks: [0],
        prompts: ["Pick a circle or arc", "Place the text"],
        build: (pts, ctx) => (pts.length < 2 ? null : radial(t, ctx.entityAt(pts[0]), pts[1])),
      }),
    ),
    {
      id: "centerMark",
      label: "Center Mark",
      points: 1,
      rawPicks: [0],
      prompts: ["Pick a circle or arc"],
      build: ([p], ctx) => {
        const c = ctx.entityAt(p);
        if (c?.kind !== "circle" && c?.kind !== "arc") return null;
        return { kind: "dimension", dimType: "centerMark", points: [c.center], refs: [{ entityId: c.id, handle: "center" }], linePoint: c.center };
      },
    },
  ],
};

function radial(t: "radius" | "diameter", c: Entity | null, lp: Vec2): Shape | null {
  if (c?.kind !== "circle" && c?.kind !== "arc") return null;
  // A point on the curve that the dimension stays attached to.
  const handle = c.kind === "circle" ? "quad:0" : "mid";
  const pt = c.kind === "circle" ? add(c.center, { x: c.r, y: 0 }) : arcMid(c);
  return {
    kind: "dimension",
    dimType: t,
    points: [c.center, pt],
    refs: [
      { entityId: c.id, handle: "center" },
      { entityId: c.id, handle },
    ],
    linePoint: lp,
  };
}

function arcMid(a: Extract<Entity, { kind: "arc" }>): Vec2 {
  let sweep = (((a.end - a.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (sweep === 0) sweep = 2 * Math.PI;
  const m = a.start + sweep / 2;
  return add(a.center, { x: a.r * Math.cos(m), y: a.r * Math.sin(m) });
}

// ---------------------------------------------------------------- editing

const one = (id: "trim" | "extend" | "split", label: string, key: string, method: MethodDef): ToolDef => ({ id, label, key, methods: [method] });

const TRIM = one("trim", "Trim", "t", {
  id: "trim",
  label: "Click to Trim",
  points: 1,
  rawPicks: [0],
  prompts: ["Click the piece to remove (it is cut where other objects cross it)"],
  preview: ([p], ctx) => {
    const t = ctx.entityAt(p);
    const piece = t && trimPiece(t, p, neighbours(t, ctx), ctx.index().ctx);
    return { highlight: piece ? [shapeOf(piece)] : [] };
  },
  edit: ([p], ctx) => {
    const t = ctx.entityAt(p);
    const r = t && trimAt(t, p, neighbours(t, ctx), ctx.newId, ctx.index().ctx);
    return r ? editPatch(ctx.doc(), "Trim", r) : null;
  },
});

const EXTEND = one("extend", "Extend", "x", {
  id: "extend",
  label: "Extend to Boundary",
  points: 1,
  rawPicks: [0],
  prompts: ["Click near the end to extend to the next object"],
  preview: ([p], ctx) => {
    const t = ctx.entityAt(p);
    return { highlight: resultShapes(t && extendTo(t, p, allVisible(ctx), ctx.index().ctx)) };
  },
  edit: ([p], ctx) => {
    const t = ctx.entityAt(p);
    const r = t && extendTo(t, p, allVisible(ctx), ctx.index().ctx);
    return r ? editPatch(ctx.doc(), "Extend", r) : null;
  },
});

const SPLIT = one("split", "Split", "k", {
  id: "split",
  label: "Split at Point",
  points: 1,
  prompts: ["Click the point to split at (snaps apply)"],
  preview: ([p], ctx) => {
    const t = ctx.entityAt(p);
    return { highlight: t ? [shapeOf(t)] : [] };
  },
  edit: ([p], ctx) => {
    const t = ctx.entityAt(p);
    const r = t && splitAt(t, p, ctx.newId);
    return r ? editPatch(ctx.doc(), "Split", r) : null;
  },
});

const OFFSET: ToolDef = {
  id: "offset",
  label: "Offset",
  key: "o",
  methods: [
    {
      id: "offset",
      label: "Parallel Offset",
      points: 2,
      rawPicks: [0],
      prompts: ["Pick the object to offset", "Click the side (distance in Methods bar; 0 = through this point)"],
      preview: ([p0, p1], ctx) => {
        if (!p1) return {};
        const e = ctx.entityAt(p0);
        if (!e) return {};
        const d = ctx.settings.offsetDistance > 0 ? ctx.settings.offsetDistance : distanceTo(e, p1, ctx);
        return { shapes: resultShapes(offsetEntity(e, d, p1, ctx.newId)) };
      },
      edit: ([p0, p1], ctx) => {
        const e = ctx.entityAt(p0);
        if (!e) return null;
        const d = ctx.settings.offsetDistance > 0 ? ctx.settings.offsetDistance : distanceTo(e, p1, ctx);
        const r = offsetEntity(e, d, p1, ctx.newId);
        return r ? editPatch(ctx.doc(), "Offset", r) : null;
      },
    },
  ],
};

const FILLET: ToolDef = {
  id: "fillet",
  label: "Fillet",
  key: "i",
  methods: [
    {
      id: "fillet",
      label: "Fillet",
      points: 2,
      rawPicks: [0, 1],
      prompts: ["Pick the first line or arc (on the side to keep)", "Pick the second (radius and trim in Methods bar)"],
      preview: ([p0, p1], ctx) => {
        if (!p1) return {};
        const a = ctx.entityAt(p0);
        const b = ctx.entityAt(p1);
        return { shapes: a && b ? resultShapes(fillet(a, p0, b, p1, ctx.settings.filletRadius, ctx.settings.trimMode, ctx.newId)) : [] };
      },
      edit: ([p0, p1], ctx) => {
        const a = ctx.entityAt(p0);
        const b = ctx.entityAt(p1);
        const r = a && b && fillet(a, p0, b, p1, ctx.settings.filletRadius, ctx.settings.trimMode, ctx.newId);
        return r ? editPatch(ctx.doc(), "Fillet", r) : null;
      },
    },
  ],
};

const chamferSpec = (ctx: BuildCtx) =>
  ctx.settings.chamferByAngle ? { d1: ctx.settings.chamferD1, angle: (ctx.settings.chamferAngle * Math.PI) / 180 } : { d1: ctx.settings.chamferD1, d2: ctx.settings.chamferD2 };

const CHAMFER: ToolDef = {
  id: "chamfer",
  label: "Chamfer",
  key: "h",
  methods: [
    {
      id: "chamfer",
      label: "Chamfer",
      points: 2,
      rawPicks: [0, 1],
      prompts: ["Pick the first line (on the side to keep)", "Pick the second line"],
      preview: ([p0, p1], ctx) => {
        if (!p1) return {};
        const a = ctx.entityAt(p0);
        const b = ctx.entityAt(p1);
        return { shapes: a && b ? resultShapes(chamfer(a, p0, b, p1, chamferSpec(ctx), ctx.settings.trimMode, ctx.newId)) : [] };
      },
      edit: ([p0, p1], ctx) => {
        const a = ctx.entityAt(p0);
        const b = ctx.entityAt(p1);
        const r = a && b && chamfer(a, p0, b, p1, chamferSpec(ctx), ctx.settings.trimMode, ctx.newId);
        return r ? editPatch(ctx.doc(), "Chamfer", r) : null;
      },
    },
  ],
};

const SYMBOL: ToolDef = {
  id: "symbol",
  label: "Symbol",
  key: "y",
  methods: [
    {
      id: "place",
      label: "Place Symbol",
      points: 1,
      prompts: ["Click to place the symbol (doors and windows: click a wall; the click side sets the swing)"],
      preview: ([p], ctx) => {
        const s = ctx.settings;
        const def = findSymbol(ctx.doc(), s.symbolId);
        if (!def) return {};
        const hit = ctx.entityAt(p);
        if (def.opening && hit?.kind === "wall") {
          const patch = placeSymbolPatch(ctx.doc(), s.symbolId, p, s.symbolScale, s.symbolRotation, hit, "");
          const after = patch?.ops.find((o) => o.op === "replace");
          // Show the wall with its new opening (drawn as a plain band plus the symbol frame jambs).
          return after && after.op === "replace" ? { highlight: [shapeOf(after.after)] } : {};
        }
        return { shapes: [{ kind: "symbol", symbolId: def.id, position: p, rotation: (s.symbolRotation * Math.PI) / 180, scaleX: s.symbolScale, scaleY: s.symbolScale }] };
      },
      edit: ([p], ctx) => {
        const s = ctx.settings;
        const def = findSymbol(ctx.doc(), s.symbolId);
        if (!def) return null;
        const hit = ctx.entityAt(p);
        return placeSymbolPatch(ctx.doc(), s.symbolId, p, s.symbolScale, s.symbolRotation, def.opening && hit?.kind === "wall" ? hit : null, ctx.doc().activeLayerId);
      },
    },
  ],
};

const TEXT: ToolDef = {
  id: "text",
  label: "Text",
  key: "q",
  methods: [
    {
      id: "place",
      label: "Click to Type",
      points: 1,
      prompts: ["Click where the text starts (height, alignment and angle in the Methods bar)"],
      preview: ([p], ctx) => ({
        shapes: [{ kind: "text", position: p, text: "Text", height: ctx.settings.textHeight, rotation: (ctx.settings.textRotation * Math.PI) / 180, align: ctx.settings.textAlign }],
      }),
      edit: ([p], ctx) => {
        const text = ctx.ask("Text", "");
        if (!text) return null;
        const s = ctx.settings;
        const doc = ctx.doc();
        const e: Entity = {
          id: ctx.newId(),
          layerId: doc.activeLayerId,
          kind: "text",
          position: p,
          text,
          height: s.textHeight,
          rotation: (s.textRotation * Math.PI) / 180,
          align: s.textAlign,
          ...(s.color ? { style: { color: s.color } } : {}),
        };
        return { label: "New Text", ops: [{ op: "add", entity: e, index: doc.entities.length }] };
      },
    },
    {
      id: "leader",
      label: "Leader Callout",
      points: "many",
      min: 2,
      prompts: ["Click the arrow tip", "Click elbow / landing point (Enter or right-click to finish)"],
      preview: (pts) => (pts.length >= 2 ? { shapes: [{ kind: "polyline", points: pts, closed: false, style: { startEnding: "arrow" } }] } : {}),
      edit: (pts, ctx) => {
        if (pts.length < 2) return null;
        const text = ctx.ask("Callout text", "");
        if (!text) return null;
        const s = ctx.settings;
        const doc = ctx.doc();
        const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
        const k = layer?.scale ?? 1;
        const end = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const right = end.x >= prev.x;
        const gap = (right ? 1.5 : -1.5) * k;
        const leader: Entity = {
          id: ctx.newId(),
          layerId: doc.activeLayerId,
          kind: "polyline",
          points: pts,
          closed: false,
          style: { ...(s.color ? { color: s.color } : {}), startEnding: "arrow" },
        };
        const label: Entity = {
          id: ctx.newId(),
          layerId: doc.activeLayerId,
          kind: "text",
          position: { x: end.x + gap, y: end.y - 0.3 * s.textHeight * k },
          text,
          height: s.textHeight,
          rotation: 0,
          align: right ? "left" : "right",
          ...(s.color ? { style: { color: s.color } } : {}),
        };
        return {
          label: "New Callout",
          ops: [
            { op: "add", entity: leader, index: doc.entities.length },
            { op: "add", entity: label, index: doc.entities.length + 1 },
          ],
        };
      },
    },
  ],
};

const CLEANUP: ToolDef = {
  id: "cleanup",
  label: "Clean Up",
  key: "b",
  methods: [
    {
      id: "openT",
      label: "Open T",
      points: 2,
      rawPicks: [0, 1],
      prompts: ["Click the wall that should run into the joint", "Click the wall it meets"],
      preview: ([p0, p1], ctx) => {
        const a = ctx.entityAt(p0);
        const b = p1 ? ctx.entityAt(p1) : null;
        return { highlight: [a, b].filter((e): e is WallEntity => e?.kind === "wall").map(shapeOf) };
      },
      edit: ([p0, p1], ctx) => {
        const a = ctx.entityAt(p0);
        const b = ctx.entityAt(p1);
        if (a?.kind !== "wall" || b?.kind !== "wall" || a.id === b.id) return null;
        const after = extendToBar(a, b);
        return after ? { label: "Clean Up T", ops: [{ op: "replace", before: a, after }] } : null;
      },
    },
    {
      id: "break",
      label: "Break",
      points: 2,
      rawPicks: [0, 1],
      prompts: ["Click the wall to break open", "Click the wall that crosses it"],
      preview: ([p0, p1], ctx) => {
        const a = ctx.entityAt(p0);
        const b = p1 ? ctx.entityAt(p1) : null;
        if (a?.kind !== "wall" || b?.kind !== "wall") return { highlight: a?.kind === "wall" ? [shapeOf(a)] : [] };
        const after = breakForCrossing(a, b);
        return { highlight: [shapeOf(after ?? a)] };
      },
      edit: ([p0, p1], ctx) => {
        const a = ctx.entityAt(p0);
        const b = ctx.entityAt(p1);
        if (a?.kind !== "wall" || b?.kind !== "wall" || a.id === b.id) return null;
        const after = breakForCrossing(a, b);
        return after && after !== a ? { label: "Break Wall", ops: [{ op: "replace", before: a, after }] } : null;
      },
    },
  ],
};

const matchFlags = (s: BuildCtx["settings"]) => ({
  pen: s.matchPen !== false,
  dash: s.matchDash !== false,
  endings: s.matchEndings !== false,
  fill: s.matchFill !== false,
  layer: s.matchLayer !== false,
});

const MATCH: ToolDef = {
  id: "match",
  label: "Match Properties",
  key: "n",
  methods: [
    {
      id: "selection",
      label: "Onto Selection",
      points: 1,
      rawPicks: [0],
      prompts: ["Click the object to copy from. Checked properties land on the selection."],
      edit: ([p], ctx) => {
        const src = ctx.entityAt(p);
        if (!src) return null;
        const { doc, selection } = useDocumentStore.getState();
        const pairs: [Entity, Entity][] = [];
        for (const e of doc.entities) {
          if (!selection.has(e.id)) continue;
          const after = applyMatch(src, e, matchFlags(ctx.settings));
          if (after) pairs.push([e, after]);
        }
        return pairs.length ? replacePatch("Match Properties", pairs) : null;
      },
    },
    {
      id: "pick",
      label: "Pick Targets",
      points: "many",
      min: 2,
      rawPicks: [-1],
      prompts: ["Click the object to copy from", "Click objects to change, then Enter"],
      edit: (pts, ctx) => {
        const src = ctx.entityAt(pts[0]);
        if (!src) return null;
        const pairs: [Entity, Entity][] = [];
        const seen = new Set<string>();
        for (const p of pts.slice(1)) {
          const e = ctx.entityAt(p);
          if (!e || seen.has(e.id)) continue;
          seen.add(e.id);
          const after = applyMatch(src, e, matchFlags(ctx.settings));
          if (after) pairs.push([e, after]);
        }
        return pairs.length ? replacePatch("Match Properties", pairs) : null;
      },
    },
  ],
};

const HATCH: ToolDef = {
  id: "hatch",
  label: "Boundary Hatch",
  key: "z",
  methods: [
    {
      id: "region",
      label: "Pick Inside Region",
      points: 1,
      prompts: ["Click inside an enclosed boundary to hatch it"],
      preview: ([p], ctx) => {
        const ring = findEnclosedRegion(p, allVisible(ctx), ctx.index().ctx);
        return ring ? { highlight: [{ kind: "polyline", points: ring, closed: true }] } : {};
      },
      edit: ([p], ctx) => {
        const ring = findEnclosedRegion(p, allVisible(ctx), ctx.index().ctx);
        if (!ring) return null;
        const s = ctx.settings;
        const doc = ctx.doc();
        const fill = s.fill && s.fill !== "none" ? s.fill : "ansi31";
        const entity: Entity = {
          id: ctx.newId(),
          layerId: doc.activeLayerId,
          kind: "polyline",
          points: ring,
          closed: true,
          style: {
            penWeight: s.penWeight,
            ...(s.color ? { color: s.color } : {}),
            fill,
          },
        };
        return { label: "Boundary Hatch", ops: [{ op: "add", entity, index: doc.entities.length }] };
      },
    },
  ],
};

const MEASURE: ToolDef = {
  id: "measure",
  label: "Measure",
  key: "j",
  methods: [
    {
      id: "distance",
      label: "Distance / Path",
      points: "many",
      min: 2,
      prompts: ["Click start point", "Click next point (Enter or right-click for total)"],
      preview: (pts) => (pts.length >= 2 ? { highlight: [{ kind: "polyline", points: pts, closed: false }] } : {}),
      edit: (pts, ctx) => {
        if (pts.length < 2) return null;
        const u = ctx.doc().units;
        const total = ringPerimeter(pts, false);
        const direct = dist(pts[0], pts[pts.length - 1]);
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const ang = angleOf(sub(last, prev));
        window.alert(
          `Path length: ${formatLength(total, u)}\nDirect distance: ${formatLength(direct, u)}\nLast segment: ${formatLength(dist(prev, last), u)} at ${formatAngle(ang)}`,
        );
        return null;
      },
    },
    {
      id: "area",
      label: "Area / Perimeter",
      points: "many",
      min: 3,
      closes: true,
      prompts: ["Click first corner", "Click next corner", "Click corners, then Enter or close to measure area"],
      preview: (pts) => (pts.length >= 2 ? { highlight: [{ kind: "polyline", points: pts, closed: pts.length >= 3 }] } : {}),
      edit: (pts, ctx) => {
        if (pts.length < 3) return null;
        const u = ctx.doc().units;
        const area = Math.abs(ringArea(pts));
        const perim = ringPerimeter(pts, true);
        window.alert(`Area: ${formatArea(area, u)}\nPerimeter: ${formatLength(perim, u)}`);
        return null;
      },
    },
  ],
};

export const EDIT_TOOLS: ToolDef[] = [WALL, DIMENSION, TRIM, EXTEND, SPLIT, OFFSET, FILLET, CHAMFER, CLEANUP, SYMBOL, TEXT, MATCH, HATCH, MEASURE];

