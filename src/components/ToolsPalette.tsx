// Left tool palette. Each tool shows its current Method; press-and-hold
// (or right-click) pops out the Method list, like the original's pop-out tools.
import { useRef, useState } from "react";
import { TOOLS } from "../tools/defs";
import { useToolStore, type ToolId } from "../state/useToolStore";
import { ToolIcon } from "./Icons";
import { Palette } from "./Palette";

export function ToolsPalette() {
  const tool = useToolStore((s) => s.tool);
  const methods = useToolStore((s) => s.methods);
  const setTool = useToolStore((s) => s.setTool);
  const setMethod = useToolStore((s) => s.setMethod);
  const [popup, setPopup] = useState<{ id: ToolId; x: number; y: number } | null>(null);
  const hold = useRef<number>(0);

  const open = (id: ToolId, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPopup({ id, x: r.right + 2, y: r.top });
  };

  return (
    <>
      <Palette id="tools" title="Tools" initial={{ x: 8, y: 64 }}>
        <div className="grid grid-cols-2">
          {TOOLS.map((t) => {
            const active = tool === t.id;
            const multi = t.methods.length > 1;
            return (
              <button
                key={t.id}
                title={`${t.label} (${t.key.toUpperCase()})${multi ? " – hold for methods" : ""}`}
                aria-pressed={active}
                className="relative flex h-[30px] w-[30px] items-center justify-center border-r border-b border-black"
                style={{ background: active ? "#000" : "#fff", color: active ? "#fff" : "#000" }}
                onPointerDown={(e) => {
                  const el = e.currentTarget;
                  hold.current = window.setTimeout(() => multi && open(t.id, el), 350);
                }}
                onPointerUp={() => {
                  clearTimeout(hold.current);
                  if (!popup) setTool(t.id);
                }}
                onPointerLeave={() => clearTimeout(hold.current)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (multi) open(t.id, e.currentTarget);
                }}
              >
                <ToolIcon id={t.id} />
                {multi && (
                  <svg className="absolute right-[1px] bottom-[1px]" width="5" height="5" viewBox="0 0 5 5">
                    <path d="M5 0 L5 5 L0 5 Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </Palette>
      {popup && (
        <div className="fixed inset-0 z-40" onPointerDown={() => setPopup(null)}>
          <div className="mac-frame absolute py-[2px]" style={{ left: popup.x, top: popup.y }} onPointerDown={(e) => e.stopPropagation()}>
            {TOOLS.find((t) => t.id === popup.id)!.methods.map((m) => (
              <div
                key={m.id}
                className="mac-menu-item cursor-default px-3 py-[1px] whitespace-nowrap"
                onPointerUp={() => {
                  setMethod(popup.id, m.id);
                  setPopup(null);
                }}
              >
                {methods[popup.id] === m.id ? "✓ " : " "}
                {m.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
