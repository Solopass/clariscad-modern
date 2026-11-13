// Canvas drawing of entities and overlay marks. All points go through the
// camera in float64; the canvas only ever sees screen pixels.
import type { DimensionEntity, Entity, Layer, SymbolDef, Id, UnitSystem } from "../kernel/types";
import { type DimStyle, dimGeometry } from "../kernel/dimensions";
import { textWidth } from "../kernel/textMetrics";
import { handlesOf } from "../kernel/handles";
import { entityHatch, fillRings, patternById } from "../kernel/hatch";
import { type Transform2D, apply, multiply } from "../kernel/transform";
import { type Prim, type PrimContext, flattenPrim, primsOf, symbolTexts, symbolTransform } from "../kernel/prims";
import type { Vec2 } from "../kernel/vec";
import { type Camera, viewBox, worldToScreen } from "./camera";

export const DASH_PATTERNS: Record<string, number[]> = {
  solid: [],
  dashed: [8, 4],
  dotted: [1.5, 3],
  dashdot: [10, 3, 2, 3],
  center: [16, 4, 4, 4],
  hidden: [5, 3],
};

export interface Theme {
  paper: string;
  ink: string;
  grid: string;
  gridMajor: string;
  guide: string;
  select: string;
  preview: string;
  snap: string;
  axis: string;
}

export const CLASSIC: Theme = {
  paper: "#ffffff",
  ink: "#000000",
  grid: "#d8d8d8",
  gridMajor: "#b0b0b0",
  guide: "#3a7bd5",
  select: "#000000",
  preview: "#000000",
  snap: "#d6001c",
  axis: "#9a9a9a",
};

/** Paper pen weight (mm) → screen pixels, at least a hairline. */
export const penPx = (mm = 0.25) => Math.max(1, (mm * 96) / 25.4);

export function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

// ---------------------------------------------------------------- grid

/** Is a length a whole number of 1/16 inches (i.e. an imperial grid)? */
const isImperial = (mm: number) => Math.abs(mm / (25.4 / 16) - Math.round(mm / (25.4 / 16))) < 1e-9;

/**
 * Displayed grid step: the snap spacing times the smallest multiplier that keeps
 * lines at least `minPx` apart, so grid lines always land on snap points.
 */
export function displayGridStep(base: number, zoom: number, minPx = 12): { step: number; major: number } {
  const imperial = isImperial(base);
  const mults = imperial ? [1, 2, 4, 12, 24, 48, 120, 240, 480, 1200] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  let step = base * mults[mults.length - 1];
  for (const m of mults) {
    if (base * m * zoom >= minPx) {
      step = base * m;
      break;
    }
  }
  while (step * zoom < minPx) step *= 10;
  const inchBased = imperial && Math.abs(304.8 % step) < 1e-9 && step < 304.8;
  return { step, major: inchBased ? 304.8 : step * 10 };
}

export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, theme: Theme, base: number, visible: boolean) {
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, cam.width, cam.height);
  if (!visible || !(base > 0)) return;
  const { step, major } = displayGridStep(base, cam.zoom, 12);
  const vb = viewBox(cam);
  const draw = (s: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.ceil(vb.minX / s) * s;
    for (let x = x0; x <= vb.maxX; x += s) {
      const sx = Math.round(worldToScreen(cam, { x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, cam.height);
    }
    const y0 = Math.ceil(vb.minY / s) * s;
    for (let y = y0; y <= vb.maxY; y += s) {
      const sy = Math.round(worldToScreen(cam, { x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(cam.width, sy);
    }
    ctx.stroke();
  };
  draw(step, theme.grid);
  if (Number.isFinite(major) && major * cam.zoom > 40) draw(major, theme.gridMajor);
  // Origin cross.
  const o = worldToScreen(cam, { x: 0, y: 0 });
  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.moveTo(Math.round(o.x) + 0.5, o.y - 10);
  ctx.lineTo(Math.round(o.x) + 0.5, o.y + 10);
  ctx.moveTo(o.x - 10, Math.round(o.y) + 0.5);
  ctx.lineTo(o.x + 10, Math.round(o.y) + 0.5);
  ctx.stroke();
}

// ---------------------------------------------------------------- entities

/** Add a primitive's outline to the current path. */
export function tracePrim(ctx: CanvasRenderingContext2D, cam: Camera, p: Prim) {
  switch (p.t) {
    case "seg": {
      const a = worldToScreen(cam, p.a);
      const b = worldToScreen(cam, p.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      return;
    }
    case "arc": {
      const c = worldToScreen(cam, p.c);
      const r = p.r * cam.zoom;
      if (r > 1e5) {
        // Huge on-screen radius: canvas arc precision breaks down; draw the visible part as a polyline.
        const { pts } = flattenPrim(p, 0.25 / cam.zoom);
        pts.forEach((q, i) => {
          const s = worldToScreen(cam, q);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        return;
      }
      // y flips, so world CCW is screen anticlockwise with negated angles.
      const s = { x: c.x + r * Math.cos(-p.start), y: c.y + r * Math.sin(-p.start) };
      ctx.moveTo(s.x, s.y);
      ctx.arc(c.x, c.y, r, -p.start, -(p.start + p.sweep), true);
      return;
    }
    case "ell": {
      const c = worldToScreen(cam, p.c);
      const start = worldToScreen(cam, {
        x: p.c.x + p.rx * Math.cos(p.start) * Math.cos(p.rot) - p.ry * Math.sin(p.start) * Math.sin(p.rot),
        y: p.c.y + p.rx * Math.cos(p.start) * Math.sin(p.rot) + p.ry * Math.sin(p.start) * Math.cos(p.rot),
      });
      ctx.moveTo(start.x, start.y);
      ctx.ellipse(c.x, c.y, p.rx * cam.zoom, p.ry * cam.zoom, -p.rot, -p.start, -(p.start + p.sweep), true);
      return;
    }
    case "xline": {
      const far = (Math.hypot(cam.width, cam.height) / cam.zoom) * 2 + Math.hypot(p.p.x - cam.cx, p.p.y - cam.cy);
      const a = worldToScreen(cam, { x: p.p.x - p.d.x * far, y: p.p.y - p.d.y * far });
      const b = worldToScreen(cam, { x: p.p.x + p.d.x * far, y: p.p.y + p.d.y * far });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      return;
    }
    case "curve": {
      p.pts.forEach((q, i) => {
        const s = worldToScreen(cam, q);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      return;
    }
  }
}

export interface DrawContext {
  cam: Camera;
  theme: Theme;
  layers: Map<Id, Layer>;
  symbols: PrimContext;
  /** Show pen weights at their paper width (otherwise every line is a hairline). */
  showWeights: boolean;
  dimStyle: DimStyle;
  units: UnitSystem;
}

export function strokeEntity(ctx: CanvasRenderingContext2D, e: Entity, dc: DrawContext, override?: { color?: string; width?: number; dash?: number[] }) {
  if (e.kind === "dimension") return drawDimension(ctx, e, dc, override?.color);
  if (e.kind === "text") return drawText(ctx, e, dc, override?.color);
  const layer = dc.layers.get(e.layerId);
  const isGuide = e.kind === "guide";
  ctx.strokeStyle = override?.color ?? (isGuide ? dc.theme.guide : (e.style?.color ?? layer?.color ?? dc.theme.ink));
  ctx.lineWidth = override?.width ?? (dc.showWeights ? penPx(e.style?.penWeight) : 1);
  ctx.setLineDash(override?.dash ?? (isGuide ? [4, 4] : (DASH_PATTERNS[e.style?.dash ?? "solid"] ?? [])));
  ctx.beginPath();
  for (const p of primsOf(e, dc.symbols)) tracePrim(ctx, dc.cam, p);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawEntities(ctx: CanvasRenderingContext2D, entities: Iterable<Entity>, dc: DrawContext) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const e of entities) {
    const layer = dc.layers.get(e.layerId);
    if (layer && !layer.visible) continue;
    if (e.style?.fill) fillEntity(ctx, e, dc);
    if (e.kind === "symbol") fillSymbol(ctx, e, dc);
    strokeEntity(ctx, e, dc);
    if (e.kind === "symbol") for (const t of symbolTexts(e, dc.symbols)) drawText(ctx, t, dc);
  }
}

/** Fills of the parts of a symbol (solid fills; patterns at the instance's layer scale). */
function fillSymbol(ctx: CanvasRenderingContext2D, inst: Extract<Entity, { kind: "symbol" }>, dc: DrawContext, parent?: Transform2D, layerId = inst.layerId, depth = 0) {
  const defs = dc.symbols.symbols;
  const def = defs instanceof Map ? defs.get(inst.symbolId) : defs?.[inst.symbolId];
  if (!def || depth > 8) return;
  const own = symbolTransform(def.origin, inst.position, inst.rotation, inst.scaleX, inst.scaleY);
  // Compose with the parent placement exactly as toPrims does.
  const T = parent ? multiply(parent, own) : own;
  for (const child of def.entities) {
    if (child.kind === "symbol") {
      fillSymbol(ctx, child, dc, T, layerId, depth + 1);
      continue;
    }
    const pat = patternById(child.style?.fill);
    const rings = pat && fillRings(child);
    if (!pat || !rings) continue;
    const mapped = rings.map((r) => r.map((p) => apply(T, p)));
    const ink = child.style?.color ?? dc.layers.get(layerId)?.color ?? dc.theme.ink;
    ctx.beginPath();
    for (const r of mapped)
      r.forEach((p, i) => {
        const s = worldToScreen(dc.cam, p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
    ctx.closePath();
    ctx.fillStyle = pat.solid ? (pat.solid === "#000000" ? ink : pat.solid) : "#c8c8c8";
    ctx.fill("evenodd");
  }
}

/** Fill pattern or solid fill inside a closed entity, under its outline. */
export function fillEntity(ctx: CanvasRenderingContext2D, e: Entity, dc: DrawContext) {
  const pat = patternById(e.style?.fill);
  if (!pat) return;
  const layer = dc.layers.get(e.layerId);
  const k = (layer?.scale ?? 1) * (e.style?.fillScale ?? 1);
  const { rings, result } = entityHatch(e, pat.id, k, dc.symbols);
  if (!rings) return;
  const path = () => {
    ctx.beginPath();
    for (const r of rings)
      r.forEach((p, i) => {
        const s = worldToScreen(dc.cam, p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
    ctx.closePath();
  };
  const ink = e.style?.color ?? layer?.color ?? dc.theme.ink;
  const finest = pat.families ? Math.min(...pat.families.map((f) => f.spacing)) * k * dc.cam.zoom : Infinity;
  if (pat.solid || !result || result.dense || finest < 1.5) {
    path();
    ctx.fillStyle = pat.solid ? (pat.solid === "#000000" ? ink : pat.solid) : "#c8c8c8";
    ctx.fill("evenodd");
    return;
  }
  // Lines closer than ~1.5 px read as a tint; draw them as one.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.75;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const [a, b] of result.segs) {
    const p = worldToScreen(dc.cam, a);
    const q = worldToScreen(dc.cam, b);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
  ctx.fillStyle = ink;
  for (const d of result.dots) {
    const s = worldToScreen(dc.cam, d);
    ctx.fillRect(s.x - 0.75, s.y - 0.75, 1.5, 1.5);
  }
}

// ---------------------------------------------------------------- overlay marks

/** Classic black square selection handles at an entity's key points (the grip handles). */
export function handlePoints(e: Entity): Vec2[] {
  return handlesOf(e).map((h) => h.p);
}

export const TEXT_FONT = `"Helvetica Neue", Helvetica, Arial, sans-serif`;

/** A text entity at its paper height × layer scale. */
export function drawText(ctx: CanvasRenderingContext2D, e: Extract<Entity, { kind: "text" }>, dc: DrawContext, color?: string) {
  const layer = dc.layers.get(e.layerId);
  const px = e.height * (layer?.scale ?? 1) * dc.cam.zoom;
  const s = worldToScreen(dc.cam, e.position);
  if (px < 2) {
    // Too small to read: a grey bar the size of the text keeps its place visible.
    const w = textWidth(e.text, e.height * (layer?.scale ?? 1)) * dc.cam.zoom;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(-e.rotation);
    ctx.fillStyle = "#bbb";
    ctx.fillRect(e.align === "left" ? 0 : e.align === "center" ? -w / 2 : -w, -Math.max(1, px * 0.7), Math.max(1, w), Math.max(1, px * 0.7));
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(-e.rotation);
  ctx.font = `${px}px ${TEXT_FONT}`;
  ctx.textAlign = e.align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color ?? e.style?.color ?? layer?.color ?? dc.theme.ink;
  ctx.fillText(e.text, 0, 0);
  ctx.restore();
}

/** Dimension: extension/dimension lines, arrowheads and upright text. */
export function drawDimension(ctx: CanvasRenderingContext2D, e: DimensionEntity, dc: DrawContext, color?: string) {
  const layer = dc.layers.get(e.layerId);
  const g = dimGeometry(e, layer?.scale ?? 1, dc.dimStyle, dc.units);
  const ink = color ?? e.style?.color ?? layer?.color ?? dc.theme.ink;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const [a, b] of g.lines) {
    const p = worldToScreen(dc.cam, a);
    const q = worldToScreen(dc.cam, b);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  for (const a of g.arcs) tracePrim(ctx, dc.cam, { t: "arc", c: a.c, r: a.r, start: a.start, sweep: a.sweep });
  ctx.stroke();
  for (const poly of g.arrows) {
    ctx.beginPath();
    poly.forEach((p, i) => {
      const s = worldToScreen(dc.cam, p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    if (g.filledArrows) ctx.fill();
    else ctx.stroke();
  }
  const t = g.text;
  const px = t ? t.height * dc.cam.zoom : 0;
  if (t && px >= 3) {
    const s = worldToScreen(dc.cam, t.pos);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(-t.angle); // world y-up → screen y-down
    ctx.font = `${px}px "Geneva", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.str, 0, 0);
    ctx.restore();
  }
}

export function drawHandles(ctx: CanvasRenderingContext2D, cam: Camera, pts: Vec2[], color = "#000") {
  ctx.fillStyle = color;
  for (const p of pts) {
    const s = worldToScreen(cam, p);
    ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 2, 5, 5);
  }
}

export function drawSnapBadge(ctx: CanvasRenderingContext2D, cam: Camera, p: Vec2, label: string, theme: Theme) {
  const s = worldToScreen(cam, p);
  ctx.strokeStyle = theme.snap;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(Math.round(s.x) - 4.5, Math.round(s.y) - 4.5, 9, 9);
  if (!label) return;
  ctx.font = "bold 10px ui-monospace, Menlo, Consolas, monospace";
  const w = ctx.measureText(label).width + 6;
  const x = s.x + 10;
  const y = s.y - 20;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, w, 14);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w, 14);
  ctx.fillStyle = theme.snap;
  ctx.fillText(label, x + 3, y + 11);
}

export function drawGuides(ctx: CanvasRenderingContext2D, cam: Camera, guides: { a: Vec2; b: Vec2 }[], theme: Theme) {
  if (!guides.length) return;
  ctx.strokeStyle = theme.guide;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  for (const g of guides) {
    const a = worldToScreen(cam, g.a);
    const b = worldToScreen(cam, g.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, cam: Camera, p: Vec2) {
  const s = worldToScreen(cam, p);
  const x = Math.round(s.x) + 0.5;
  const y = Math.round(s.y) + 0.5;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 12, y);
  ctx.lineTo(x + 12, y);
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x, y + 12);
  ctx.stroke();
}

export const symbolsCtx = (defs: SymbolDef[]): PrimContext => ({ symbols: new Map(defs.map((d) => [d.id, d])) });
