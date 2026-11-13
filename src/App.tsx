import { useEffect, useState } from "react";
import { MenuBar } from "./components/MenuBar";
import { MethodsBar } from "./components/MethodsBar";
import { Viewport } from "./components/Viewport";
import { ToolsPalette } from "./components/ToolsPalette";
import { ModifiersPalette } from "./components/ModifiersPalette";
import { LayersPalette } from "./components/LayersPalette";
import { AttributesPalette } from "./components/AttributesPalette";
import { SymbolsPalette } from "./components/SymbolsPalette";
import { CoordinatesHUD } from "./components/CoordinatesHUD";
import { ShortcutBar } from "./components/ShortcutBar";
import { ContextMenu } from "./components/ContextMenu";
import { useAppLifecycle } from "./components/useAppLifecycle";

export type PaletteId = "modifiers" | "layers" | "attributes" | "symbols";
export type PaletteState = Record<PaletteId, boolean>;

const KEY = "temaricad.palettes.v1";
const KEYS_OPEN = "temaricad.shortcuts.open";
function loadOpen(): PaletteState {
  const def: PaletteState = { modifiers: true, layers: true, attributes: true, symbols: false };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return def;
  }
}

function loadKeys(): boolean {
  try {
    return localStorage.getItem(KEYS_OPEN) === "1";
  } catch {
    return false;
  }
}

export default function App() {
  useAppLifecycle();
  const [open, setOpenState] = useState<PaletteState>(loadOpen);
  const [keysOpen, setKeysOpen] = useState(loadKeys);
  const setKeys = (v: boolean) => {
    setKeysOpen(v);
    try {
      localStorage.setItem(KEYS_OPEN, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
  useEffect(() => {
    const onCmd = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "window.shortcuts") setKeys(!keysOpen);
      const palettes: Record<string, PaletteId> = {
        "window.modifiers": "modifiers",
        "window.layers": "layers",
        "window.attributes": "attributes",
        "window.symbols": "symbols",
      };
      const pid = palettes[id];
      if (pid) setOpen(pid, !open[pid]);
    };
    window.addEventListener("temaricad:command", onCmd);
    return () => window.removeEventListener("temaricad:command", onCmd);
  }, [keysOpen, open]);
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
      <MenuBar palettes={open} setPalette={setOpen} keysOpen={keysOpen} />
      <MethodsBar />
      <div className="relative min-h-0 flex-1">
        <Viewport />
        <ToolsPalette />
        {open.modifiers && <ModifiersPalette onClose={() => setOpen("modifiers", false)} />}
        {open.layers && <LayersPalette onClose={() => setOpen("layers", false)} />}
        {open.attributes && <AttributesPalette onClose={() => setOpen("attributes", false)} />}
        {open.symbols && <SymbolsPalette onClose={() => setOpen("symbols", false)} />}
      </div>
      {keysOpen && <ShortcutBar onClose={() => setKeys(false)} />}
      <CoordinatesHUD keysOpen={keysOpen} onToggleKeys={() => setKeys(!keysOpen)} />
      <ContextMenu />
    </div>
  );
}
