// File menu commands: New, Open, Save, Save As, DXF import/export, plotting.
import { useDocumentStore, newDocument } from "./useDocumentStore";
import { FILE_EXT, parseDocument, serializeDocument } from "../io/nativeJson";
import { decodeDxf, exportDxf, importDxf } from "../io/dxfCodec";
import { buildDisplayList } from "../io/plot";
import { exportSvg, type PlotStyle } from "../io/svgExporter";
import { plotPdf, sheetLayout, type PdfOptions } from "../io/pdfPlotter";
import { entityBBox, unionBox } from "../kernel/prims";
import { STANDARDS } from "../kernel/dimensions";
import { CLASSIC, drawEntities } from "../canvas/render";
import { sheetBounds } from "./sheetModel";
import { pdfBytes } from "../io/pdfWriter";
import { isTauri, openFile, saveFile } from "../io/platform";
import { clearRecovery } from "../io/recovery";

const store = () => useDocumentStore.getState();
const DRAWING = { name: "TemariCad Drawing", extensions: [FILE_EXT] };
const DXF = { name: "DXF (AutoCAD R12)", extensions: ["dxf"] };

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** Browser: the open drawing's own file handle (null for new, imported or restored drawings). */
let docHandle: unknown = null;
export const forgetFileHandle = () => {
  docHandle = null;
};

/** OK to throw away the current drawing? */
export function confirmDiscard(action = "continue"): boolean {
  if (!store().isDirty()) return true;
  return window.confirm(`"${store().fileName}" has unsaved changes. Discard them and ${action}?`);
}

export function newDrawing() {
  if (!confirmDiscard("start a new drawing")) return;
  store().load(newDocument());
  docHandle = null;
  void clearRecovery();
}

export async function openDrawing() {
  if (!confirmDiscard("open another drawing")) return;
  const f = await openFile([DRAWING, DXF, { name: "All files", extensions: ["*"] }]);
  if (!f) return;
  try {
    if (/\.dxf$/i.test(f.name)) {
      const r = importDxf(decodeDxf(f.bytes));
      // An imported DXF is a new, unsaved drawing.
      store().load(r.doc, { name: `${stem(f.name)}.${FILE_EXT}`, path: null, dirty: true });
      docHandle = null;
      const n = r.doc.entities.length;
      window.alert(`Imported ${n} object(s) and ${r.doc.symbols.length} block(s) from ${f.name}.${r.warnings.length ? "\n\n" + r.warnings.join("\n") : ""}`);
    } else {
      const r = parseDocument(new TextDecoder("utf-8").decode(f.bytes));
      store().load(r.doc, { name: f.name, path: f.path });
      docHandle = f.handle ?? null;
      if (r.warnings.length) window.alert(r.warnings.join("\n"));
    }
    void clearRecovery();
  } catch (e) {
    window.alert((e as Error).message);
  }
}

async function writeDrawing(ask: boolean) {
  const s = store();
  const name = /\.tcad$/i.test(s.fileName) ? s.fileName : `${stem(s.fileName)}.${FILE_EXT}`;
  const r = await saveFile({ suggestedName: name, filters: [DRAWING], data: serializeDocument(s.doc), path: s.filePath, handle: docHandle, ask });
  if (!r) return false;
  if (r.handle) docHandle = r.handle;
  store().markSaved({ name: r.name, path: r.path ?? s.filePath });
  void clearRecovery();
  return true;
}

/** Save to the current file (asks where the first time). */
export const saveDrawing = () => {
  const s = store();
  // Ask where unless this drawing has its own file (desktop: a path; browser: a handle).
  const ask = isTauri() ? !s.filePath : !docHandle;
  return writeDrawing(ask);
};
export const saveDrawingAs = () => writeDrawing(true);

export async function exportDxfFile() {
  const s = store();
  await saveFile({ suggestedName: `${stem(s.fileName)}.dxf`, filters: [DXF], data: exportDxf(s.doc, s.index.ctx ?? {}) });
}

/** A picture of the drawing (white background, true pen weights). Guides are left out. */
export async function exportPngFile() {
  const s = store();
  const real = s.doc.entities.some((e) => e.kind !== "guide");
  let box = real ? plotExtent() : sheetBounds(s.doc);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  const pad = span * 0.04;
  box = { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const zoom = Math.min(3200 / w, 3200 / h);
  const width = Math.max(2, Math.round(w * zoom));
  const height = Math.max(2, Math.round(h * zoom));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  drawEntities(
    ctx,
    s.doc.entities.filter((e) => e.kind !== "guide"),
    {
      cam: { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, zoom, width, height },
      theme: CLASSIC,
      layers: new Map(s.doc.layers.map((l) => [l.id, l])),
      symbols: s.index.ctx ?? {},
      showWeights: true,
      dimStyle: STANDARDS[s.doc.standard] ?? STANDARDS.ANSI,
      units: s.doc.units,
    },
  );
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return;
  await saveFile({
    suggestedName: `${stem(s.fileName)}.png`,
    filters: [{ name: "PNG", extensions: ["png"] }],
    data: new Uint8Array(await blob.arrayBuffer()),
  });
}

/** Plot: tolerance follows the plot scale so curves stay smooth on paper. */
function displayList(scale: number) {
  const s = store();
  return buildDisplayList(s.doc, s.index.ctx ?? {}, Math.max(1e-4, 0.02 * scale));
}

export async function exportSvgFile(st: PlotStyle) {
  const s = store();
  await saveFile({ suggestedName: `${stem(s.fileName)}.svg`, filters: [{ name: "SVG", extensions: ["svg"] }], data: exportSvg(displayList(st.scale), st) });
}

/** Extent of what plots (visible, non-guide entities). */
export function plotExtent() {
  const s = store();
  const hidden = new Set(s.doc.layers.filter((l) => !l.visible).map((l) => l.id));
  let box: ReturnType<typeof entityBBox> = null;
  for (const e of s.doc.entities) {
    if (e.kind === "guide" || hidden.has(e.layerId)) continue;
    const b = entityBBox(e, s.index.ctx);
    if (b) box = box ? unionBox(box, b) : b;
  }
  return box ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

/** Sheets and scale for these options, without building any geometry. */
export const plotLayout = (o: PdfOptions) => sheetLayout(plotExtent(), o);

export function previewPdf(o: PdfOptions) {
  const used = plotLayout(o).scale;
  return plotPdf(displayList(used), { ...o, title: stem(store().fileName) });
}

export async function exportPdfFile(o: PdfOptions) {
  const r = previewPdf(o);
  await saveFile({ suggestedName: `${stem(store().fileName)}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }], data: pdfBytes(r.pdf) });
  return r;
}
