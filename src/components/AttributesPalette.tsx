// Attributes: pen weight, dash, colour and fill. With a selection they edit it;
// they always set the defaults for new objects.
import type { LineEnding, StyleRef } from "../kernel/types";
import { PATTERNS } from "../kernel/hatch";
import { DASH_PATTERNS } from "../canvas/render";
import { useDocumentStore } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";
import { COLORS, PEN_WEIGHTS, styleSelection } from "../state/attributes";
import { Palette } from "./Palette";

export function AttributesPalette({ onClose }: { onClose(): void }) {
  const settings = useToolStore((s) => s.settings);
  const set = useToolStore((s) => s.setSetting);
  // Show the first selected object's attributes when there is a selection.
  const first = useDocumentStore((s) => {
    for (const e of s.doc.entities) if (s.selection.has(e.id)) return JSON.stringify(e.style ?? {});
    return null;
  });
  const sel: StyleRef | null = first ? JSON.parse(first) : null;
  const pen = sel?.penWeight ?? settings.penWeight;
  const dash = sel ? (sel.dash ?? "solid") : settings.dash;
  const color = sel ? (sel.color ?? "") : settings.color;
  const fill = sel ? (sel.fill ?? "") : settings.fill;
  const fillScale = sel?.fillScale ?? 1;
  const startCap = sel ? (sel.startEnding ?? "") : settings.startEnding;
  const endCap = sel ? (sel.endEnding ?? "") : settings.endEnding;
  const caps: [string, string][] = [
    ["", "None"],
    ["arrow", "Arrow"],
    ["open", "Open"],
    ["tick", "Tick"],
    ["dot", "Dot"],
  ];

  const apply = (changes: Partial<StyleRef>, defaults: () => void) => {
    defaults();
    if (sel) styleSelection(changes);
  };

  return (
    <Palette id="attributes" title="Attributes" initial={{ x: window.innerWidth - 190, y: 400 }} onClose={onClose}>
      <div className="flex w-[176px] flex-col gap-1 p-2">
        {sel && <p className="text-[10px] text-[#666]">Editing the selection</p>}
        <label className="flex items-center justify-between">
          Pen
          <select className="mac-field w-[100px]" value={String(pen)} onChange={(e) => apply({ penWeight: +e.target.value }, () => set("penWeight", +e.target.value))}>
            {PEN_WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w.toFixed(2)} mm
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between">
          Line
          <select className="mac-field w-[100px]" value={dash} onChange={(e) => apply({ dash: e.target.value === "solid" ? "" : e.target.value }, () => set("dash", e.target.value))}>
            {Object.keys(DASH_PATTERNS).map((d) => (
              <option key={d} value={d}>
                {d[0].toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between">
          Colour
          <select className="mac-field w-[100px]" value={color} onChange={(e) => apply({ color: e.target.value }, () => set("color", e.target.value))}>
            {COLORS.map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between">
          Fill
          <select className="mac-field w-[100px]" value={fill} onChange={(e) => apply({ fill: e.target.value }, () => set("fill", e.target.value))}>
            <option value="">None</option>
            {PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {sel && fill && (
          <label className="flex items-center justify-between">
            Pattern size
            <select className="mac-field w-[100px]" value={String(fillScale)} onChange={(e) => styleSelection({ fillScale: +e.target.value === 1 ? undefined : +e.target.value })}>
              {[0.25, 0.5, 1, 2, 4, 8].map((k) => (
                <option key={k} value={k}>
                  × {k}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center justify-between">
          Start
          <select className="mac-field w-[100px]" value={startCap} onChange={(e) => apply({ startEnding: (e.target.value || undefined) as LineEnding | undefined }, () => set("startEnding", (e.target.value || "") as "" | LineEnding))}>
            {caps.map(([v, name]) => (
              <option key={v} value={v}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between">
          End
          <select className="mac-field w-[100px]" value={endCap} onChange={(e) => apply({ endEnding: (e.target.value || undefined) as LineEnding | undefined }, () => set("endEnding", (e.target.value || "") as "" | LineEnding))}>
            {caps.map(([v, name]) => (
              <option key={v || "none"} value={v}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[10px] leading-tight text-[#666]">Arrows sit on open lines, arcs and curves. Fills apply to closed shapes and walls.</p>
      </div>
    </Palette>
  );
}
