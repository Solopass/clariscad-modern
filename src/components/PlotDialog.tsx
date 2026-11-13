// Plot dialog: paper, orientation, scale, pen options → PDF or SVG.
import { useMemo, useState } from "react";
import { PAPER_SIZES } from "../io/plot";
import { SCALE_PRESETS } from "../state/layers";
import { useDocumentStore } from "../state/useDocumentStore";
import { exportPdfFile, exportSvgFile, plotLayout } from "../state/fileCommands";
import { MAX_SHEETS } from "../io/pdfPlotter";
import { PagePreview } from "./PagePreview";
import { TitleFields } from "./TitleBlockDialog";

const KEY = "temaricad.plot.v1";

export function PlotDialog({ onClose }: { onClose(): void }) {
  const activeScale = useDocumentStore((s) => s.doc.layers.find((l) => l.id === s.doc.activeLayerId)?.scale ?? 1);
  const [o, setO] = useState(() => {
    const def = { paper: "letter", landscape: true, scale: activeScale, fit: false, monochrome: false, penByColor: false };
    try {
      return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? "{}"), scale: activeScale };
    } catch {
      return def;
    }
  });
  const set = (p: Partial<typeof o>) => {
    const next = { ...o, ...p };
    setO(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const paper = PAPER_SIZES.find((p) => p.id === o.paper) ?? PAPER_SIZES[0];
  const opts = { ...o, paper };
  const info = useMemo(() => {
    const L = plotLayout(opts);
    const pages = L.cols * L.rows;
    return { pages, scale: L.scale, error: pages > MAX_SHEETS ? `This would need ${pages} sheets. Choose a smaller scale, a bigger sheet, or Fit to one sheet.` : "" };
  }, [o.paper, o.landscape, o.scale, o.fit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/10 pt-20" onPointerDown={onClose}>
      <div className="mac-frame p-[3px]" style={{ outline: "1px solid #000", outlineOffset: -4 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex w-[680px] gap-3 p-3">
          <div className="w-[320px] shrink-0">
            <PagePreview height={280} />
          </div>
          <div className="flex w-[280px] shrink-0 flex-col gap-2">
          <b>Plot</b>
          <label className="flex items-center justify-between">
            Paper
            <select className="mac-field w-[200px]" value={o.paper} onChange={(e) => set({ paper: e.target.value })}>
              {PAPER_SIZES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between">
            Orientation
            <select className="mac-field w-[200px]" value={o.landscape ? "l" : "p"} onChange={(e) => set({ landscape: e.target.value === "l" })}>
              <option value="p">Portrait</option>
              <option value="l">Landscape</option>
            </select>
          </label>
          <label className="flex items-center justify-between">
            Scale
            <select
              className="mac-field w-[200px]"
              value={o.fit ? "fit" : String(o.scale)}
              onChange={(e) => (e.target.value === "fit" ? set({ fit: true }) : set({ fit: false, scale: +e.target.value }))}
            >
              <option value="fit">Fit to one sheet</option>
              {SCALE_PRESETS.map(([label, v]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={o.monochrome} onChange={(e) => set({ monochrome: e.target.checked })} />
            Black and white
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={o.penByColor} onChange={(e) => set({ penByColor: e.target.checked })} />
            Pen widths by colour (black 0.35, blue 0.50, red 0.18 mm …)
          </label>
          <b className="mt-1">Title block</b>
          <TitleFields compact />
          <p className="text-[11px] text-[#444]">
            {info.error
              ? info.error
              : `${info.pages} sheet${info.pages === 1 ? "" : "s"}${o.fit ? ` at 1:${+info.scale.toFixed(2)}` : ""}${info.pages > 1 ? " (tiled, with sheet labels)" : ""}`}
          </p>
          <div className="mt-2 flex justify-end gap-3">
            <button className="mac-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="mac-btn"
              onClick={async () => {
                onClose();
                await exportSvgFile({ scale: o.fit ? info.scale : o.scale, monochrome: o.monochrome, penByColor: o.penByColor });
              }}
            >
              Save SVG…
            </button>
            <button
              className="mac-btn"
              style={{ boxShadow: "0 0 0 2px #fff, 0 0 0 3px #000" }}
              disabled={!!info.error}
              onClick={async () => {
                onClose();
                try {
                  await exportPdfFile(opts);
                } catch (e) {
                  window.alert((e as Error).message);
                }
              }}
            >
              Save PDF…
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
