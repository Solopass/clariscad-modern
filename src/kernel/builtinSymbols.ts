// Built-in starter symbols. Copied into a drawing the first time they are placed,
// so saved files never depend on them.
import type { Entity, SymbolDef } from "./types";

const L = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({ id, layerId: "", kind: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });

const W = 914.4; // 36" nominal opening

export const BUILTIN_SYMBOLS: SymbolDef[] = [
  {
    id: "builtin:door-single",
    name: "Door (single swing)",
    origin: { x: 0, y: 0 },
    opening: { width: W },
    entities: [
      L("leaf", -W / 2, 0, -W / 2, W),
      { id: "swing", layerId: "", kind: "arc", center: { x: -W / 2, y: 0 }, r: W, start: 0, end: Math.PI / 2 },
    ],
  },
  {
    id: "builtin:door-double",
    name: "Door (double swing)",
    origin: { x: 0, y: 0 },
    opening: { width: 2 * W },
    entities: [
      L("l1", -W, 0, -W, W),
      { id: "s1", layerId: "", kind: "arc", center: { x: -W, y: 0 }, r: W, start: 0, end: Math.PI / 2 },
      L("l2", W, 0, W, W),
      { id: "s2", layerId: "", kind: "arc", center: { x: W, y: 0 }, r: W, start: Math.PI / 2, end: Math.PI },
    ],
  },
  {
    id: "builtin:window",
    name: "Window",
    origin: { x: 0, y: 0 },
    opening: { width: W },
    entities: [L("g", -W / 2, 0, W / 2, 0), L("s1", -W / 2, 38, W / 2, 38), L("s2", -W / 2, -38, W / 2, -38)],
  },
  {
    id: "builtin:north",
    name: "North Arrow",
    origin: { x: 0, y: 0 },
    entities: [
      { id: "c", layerId: "", kind: "circle", center: { x: 0, y: 0 }, r: 300 },
      { id: "t", layerId: "", kind: "polygon", points: [{ x: 0, y: 300 }, { x: 120, y: -200 }, { x: 0, y: -100 }, { x: -120, y: -200 }], style: { fill: "solid" } },
      L("n", -60, 380, -60, 520),
      L("n2", -60, 520, 60, 380),
      L("n3", 60, 380, 60, 520),
    ],
  },
  {
    id: "builtin:section",
    name: "Section Mark",
    origin: { x: 0, y: 0 },
    entities: [
      { id: "c", layerId: "", kind: "circle", center: { x: 0, y: 0 }, r: 250 },
      L("h", -250, 0, 250, 0),
      { id: "a", layerId: "", kind: "polygon", points: [{ x: 250, y: 0 }, { x: 450, y: 0 }, { x: 250, y: 200 }], style: { fill: "solid" } },
    ],
  },
];

