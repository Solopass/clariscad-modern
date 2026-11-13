// 2D vector and angle helpers. Plain objects, no classes, all float64.

export interface Vec2 {
  x: number;
  y: number;
}

/** Default geometric tolerance (world units). Model units are millimetres. */
export const EPS = 1e-9;
export const TAU = Math.PI * 2;

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
/** Left-hand normal (rotate +90°). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const fromAngle = (ang: number, r = 1): Vec2 => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function rotate(p: Vec2, ang: number, about: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

export const near = (a: Vec2, b: Vec2, eps = EPS): boolean => dist(a, b) <= eps;

/** Normalize an angle into [0, 2π). */
export function normAngle(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** True if angle `theta` lies on the CCW sweep that starts at `start` and spans `sweep` (> 0) radians. */
export function angleInSweep(theta: number, start: number, sweep: number, eps = 1e-12): boolean {
  if (sweep >= TAU - eps) return true;
  const d = normAngle(theta - start);
  return d <= sweep + eps || d >= TAU - eps;
}
