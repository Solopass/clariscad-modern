// Named key points of entities. Used for grip editing (drag a handle), for
// associative dimension refs ("b", "vertex:2", "center", ...), and to
// re-attach refs by position after an edit.
import type { DraftingStandard, Entity, UnitSystem, WallEntity } from "./types";
import { rectCorners } from "./prims";
import { STANDARDS, dimGeometry, textShiftFor } from "./dimensions";
import { type Vec2, add, angleOf, dist, dot, fromAngle, mid, normAngle, perp, rotate, scale, sub } from "./vec";

export interface Handle {
  name: string;
  p: Vec2;
}

const ellPoint = (c: Vec2, rx: number, ry: number, rot: number, u: number) => add(c, rotate({ x: rx * Math.cos(u), y: ry * Math.sin(u) }, rot));

/** What a dimension text grip and a wall opening grip need from the drawing. */
export interface GripCtx {
  scale: number;
  units: UnitSystem;
  standard: DraftingStandard;
}

export function handlesOf(e: Entity): Handle[] {
  switch (e.kind) {
    case "line":
      return [
        { name: "a", p: e.a },
        { name: "b", p: e.b },
        { name: "mid", p: mid(e.a, e.b) },
      ];
    case "doubleLine":
    case "wall":
      return [
        { name: "a", p: e.a },
        { name: "b", p: e.b },
        { name: "mid", p: mid(e.a, e.b) },
      ];
    case "polyline":
    case "polygon":
    case "spline":
      return e.points.map((p, i) => ({ name: `vertex:${i}`, p }));
    case "rect":
      return [...rectCorners(e.center, e.width, e.height, e.rotation).map((p, i) => ({ name: `corner:${i}`, p })), { name: "center", p: e.center }];
    case "circle":
      return [{ name: "center", p: e.center }, ...[0, 1, 2, 3].map((k) => ({ name: `quad:${k}`, p: add(e.center, fromAngle((k * Math.PI) / 2, e.r)) }))];
    case "arc": {
      const sweep = normAngle(e.end - e.start) || 2 * Math.PI;
      return [
        { name: "center", p: e.center },
        { name: "start", p: add(e.center, fromAngle(e.start, e.r)) },
        { name: "end", p: add(e.center, fromAngle(e.end, e.r)) },
        { name: "mid", p: add(e.center, fromAngle(e.start + sweep / 2, e.r)) },
      ];
    }
    case "ellipse":
      return [{ name: "center", p: e.center }, ...[0, 1, 2, 3].map((k) => ({ name: `quad:${k}`, p: ellPoint(e.center, e.rx, e.ry, e.rotation, (k * Math.PI) / 2) }))];
    case "guide":
      return [{ name: "point", p: e.point }];
    case "symbol":
      return [{ name: "insert", p: e.position }];
    case "dimension":
      return [{ name: "line", p: e.linePoint }];
    case "text":
      return [{ name: "insert", p: e.position }];
  }
}

/** Handles a user can drag. Adds the dimension text and the wall-opening grips. */
export function gripsOf(e: Entity, ctx?: GripCtx): Handle[] {
  const hs = handlesOf(e);
  if (e.kind === "dimension" && ctx) {
    const g = dimGeometry(e, ctx.scale, STANDARDS[ctx.standard] ?? STANDARDS.ANSI, ctx.units);
    if (g.text) hs.push({ name: "text", p: g.text.pos });
  }
  if (e.kind === "wall") hs.push(...openingGrips(e, ctx?.scale ?? 1));
  return hs;
}

/** Centre, two jambs, and a swing grip for each opening. */
function openingGrips(e: WallEntity, scaleK: number): Handle[] {
  const len = dist(e.a, e.b);
  if (len < 1e-9 || !e.openings?.length) return [];
  const d = scale(sub(e.b, e.a), 1 / len);
  const n = perp(d);
  const out: Handle[] = [];
  const reach = e.thickness / 2 + 8 * scaleK;
  for (const o of e.openings) {
    const c = add(e.a, scale(d, o.at));
    out.push({ name: `open:${o.id}:at`, p: c });
    out.push({ name: `open:${o.id}:a`, p: add(e.a, scale(d, o.at - o.width / 2)) });
    out.push({ name: `open:${o.id}:b`, p: add(e.a, scale(d, o.at + o.width / 2)) });
    out.push({ name: `open:${o.id}:swing`, p: add(c, scale(n, (o.swingFlip ? -1 : 1) * reach)) });
  }
  return out;
}

function alongWall(e: WallEntity, p: Vec2): number {
  const len = dist(e.a, e.b);
  if (len < 1e-9) return 0;
  const d = scale(sub(e.b, e.a), 1 / len);
  return dot(sub(p, e.a), d);
}

/** Keep an opening on the wall, clear of the ends and of the other openings. */
function placeOpening(e: WallEntity, id: string, at: number, width: number): { at: number; width: number } | null {
  const len = dist(e.a, e.b);
  width = Math.max(width, 10);
  const margin = e.thickness / 2;
  const lo = width / 2 + margin;
  const hi = len - width / 2 - margin;
  if (hi < lo - 1e-6) return null;
  let c = Math.min(hi, Math.max(lo, at));
  const others = (e.openings ?? []).filter((o) => o.id !== id);
  for (let pass = 0; pass < others.length + 1; pass++) {
    let moved = false;
    for (const o of others) {
      const gap = (o.width + width) / 2;
      if (Math.abs(o.at - c) < gap - 1e-6) {
        const left = o.at - gap;
        const right = o.at + gap;
        c = Math.abs(c - left) <= Math.abs(right - c) ? left : right;
        c = Math.min(hi, Math.max(lo, c));
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (others.some((o) => Math.abs(o.at - c) < (o.width + width) / 2 - 1e-6)) return null;
  return { at: c, width };
}

export function resolveHandle(e: Entity, name: string): Vec2 | null {
  return handlesOf(e).find((h) => h.name === name)?.p ?? null;
}

/** Name of the handle at `p` (within tol), preferring exact key points over "mid". */
export function handleAt(e: Entity, p: Vec2, tol = 1e-6): string | null {
  let best: Handle | null = null;
  let bd = Infinity;
  for (const h of handlesOf(e)) {
    const d = dist(h.p, p);
    if (d <= tol && d < bd) {
      best = h;
      bd = d;
    }
  }
  return best?.name ?? null;
}

/**
 * Openings after a wall end moves: each keeps its position in the world (projected
 * onto the new wall line); ones that no longer fit are dropped.
 */
function reseatOpenings(before: Extract<Entity, { kind: "wall" }>, after: Extract<Entity, { kind: "wall" }>) {
  if (!before.openings?.length) return before.openings;
  const len0 = dist(before.a, before.b);
  const len1 = dist(after.a, after.b);
  if (len0 === 0 || len1 === 0) return [];
  const d0 = scale(sub(before.b, before.a), 1 / len0);
  const d1 = scale(sub(after.b, after.a), 1 / len1);
  return before.openings
    .map((o) => ({ ...o, at: dot(sub(add(before.a, scale(d0, o.at)), after.a), d1) }))
    .filter((o) => o.at - o.width / 2 >= 0 && o.at + o.width / 2 <= len1);
}

/** Entity with handle `name` dragged to `p` (same id). Returns the entity unchanged for unknown handles. */
export function moveHandle(e: Entity, name: string, p: Vec2, ctx?: GripCtx): Entity {
  const vi = name.startsWith("vertex:") ? +name.slice(7) : -1;
  switch (e.kind) {
    case "line":
      if (name === "a") return { ...e, a: p };
      if (name === "b") return { ...e, b: p };
      if (name === "mid") {
        const d = sub(p, mid(e.a, e.b));
        return { ...e, a: add(e.a, d), b: add(e.b, d) };
      }
      return e;
    case "doubleLine":
      if (name === "a") return { ...e, a: p };
      if (name === "b") return { ...e, b: p };
      if (name === "mid") {
        const d = sub(p, mid(e.a, e.b));
        return { ...e, a: add(e.a, d), b: add(e.b, d) };
      }
      return e;
    case "wall": {
      if (name.startsWith("open:")) return moveOpening(e, name, p);
      let next: typeof e;
      if (name === "a") next = { ...e, a: p };
      else if (name === "b") next = { ...e, b: p };
      else if (name === "mid") {
        const d = sub(p, mid(e.a, e.b));
        return { ...e, a: add(e.a, d), b: add(e.b, d) };
      } else return e;
      return { ...next, openings: reseatOpenings(e, next) };
    }
    case "polyline":
    case "spline":
      if (vi < 0 || vi >= e.points.length) return e;
      return { ...e, points: e.points.map((q, i) => (i === vi ? p : q)) };
    case "polygon":
      if (vi < 0 || vi >= e.points.length) return e;
      return { ...e, points: e.points.map((q, i) => (i === vi ? p : q)), regular: undefined };
    case "rect": {
      if (name === "center") return { ...e, center: p };
      if (!name.startsWith("corner:")) return e;
      const k = +name.slice(7);
      const corners = rectCorners(e.center, e.width, e.height, e.rotation);
      const opp = corners[(k + 2) % 4];
      // Resize in the rectangle's own frame with the opposite corner fixed.
      const l = rotate(sub(p, opp), -e.rotation);
      if (Math.abs(l.x) < 1e-9 || Math.abs(l.y) < 1e-9) return e;
      return { ...e, width: Math.abs(l.x), height: Math.abs(l.y), center: mid(opp, p) };
    }
    case "circle":
      if (name === "center") return { ...e, center: p };
      if (name.startsWith("quad:")) return dist(p, e.center) > 1e-9 ? { ...e, r: dist(p, e.center) } : e;
      return e;
    case "arc":
      if (name === "center") return { ...e, center: p };
      if (name === "start") return { ...e, start: normAngle(angleOf(sub(p, e.center))) };
      if (name === "end") return { ...e, end: normAngle(angleOf(sub(p, e.center))) };
      if (name === "mid") return dist(p, e.center) > 1e-9 ? { ...e, r: dist(p, e.center) } : e;
      return e;
    case "ellipse": {
      if (name === "center") return { ...e, center: p };
      if (!name.startsWith("quad:")) return e;
      const k = +name.slice(5);
      const axis = rotate({ x: 1, y: 0 }, e.rotation);
      const v = sub(p, e.center);
      if (k % 2 === 0) {
        const rx = Math.abs(dot(v, axis));
        return rx > 1e-9 ? { ...e, rx } : e;
      }
      const ry = Math.abs(dot(v, rotate(axis, Math.PI / 2)));
      return ry > 1e-9 ? { ...e, ry } : e;
    }
    case "guide":
      return name === "point" ? { ...e, point: p } : e;
    case "symbol":
      return name === "insert" ? { ...e, position: p } : e;
    case "dimension": {
      if (name === "line") return { ...e, linePoint: p };
      if (name === "text" && ctx) {
        const shift = textShiftFor(e, p, ctx.scale, STANDARDS[ctx.standard] ?? STANDARDS.ANSI, ctx.units);
        const next = { ...e };
        if (shift) next.textShift = shift;
        else delete next.textShift;
        return next;
      }
      return e;
    }
    case "text":
      return name === "insert" ? { ...e, position: p } : e;
  }
}

function moveOpening(e: WallEntity, name: string, p: Vec2): WallEntity {
  const [, id, which] = name.split(":");
  const op = e.openings?.find((o) => o.id === id);
  if (!op || !e.openings) return e;
  const len = dist(e.a, e.b);
  if (len < 1e-9) return e;
  const d = scale(sub(e.b, e.a), 1 / len);
  const n = perp(d);
  if (which === "swing") {
    const c = add(e.a, scale(d, op.at));
    const swingFlip = dot(sub(p, c), n) < 0;
    if (swingFlip === !!op.swingFlip) return e;
    return { ...e, openings: e.openings.map((o) => (o.id === id ? { ...o, swingFlip } : o)) };
  }
  const u = alongWall(e, p);
  let at = op.at;
  let width = op.width;
  if (which === "at") at = u;
  else if (which === "a" || which === "b") {
    const fixed = which === "a" ? op.at + op.width / 2 : op.at - op.width / 2;
    const lo = Math.min(fixed, u);
    const hi = Math.max(fixed, u);
    width = hi - lo;
    at = (lo + hi) / 2;
  } else return e;
  const placed = placeOpening(e, id, at, width);
  if (!placed) return e;
  return { ...e, openings: e.openings.map((o) => (o.id === id ? { ...o, at: placed.at, width: placed.width } : o)) };
}
