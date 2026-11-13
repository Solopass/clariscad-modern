// Active tool, its Method, Modifier toggles and tool settings. Persisted per
// viewer in localStorage (best effort).
import { create } from "zustand";
import type { Modifiers } from "../kernel/snapEngine";
import type { Justify, LineEnding } from "../kernel/types";

export type ToolId =
  | "select"
  | "line"
  | "doubleLine"
  | "wall"
  | "rect"
  | "circle"
  | "arc"
  | "ellipse"
  | "polygon"
  | "spline"
  | "guide"
  | "dimension"
  | "trim"
  | "extend"
  | "split"
  | "offset"
  | "fillet"
  | "chamfer"
  | "symbol"
  | "text"
  | "cleanup"
  | "match";

export type TrimModeSetting = "both" | "first" | "none";

export interface ToolSettings {
  /** Grid snap spacing in mm. */
  gridSpacing: number;
  gridVisible: boolean;
  /** Angle-lock increment, degrees. */
  angleStep: number;
  doubleLineWidth: number;
  doubleLineCaps: boolean;
  polygonSides: number;
  cornerRadius: number;
  arcRadius: number;
  guideAngle: number;
  /** Pen weight for new entities, mm. */
  penWeight: number;
  dash: string;
  showWeights: boolean;
  wallThickness: number;
  wallJustify: "center" | "left" | "right";
  openingWidth: number;
  /** 0 = offset through the picked point. */
  offsetDistance: number;
  filletRadius: number;
  chamferD1: number;
  chamferD2: number;
  /** Degrees; used when chamferByAngle. */
  chamferAngle: number;
  chamferByAngle: boolean;
  trimMode: TrimModeSetting;
  /** Fill pattern for new closed shapes ("" = none). */
  fill: string;
  /** Colour for new entities ("" = by layer). */
  color: string;
  /** Symbol tool: which symbol, its scale and rotation (degrees). */
  symbolId: string;
  symbolScale: number;
  symbolRotation: number;
  /** Text tool: em height in paper mm, alignment, rotation (degrees). */
  textHeight: number;
  textAlign: "left" | "center" | "right";
  textRotation: number;
  /** "" = no cap. Applied to new objects and, via the attributes palette, the selection. */
  startEnding: "" | LineEnding;
  endEnding: "" | LineEnding;
  /** Select tool: only this kind, or "all". */
  selectFilter: string;
  /** Match Properties: which fields the eyedropper copies. Absent means yes. */
  matchPen?: boolean;
  matchDash?: boolean;
  matchEndings?: boolean;
  matchFill?: boolean;
  matchLayer?: boolean;
}

export interface ToolState {
  tool: ToolId;
  methods: Record<ToolId, string>;
  modifiers: Modifiers;
  settings: ToolSettings;
  setTool(t: ToolId): void;
  setMethod(t: ToolId, m: string): void;
  toggleModifier(k: keyof Modifiers): void;
  setModifier(k: keyof Modifiers, on: boolean): void;
  setSetting<K extends keyof ToolSettings>(k: K, v: ToolSettings[K]): void;
}

const DEFAULT_METHODS: Record<ToolId, string> = {
  select: "pick",
  line: "twoPoint",
  doubleLine: "center",
  rect: "corner",
  circle: "centerRadius",
  arc: "threePoint",
  ellipse: "box",
  polygon: "inscribed",
  spline: "interpolated",
  guide: "horizontal",
  wall: "twoPoint",
  dimension: "horizontal",
  trim: "trim",
  extend: "extend",
  split: "split",
  offset: "offset",
  fillet: "fillet",
  chamfer: "chamfer",
  symbol: "place",
  text: "place",
  cleanup: "openT",
  match: "selection",
};

const DEFAULT_MODIFIERS: Modifiers = {
  endpoint: true,
  midpoint: true,
  center: true,
  intersection: true,
  quadrant: false,
  perpendicular: false,
  tangent: false,
  nearest: false,
  apparent: false,
  alignment: true,
  insertion: true,
  angle: false,
  grid: false,
  parallel: false,
};

const DEFAULT_SETTINGS: ToolSettings = {
  gridSpacing: 25.4,
  gridVisible: true,
  angleStep: 15,
  doubleLineWidth: 6 * 25.4,
  doubleLineCaps: true,
  polygonSides: 6,
  cornerRadius: 0,
  arcRadius: 12 * 25.4,
  guideAngle: 45,
  penWeight: 0.25,
  dash: "solid",
  showWeights: false,
  wallThickness: 6 * 25.4,
  wallJustify: "center",
  openingWidth: 36 * 25.4,
  offsetDistance: 0,
  filletRadius: 6 * 25.4,
  chamferD1: 6 * 25.4,
  chamferD2: 6 * 25.4,
  chamferAngle: 45,
  chamferByAngle: false,
  trimMode: "both",
  fill: "",
  color: "",
  symbolId: "builtin:door-single",
  symbolScale: 1,
  symbolRotation: 0,
  textHeight: 3,
  textAlign: "left",
  textRotation: 0,
  startEnding: "",
  endEnding: "",
  selectFilter: "all",
};

const KEY = "temaricad.tools.v1";

function loadSaved(): Partial<Pick<ToolState, "methods" | "modifiers" | "settings">> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const saved = loadSaved();

export const useToolStore = create<ToolState>((set) => ({
  tool: "select",
  methods: { ...DEFAULT_METHODS, ...saved.methods },
  modifiers: { ...DEFAULT_MODIFIERS, ...saved.modifiers },
  settings: { ...DEFAULT_SETTINGS, ...saved.settings },
  setTool: (tool) => set({ tool }),
  setMethod: (t, m) => set((s) => ({ tool: t, methods: { ...s.methods, [t]: m } })),
  toggleModifier: (k) => set((s) => ({ modifiers: { ...s.modifiers, [k]: !s.modifiers[k] } })),
  setModifier: (k, on) => set((s) => ({ modifiers: { ...s.modifiers, [k]: on } })),
  setSetting: (k, v) => set((s) => ({ settings: { ...s.settings, [k]: v } })),
}));

useToolStore.subscribe((s) => {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ methods: s.methods, modifiers: s.modifiers, settings: s.settings }));
  } catch {
    /* storage unavailable */
  }
});

export type { Justify };
