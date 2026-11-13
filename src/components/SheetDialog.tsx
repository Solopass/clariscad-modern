// Layout ▸ Rulers & Drawing Size. The sheet is the page you see on the pasteboard.
// The ruler scale is the active layer's scale: it sizes the page and the annotations.
// Geometry stays in one model space, so a line is the same length on every layer.
import { useState } from "react";
import { PAPER_SIZES } from "../io/plot";
import { SCALE_PRESETS, scaleLabel } from "../state/layers";
import { applySheet } from "../state/sheet";
import { normalizeSheet } from "../state/sheetModel";
import { useDocumentStore } from "../state/useDocumentStore";

export function SheetDialog({ onClose }: { onClose(): void }) {
  const doc = useDocumentStore((s) => s.doc);
  const active = doc.layers.find((l) => l.id === doc.activeLayerId);
  const [sheet, setSheet] = useState(() => normalizeSheet(doc.sheet));
  const [scale, setScale] = useState(active?.scale ?? 48);
  const set = (p: Partial<typeof sheet>) => setSheet({ ...sheet, ...p });
  const known = SCALE_PRESETS.some(([, v]) => Math.abs(v - scale) < 1e-9);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/10 pt-16" onPointerDown={onClose}>
      <div className="mac-frame p-[3px]" style={{ outline: "1px solid #000", outlineOffset: -4 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex w-[380px] flex-col gap-2 p-4">
          <b>Rulers & Drawing Size</b>
          <p className="text-[11px] text-[#444]">
            Pages start at the origin, lower left, and tile up and to the right. The ruler scale is the active layer’s ({active?.name ?? "layer"}). It
            sizes the page and dimensions; objects keep their real length so snaps work across layers.
          </p>
          <label className="flex items-center justify-between">
            Paper
            <select className="mac-field w-[210px]" value={sheet.paperId} onChange={(e) => set({ paperId: e.target.value })}>
              {PAPER_SIZES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between">
            Orientation
            <select className="mac-field w-[210px]" value={sheet.landscape ? "l" : "p"} onChange={(e) => set({ landscape: e.target.value === "l" })}>
              <option value="p">Portrait</option>
              <option value="l">Landscape</option>
            </select>
          </label>
          <label className="flex items-center justify-between">
            Pages across
            <input
              className="mac-field w-[210px]"
              value={sheet.pagesX}
              onChange={(e) => set({ pagesX: Math.max(1, Math.min(25, Math.round(Number(e.target.value) || 1))) })}
            />
          </label>
          <label className="flex items-center justify-between">
            Pages up
            <input
              className="mac-field w-[210px]"
              value={sheet.pagesY}
              onChange={(e) => set({ pagesY: Math.max(1, Math.min(25, Math.round(Number(e.target.value) || 1))) })}
            />
          </label>
          <label className="flex items-center justify-between">
            Ruler scale
            <select className="mac-field w-[210px]" value={known ? String(scale) : "custom"} onChange={(e) => e.target.value !== "custom" && setScale(+e.target.value)}>
              {!known && <option value="custom">{scaleLabel(scale)}</option>}
              {SCALE_PRESETS.map(([label, v]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 flex justify-end gap-3">
            <button className="mac-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="mac-btn"
              style={{ boxShadow: "0 0 0 2px #fff, 0 0 0 3px #000" }}
              onClick={() => {
                applySheet(sheet, scale);
                onClose();
              }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
