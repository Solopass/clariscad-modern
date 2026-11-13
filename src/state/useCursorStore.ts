// Pointer-rate readouts (HUD numbers, prompt). Kept separate so mouse moves
// only re-render the components that show them.
import { create } from "zustand";
import type { Vec2 } from "../kernel/vec";

export interface ViewSnap {
  cx: number;
  cy: number;
  zoom: number;
  width: number;
  height: number;
}

export interface CursorState {
  point: Vec2;
  from: Vec2 | null;
  snapLabel: string;
  prompt: string;
  zoom: number;
  /** Camera, updated when the view moves — not on every pointer tick. */
  view: ViewSnap;
  set(p: Partial<Omit<CursorState, "set">>): void;
}

export const useCursorStore = create<CursorState>((set) => ({
  point: { x: 0, y: 0 },
  from: null,
  snapLabel: "",
  prompt: "",
  zoom: 1,
  view: { cx: 0, cy: 0, zoom: 1, width: 1, height: 1 },
  set: (p) => set(p),
}));
