// Affine 2D transform in canvas order:
//   x' = a*x + c*y + e
//   y' = b*x + d*y + f
import type { Vec2 } from "./vec";

export interface Transform2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const identity = (): Transform2D => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
export const translation = (tx: number, ty: number): Transform2D => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const scaling = (sx: number, sy = sx): Transform2D => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export function rotation(ang: number): Transform2D {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}

/** Compose: result applies `n` first, then `m` (m ∘ n). */
export function multiply(m: Transform2D, n: Transform2D): Transform2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export const apply = (t: Transform2D, p: Vec2): Vec2 => ({ x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f });
/** Apply to a direction (ignores translation). */
export const applyDir = (t: Transform2D, v: Vec2): Vec2 => ({ x: t.a * v.x + t.c * v.y, y: t.b * v.x + t.d * v.y });

export function invert(t: Transform2D): Transform2D {
  const det = t.a * t.d - t.b * t.c;
  if (det === 0) throw new Error("Transform is not invertible");
  const a = t.d / det;
  const b = -t.b / det;
  const c = -t.c / det;
  const d = t.a / det;
  return { a, b, c, d, e: -(a * t.e + c * t.f), f: -(b * t.e + d * t.f) };
}
