// Eyedropper: copy chosen properties from one object onto others.
import type { Entity, StyleRef } from "../kernel/types";

export interface MatchFlags {
  pen: boolean;
  dash: boolean;
  endings: boolean;
  fill: boolean;
  layer: boolean;
}

/** The target with the chosen properties of `src`. Null when nothing changes. */
export function applyMatch(src: Entity, target: Entity, flags: MatchFlags): Entity | null {
  if (src.id === target.id) return null;
  let next: Entity = target;
  let changed = false;
  if (flags.layer && src.layerId !== target.layerId) {
    next = { ...next, layerId: src.layerId };
    changed = true;
  }
  const style: StyleRef = { ...(next.style ?? {}) };
  const from = src.style ?? {};
  const take = (key: keyof StyleRef) => {
    if (style[key] === from[key]) return;
    if (from[key] === undefined) delete style[key];
    else (style as Record<string, unknown>)[key] = from[key];
    changed = true;
  };
  if (flags.pen) take("penWeight");
  if (flags.dash) take("dash");
  if (flags.endings) {
    take("startEnding");
    take("endEnding");
  }
  if (flags.fill) {
    take("fill");
    take("fillScale");
  }
  if (!changed) return null;
  const cleaned = Object.keys(style).length ? style : undefined;
  if (cleaned) next = { ...next, style: cleaned };
  else {
    next = { ...next };
    delete next.style;
  }
  return next;
}
