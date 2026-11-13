// Context bar under the menus: the active tool's Methods plus the settings
// that Method uses (width, sides, radius, angle).
import { toolDef } from "../tools/defs";
import { useToolStore } from "../state/useToolStore";
import { LengthField } from "./LengthField";
import { ToolIcon } from "./Icons";

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange(v: string): void }) {
  return (
    <label className="inline-flex items-center gap-1">
      {label}
      <select className="mac-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MethodsBar() {
  const tool = useToolStore((s) => s.tool);
  const method = useToolStore((s) => s.methods[s.tool]);
  const settings = useToolStore((s) => s.settings);
  const setMethod = useToolStore((s) => s.setMethod);
  const set = useToolStore((s) => s.setSetting);
  const def = toolDef(tool);

  return (
    <div className="flex h-[28px] items-center gap-2 border-b border-black bg-white px-2">
      <ToolIcon id={tool} />
      <b className="mr-1">{def.label}</b>
      <div className="flex" role="radiogroup" aria-label="Method">
        {def.methods.map((m, i) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={m.id === method}
            className="border border-black px-2 py-[1px]"
            style={{
              marginLeft: i ? -1 : 0,
              background: m.id === method ? "#000" : "#fff",
              color: m.id === method ? "#fff" : "#000",
              borderRadius: def.methods.length === 1 ? 4 : i === 0 ? "4px 0 0 4px" : i === def.methods.length - 1 ? "0 4px 4px 0" : 0,
            }}
            onClick={() => setMethod(tool, m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="ml-2 flex items-center gap-3">
        {tool === "doubleLine" && (
          <>
            <LengthField label="Width" value={settings.doubleLineWidth} min={0.001} onChange={(v) => set("doubleLineWidth", v)} />
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={settings.doubleLineCaps} onChange={(e) => set("doubleLineCaps", e.target.checked)} />
              End caps
            </label>
          </>
        )}
        {tool === "rect" && <LengthField label="Corner radius" value={settings.cornerRadius} min={0} onChange={(v) => set("cornerRadius", v)} />}
        {tool === "polygon" && <LengthField label="Sides" kind="count" width={40} value={settings.polygonSides} min={3} max={64} onChange={(v) => set("polygonSides", v)} />}
        {((tool === "arc" && method === "startEndRadius") || (tool === "circle" && method === "ttr")) && (
          <LengthField label="Radius" value={settings.arcRadius} min={0.001} onChange={(v) => set("arcRadius", v)} />
        )}
        {tool === "guide" && method === "angled" && <LengthField label="Angle" kind="angle" width={60} value={settings.guideAngle} onChange={(v) => set("guideAngle", v)} />}
        {tool === "wall" && method !== "opening" && (
          <>
            <LengthField label="Thickness" value={settings.wallThickness} min={0.001} onChange={(v) => set("wallThickness", v)} />
            <Choice
              label="Draw along"
              value={settings.wallJustify}
              options={[
                ["center", "Center"],
                ["left", "Left face"],
                ["right", "Right face"],
              ]}
              onChange={(v) => set("wallJustify", v as "center" | "left" | "right")}
            />
          </>
        )}
        {tool === "wall" && method === "opening" && <LengthField label="Opening width" value={settings.openingWidth} min={0.001} onChange={(v) => set("openingWidth", v)} />}
        {tool === "offset" && (
          <LengthField label="Distance (0 = through point)" value={settings.offsetDistance} min={0} onChange={(v) => set("offsetDistance", v)} />
        )}
        {(tool === "fillet" || tool === "chamfer") && (
          <Choice
            label="Trim"
            value={settings.trimMode}
            options={[
              ["both", "Both"],
              ["first", "First only"],
              ["none", "No trim"],
            ]}
            onChange={(v) => set("trimMode", v as "both" | "first" | "none")}
          />
        )}
        {tool === "fillet" && <LengthField label="Radius" value={settings.filletRadius} min={0} onChange={(v) => set("filletRadius", v)} />}
        {tool === "chamfer" && (
          <>
            <LengthField label="Distance 1" value={settings.chamferD1} min={0} onChange={(v) => set("chamferD1", v)} />
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={settings.chamferByAngle} onChange={(e) => set("chamferByAngle", e.target.checked)} />
              By angle
            </label>
            {settings.chamferByAngle ? (
              <LengthField label="Angle" kind="angle" width={60} value={settings.chamferAngle} min={0.1} max={89.9} onChange={(v) => set("chamferAngle", v)} />
            ) : (
              <LengthField label="Distance 2" value={settings.chamferD2} min={0} onChange={(v) => set("chamferD2", v)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
