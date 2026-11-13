// Layers palette: visibility, lock, colour, name, drawing scale, active layer.
import { useState } from "react";
import { useDocumentStore } from "../state/useDocumentStore";
import { SCALE_PRESETS, addLayer, deleteLayer, moveLayer, moveSelectionToLayer, scaleLabel, setActiveLayer, updateLayer } from "../state/layers";
import { COLORS } from "../state/attributes";
import { parseNumber } from "../kernel/units";
import { Palette } from "./Palette";

export function LayersPalette({ onClose }: { onClose(): void }) {
  const layers = useDocumentStore((s) => s.doc.layers);
  const active = useDocumentStore((s) => s.doc.activeLayerId);
  const hasSelection = useDocumentStore((s) => s.selection.size > 0);
  const counts = useDocumentStore((s) => {
    const m = new Map<string, number>();
    for (const e of s.doc.entities) m.set(e.layerId, (m.get(e.layerId) ?? 0) + 1);
    return JSON.stringify([...m]);
  });
  const count = new Map<string, number>(JSON.parse(counts));
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Palette id="layers" title="Layers" initial={{ x: Math.max(96, window.innerWidth - 472), y: 24 }} onClose={onClose}>
      <div className="w-[270px]">
        <div className="grid grid-cols-[18px_18px_18px_1fr_88px] items-center gap-x-1 border-b border-black px-1 py-[1px] text-[10px] font-bold">
          <span title="Visible">👁</span>
          <span title="Locked">🔒</span>
          <span title="Colour">■</span>
          <span>Name</span>
          <span>Scale</span>
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          {[...layers].reverse().map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[18px_18px_18px_1fr_88px] items-center gap-x-1 px-1 py-[1px]"
              style={{ background: l.id === active ? "#000" : undefined, color: l.id === active ? "#fff" : undefined }}
              onClick={() => setActiveLayer(l.id)}
            >
              <input type="checkbox" title="Visible" checked={l.visible} onClick={(e) => e.stopPropagation()} onChange={(e) => updateLayer(l.id, { visible: e.target.checked }, l.visible ? "Hide Layer" : "Show Layer")} />
              <input type="checkbox" title="Locked" checked={l.locked} onClick={(e) => e.stopPropagation()} onChange={(e) => updateLayer(l.id, { locked: e.target.checked }, l.locked ? "Unlock Layer" : "Lock Layer")} />
              <select
                title="Colour"
                className="w-[18px] appearance-none border border-black"
                style={{ background: l.color || "#000", color: "transparent" }}
                value={l.color ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateLayer(l.id, { color: e.target.value || undefined }, "Layer Colour")}
              >
                {COLORS.map(([v, name]) => (
                  <option key={v} value={v}>
                    {v ? name : "Black (default)"}
                  </option>
                ))}
              </select>
              {editing === l.id ? (
                <input
                  autoFocus
                  className="mac-field text-black"
                  defaultValue={l.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    setEditing(null);
                    if (e.target.value.trim()) updateLayer(l.id, { name: e.target.value.trim() }, "Rename Layer");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="truncate" onDoubleClick={() => setEditing(l.id)} title="Double-click to rename">
                  {l.name} <span className="text-[10px] opacity-60">({count.get(l.id) ?? 0})</span>
                </span>
              )}
              <select
                className="mac-field w-[88px] text-[10px] text-black"
                value={SCALE_PRESETS.some(([, v]) => v === l.scale) ? String(l.scale) : "custom"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  let v = Number(e.target.value);
                  if (e.target.value === "custom") {
                    const t = prompt("Drawing scale as 1:N — enter N", String(l.scale));
                    if (!t) return;
                    try {
                      v = parseNumber(t);
                    } catch {
                      return;
                    }
                  }
                  if (v > 0) updateLayer(l.id, { scale: v }, "Layer Scale");
                }}
              >
                {SCALE_PRESETS.map(([label, v]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
                <option value="custom">{SCALE_PRESETS.some(([, v]) => v === l.scale) ? "Custom…" : scaleLabel(l.scale)}</option>
              </select>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 border-t border-black p-1">
          <button className="mac-btn" onClick={() => addLayer()}>
            New
          </button>
          <button
            className="mac-btn"
            disabled={layers.length <= 1}
            onClick={() => {
              const l = layers.find((x) => x.id === active);
              const n = count.get(active) ?? 0;
              if (l && (n === 0 || confirm(`Delete "${l.name}" and the ${n} object(s) on it?`))) deleteLayer(active);
            }}
          >
            Delete
          </button>
          <button className="mac-btn" title="Move the active layer up" onClick={() => moveLayer(active, 1)}>
            ▲
          </button>
          <button className="mac-btn" title="Move the active layer down" onClick={() => moveLayer(active, -1)}>
            ▼
          </button>
          <button className="mac-btn" disabled={!hasSelection} onClick={() => moveSelectionToLayer(active)}>
            Move Selection Here
          </button>
        </div>
      </div>
    </Palette>
  );
}
