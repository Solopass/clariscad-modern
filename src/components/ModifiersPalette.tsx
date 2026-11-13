// Modifiers: persistent snap and constraint toggles.
import type { Modifiers } from "../kernel/snapEngine";
import { useToolStore } from "../state/useToolStore";
import { LengthField } from "./LengthField";
import { Palette } from "./Palette";

const ITEMS: { key: keyof Modifiers; label: string; badge: string }[] = [
  { key: "endpoint", label: "Endpoint", badge: "END" },
  { key: "midpoint", label: "Midpoint", badge: "MID" },
  { key: "center", label: "Center", badge: "CEN" },
  { key: "quadrant", label: "Quadrant", badge: "QUAD" },
  { key: "intersection", label: "Intersection", badge: "INT" },
  { key: "apparent", label: "Apparent Int.", badge: "APP" },
  { key: "perpendicular", label: "Perpendicular", badge: "PERP" },
  { key: "tangent", label: "Tangent", badge: "TAN" },
  { key: "nearest", label: "On Object", badge: "ON" },
  { key: "alignment", label: "Alignment", badge: "ALIGN" },
  { key: "angle", label: "Angle Lock", badge: "ANG" },
  { key: "grid", label: "Grid Snap", badge: "GRID" },
];

export function ModifiersPalette({ onClose }: { onClose(): void }) {
  const modifiers = useToolStore((s) => s.modifiers);
  const toggle = useToolStore((s) => s.toggleModifier);
  const settings = useToolStore((s) => s.settings);
  const set = useToolStore((s) => s.setSetting);

  return (
    <Palette id="modifiers" title="Modifiers" initial={{ x: window.innerWidth - 190, y: 64 }} onClose={onClose}>
      <div className="w-[176px] py-1">
        {ITEMS.map((it) => (
          <label key={it.key} className="mac-menu-item flex cursor-default items-center gap-2 px-2 py-[1px]">
            <input type="checkbox" checked={!!modifiers[it.key]} onChange={() => toggle(it.key)} />
            <span className="flex-1">{it.label}</span>
            <span className="font-mono text-[9px]">{it.badge}</span>
          </label>
        ))}
        <div className="mt-1 flex flex-col gap-1 border-t border-black px-2 pt-1">
          <LengthField label="Grid" width={90} value={settings.gridSpacing} min={0.01} onChange={(v) => set("gridSpacing", v)} />
          <LengthField label="Angle" kind="angle" width={60} value={settings.angleStep} min={0.1} max={180} onChange={(v) => set("angleStep", v)} />
        </div>
        <p className="px-2 pt-1 text-[10px] leading-tight text-[#666]">Hold Shift while drawing to lock to 45°.</p>
      </div>
    </Palette>
  );
}
