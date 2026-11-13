// Freehand stroke decimation (Ramer–Douglas–Peucker).
import { type Vec2, cross, dist, sub } from "./vec";

function perpDist(p: Vec2, a: Vec2, b: Vec2): number {
  const d = dist(a, b);
  return d === 0 ? dist(p, a) : Math.abs(cross(sub(b, a), sub(p, a))) / d;
}

/** Drop points that stay within `tol` of the simplified polyline. Keeps first and last points. */
export function simplifyPolyline(points: Vec2[], tol: number): Vec2[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpDist(points[k], points[i], points[j]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}
