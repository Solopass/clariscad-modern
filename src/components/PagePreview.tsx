// The sheet, fitted into a canvas. The on-screen page and the Plot dialog both
// draw with drawGrid, drawEntities and drawTitleBlock, so the preview is the page.
import { useEffect, useRef } from "react";
import { STANDARDS } from "../kernel/dimensions";
import { fitBox } from "../canvas/camera";
import { CLASSIC, drawEntities, drawGrid, drawTitleBlock } from "../canvas/render";
import { sheetBounds, sheetPages } from "../state/sheetModel";
import { useDocumentStore } from "../state/useDocumentStore";

export function PagePreview({ height = 220 }: { height?: number }) {
  const doc = useDocumentStore((s) => s.doc);
  const version = useDocumentStore((s) => s.version);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = canvas.clientWidth || 320;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cam = fitBox({ cx: 0, cy: 0, zoom: 1, width, height }, sheetBounds(doc), 10);
    const ds = useDocumentStore.getState();
    drawGrid(ctx, cam, CLASSIC, 25.4, false, sheetPages(doc));
    drawEntities(ctx, doc.entities.filter((e) => !e.bufferOf), {
      cam,
      theme: CLASSIC,
      layers: new Map(doc.layers.map((l) => [l.id, l])),
      symbols: ds.index.ctx ?? {},
      showWeights: false,
      dimStyle: STANDARDS[doc.standard] ?? STANDARDS.ANSI,
      units: doc.units,
    });
    drawTitleBlock(ctx, cam, doc);
  }, [doc, version, height]);

  return <canvas ref={ref} className="block w-full border border-black bg-[#c0c0c0]" style={{ height }} aria-label="Page preview" />;
}
