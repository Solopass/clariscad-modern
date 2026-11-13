// Active tool, its Method, Modifier toggles and tool settings. Persisted per
// viewer in localStorage (best effort).
import { create } from "zustand";
import type { Modifiers } from "../kernel/snapEngine";
import type { Justify } from "../kernel/types";

export type ToolId = "select" | "line" | "doubleLine" | "rect" | "circle" | "arc" | "ellipse" | "polygon" | "spline" | "guide";

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
