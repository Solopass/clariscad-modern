// Coordinates HUD (bottom bar): live X, Y, ΔX, ΔY, Length, Angle.
// Tab jumps into the fields; typed values (any unit expression) lock that
// field, and Enter places the point for the active tool.
import { useEffect, useRef, useState } from "react";
import { formatLength, parseAngle, parseLength } from "../kernel/units";
import { type Vec2, angleOf, dist, fromAngle, add } from "../kernel/vec";
import { useCursorStore } from "../state/useCursorStore";
import { useDocumentStore } from "../state/useDocumentStore";
import { zoomAtPaperSize } from "../state/sheetModel";
import { viewportRef } from "../canvas/controller";

type Field = "x" | "y" | "dx" | "dy" | "len" | "ang";
const FIELDS: { id: Field; label: string; angle?: boolean }[] = [
  { id: "x", label: "X" },
  { id: "y", label: "Y" },
  { id: "dx", label: "ΔX" },
  { id: "dy", label: "ΔY" },
  { id: "len", label: "Length" },
  { id: "ang", label: "Angle", angle: true },
];

export function CoordinatesHUD({ keysOpen, onToggleKeys }: { keysOpen?: boolean; onToggleKeys?(): void }) {
  const point = useCursorStore((s) => s.point);
  const from = useCursorStore((s) => s.from);
  const snapLabel = useCursorStore((s) => s.snapLabel);
  const prompt = useCursorStore((s) => s.prompt);
  const units = useDocumentStore((s) => s.doc.units);
  const doc = useDocumentStore((s) => s.doc);
  const editing = doc.entities.some((e) => e.bufferOf);
  const view = useCursorStore((s) => s.view);
  const zoomPct = Math.round((view.zoom / zoomAtPaperSize(doc)) * 100);
  const [edits, setEdits] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  const base = from ?? { x: 0, y: 0 };
  const live: Record<Field, string> = {
    x: formatLength(point.x, units),
    y: formatLength(point.y, units),
    dx: formatLength(point.x - base.x, units),
    dy: formatLength(point.y - base.y, units),
    len: formatLength(dist(base, point), units),
    ang: `${(((angleOf({ x: point.x - base.x, y: point.y - base.y }) * 180) / Math.PI + 360) % 360).toFixed(2)}°`,
  };

  // Tab from the drawing jumps into the HUD.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Tab" || (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA"))) return;
      e.preventDefault();
      const f = useCursorStore.getState().from ? "len" : "x";
      refs.current[f]?.focus();
      refs.current[f]?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    try {
      const num = (f: Field) => (edits[f] !== undefined ? (f === "ang" ? parseAngle(edits[f]!) : parseLength(edits[f]!, units)) : undefined);
      const x = num("x");
      const y = num("y");
      const dx = num("dx");
      const dy = num("dy");
      const len = num("len");
      const ang = num("ang");
      let p: Vec2;
      if (len !== undefined || ang !== undefined) {
        const L = len ?? dist(base, point);
        const A = ang ?? angleOf({ x: point.x - base.x, y: point.y - base.y });
        p = add(base, fromAngle(A, L));
      } else if (dx !== undefined || dy !== undefined) {
        p = { x: base.x + (dx ?? point.x - base.x), y: base.y + (dy ?? point.y - base.y) };
      } else {
        p = { x: x ?? point.x, y: y ?? point.y };
      }
      viewportRef.current?.typedPoint(p);
      setEdits({});
      setError("");
      // Stay in the HUD for the next point of a multi-point command.
      const f = viewportRef.current?.currentFrom() ? "len" : "x";
      requestAnimationFrame(() => refs.current[f]?.select());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-[26px] items-center gap-2 border-t border-black bg-white px-2">
      {FIELDS.map((f) => (
        <label key={f.id} className="inline-flex items-center gap-1">
          <span className="text-[11px]">{f.label}</span>
          <input
            ref={(el) => {
              refs.current[f.id] = el;
            }}
            aria-label={f.label}
            className={`mac-field font-mono text-[11px] ${edits[f.id] !== undefined ? "locked" : ""}`}
            style={{ width: f.angle ? 54 : 76 }}
            value={edits[f.id] ?? live[f.id]}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setEdits({ ...edits, [f.id]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setEdits({});
                setError("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </label>
      ))}
      <span className="w-[38px] shrink-0 font-mono text-[10px] font-bold text-[#d6001c]">{snapLabel}</span>
      <span className="shrink-0 font-mono text-[11px]" title="Zoom. 100% is paper size: one inch on the page is one inch on the screen.">
        {Number.isFinite(zoomPct) ? `${zoomPct}%` : ""}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: error ? "#d6001c" : "#333" }} title={error || prompt}>
        {error || (editing ? "Editing symbol — changes update every copy. Alt+Shift+E finishes." : prompt)}
      </span>
      {onToggleKeys && (
        <button
          className="mac-btn shrink-0 px-1.5 py-0 text-[10px] leading-[16px]"
          style={keysOpen ? { background: "#000", color: "#fff" } : undefined}
          onClick={onToggleKeys}
          title="Toggle keyboard shortcuts (Ctrl+/)"
        >
          Keys
        </button>
      )}
    </div>
  );
}
