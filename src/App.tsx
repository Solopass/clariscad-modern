import { useState } from "react";
import { MenuBar } from "./components/MenuBar";
import { MethodsBar } from "./components/MethodsBar";
import { Viewport } from "./components/Viewport";
import { ToolsPalette } from "./components/ToolsPalette";
import { ModifiersPalette } from "./components/ModifiersPalette";
import { LayersPalette } from "./components/LayersPalette";
import { AttributesPalette } from "./components/AttributesPalette";
import { SymbolsPalette } from "./components/SymbolsPalette";
import { CoordinatesHUD } from "./components/CoordinatesHUD";
import { useAppLifecycle } from "./components/useAppLifecycle";

export type PaletteId = "modifiers" | "layers" | "attributes" | "symbols";
export type PaletteState = Record<PaletteId, boolean>;

const KEY = "temaricad.palettes.v1";
function loadOpen(): PaletteState {
  const def: PaletteState = { modifiers: true, layers: true, attributes: true, symbols: false };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return def;
  }
}

export default function App() {
  useAppLifecycle();
  const [open, setOpenState] = useState<PaletteState>(loadOpen);
  const setOpen = (id: PaletteId, v: boolean) =>
    setOpenState((s) => {
      const next = { ...s, [id]: v };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return (
    <div className="flex h-full flex-col">
      <MenuBar palettes={open} setPalette={setOpen} />
      <MethodsBar />
      <div className="relative min-h-0 flex-1">
        <Viewport />
        <ToolsPalette />
        {open.modifiers && <ModifiersPalette onClose={() => setOpen("modifiers", false)} />}
        {open.layers && <LayersPalette onClose={() => setOpen("layers", false)} />}
        {open.attributes && <AttributesPalette onClose={() => setOpen("attributes", false)} />}
        {open.symbols && <SymbolsPalette onClose={() => setOpen("symbols", false)} />}
      </div>
      <CoordinatesHUD />
    </div>
  );
}
