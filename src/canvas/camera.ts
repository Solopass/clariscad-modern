// View camera. World is y-up millimetres; screen is y-down CSS pixels.
// Points are mapped in float64 JS (never via a huge canvas transform), so
// drawings far from the origin keep full precision on screen.
import type { BBox } from "../kernel/types";
import type { Vec2 } from "../kernel/vec";

export interface Camera {
  /** World point at the centre of the viewport. */
  cx: number;
  cy: number;
  /** Screen pixels per millimetre. */
  zoom: number;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
}

export const MIN_ZOOM = 1e-4;
export const MAX_ZOOM = 1e4;

export const worldToScreen = (c: Camera, p: Vec2): Vec2 => ({
  x: (p.x - c.cx) * c.zoom + c.width / 2,
  y: c.height / 2 - (p.y - c.cy) * c.zoom,
});

export const screenToWorld = (c: Camera, s: Vec2): Vec2 => ({
  x: c.cx + (s.x - c.width / 2) / c.zoom,
  y: c.cy - (s.y - c.height / 2) / c.zoom,
});

/** Zoom by `factor`, keeping the world point under screen point `s` fixed. */
export function zoomAt(c: Camera, s: Vec2, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
  const w = screenToWorld(c, s);
  return {
    ...c,
    zoom,
    cx: w.x - (s.x - c.width / 2) / zoom,
    cy: w.y + (s.y - c.height / 2) / zoom,
  };
}

/** Pan by a screen-space delta. */
export const panBy = (c: Camera, dx: number, dy: number): Camera => ({ ...c, cx: c.cx - dx / c.zoom, cy: c.cy + dy / c.zoom });

/** Fit a world box into the viewport with a margin (px). */
export function fitBox(c: Camera, b: BBox, margin = 40): Camera {
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((c.width - 2 * margin) / w, (c.height - 2 * margin) / h)));
  return { ...c, zoom, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

/** Visible world box. */
export function viewBox(c: Camera): BBox {
  const a = screenToWorld(c, { x: 0, y: c.height });
  const b = screenToWorld(c, { x: c.width, y: 0 });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

