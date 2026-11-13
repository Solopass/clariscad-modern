import { useState } from "react";
import { MenuBar } from "./components/MenuBar";
import { MethodsBar } from "./components/MethodsBar";
import { Viewport } from "./components/Viewport";
import { ToolsPalette } from "./components/ToolsPalette";
import { ModifiersPalette } from "./components/ModifiersPalette";
import { CoordinatesHUD } from "./components/CoordinatesHUD";

export default function App() {
  const [modifiersOpen, setModifiersOpen] = useState(true);
  return (
    <div className="flex h-full flex-col">
      <MenuBar modifiersOpen={modifiersOpen} setModifiersOpen={setModifiersOpen} />
      <MethodsBar />
      <div className="relative min-h-0 flex-1">
        <Viewport />
        <ToolsPalette />
        {modifiersOpen && <ModifiersPalette onClose={() => setModifiersOpen(false)} />}
      </div>
      <CoordinatesHUD />
    </div>
  );
}
