// Top and left rulers in the drawing's units. 100% zoom is handled in the HUD;
// these just read the camera the viewport publishes when the view moves.
import { useEffect, useRef } from "react";
import type { UnitSystem } from "../kernel/types";
import { displayGridStep } from "../canvas/render";
import type { ViewSnap } from "../state/useCursorStore";
import { useCursorStore } from "../state/useCursorStore";
import { useDocumentStore } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";

function tickLabel(mm: number, units: UnitSystem): string {
  if (Math.abs(mm) < 1e-6) return "0";
  const sign = mm < 0 ? "-" : "";
  const a = Math.abs(mm);
  if (units === "architectural" || units === "inches") {
    const inches = a / 25.4;
    if (inches >= 12) {
      const feet = Math.round((inches / 12) * 100) / 100;
      return `${sign}${feet}'`;
    }
    const r = Math.round(inches * 4) / 4;
    return `${sign}${r}"`;
  }
  if (units === "engineering" || units === "feet") {
    const feet = Math.round((a / 304.8) * 100) / 100;
    return `${sign}${feet}'`;
  }
  if (units === "mm") return `${sign}${Math.round(a)}`;
  if (units === "cm") return `${sign}${(a / 10).toFixed(a >= 100 ? 0 : 1)}`;
  return `${sign}${(a / 1000).toFixed(a >= 10000 ? 0 : 2)}`;
}

function paint(canvas: HTMLCanvasElement, view: ViewSnap, units: UnitSystem, grid: number, side: "top" | "left") {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000";
  ctx.lineWidth = 1;
  ctx.font = "9px Geneva, sans-serif";
  const { step, major } = displayGridStep(grid > 0 ? grid : 25.4, view.zoom, side === "top" ? 56 : 36);
  const sx = (x: number) => ((x - view.cx) * view.zoom + view.width / 2) * (w / view.width);
  const sy = (y: number) => ((view.height / 2 - (y - view.cy) * view.zoom) * h) / view.height;
  const lo = side === "top" ? view.cx - view.width / 2 / view.zoom : view.cy - view.height / 2 / view.zoom;
  const hi = side === "top" ? view.cx + view.width / 2 / view.zoom : view.cy + view.height / 2 / view.zoom;
  const start = Math.floor(lo / step) * step;
  let lastLabel = -1e9;
  ctx.beginPath();
  for (let v = start; v <= hi + step; v += step) {
    const p = side === "top" ? sx(v) : sy(v);
    if (p < -20 || p > (side === "top" ? w : h) + 20) continue;
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-3 || Math.abs(v) < step * 0.25;
    const len = isMajor ? (side === "top" ? 12 : 14) : 6;
    if (side === "top") {
      ctx.moveTo(Math.round(p) + 0.5, h);
      ctx.lineTo(Math.round(p) + 0.5, h - len);
    } else {
      ctx.moveTo(w, Math.round(p) + 0.5);
      ctx.lineTo(w - len, Math.round(p) + 0.5);
    }
    const minGap = side === "top" ? 42 : 32;
    if (side === "top" ? p - lastLabel < minGap : Math.abs(p - lastLabel) < minGap) continue;
    lastLabel = p;
    const label = tickLabel(v, units);
    if (side === "top") ctx.fillText(label, p + 2, 9);
    else {
      ctx.save();
      ctx.translate(11, p - 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();
}

export function RulerCorner() {
  return <div className="h-[22px] w-[32px] shrink-0 border-r border-b border-black bg-white" />;
}

export function Ruler({ side }: { side: "top" | "left" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useCursorStore((s) => s.view);
  const units = useDocumentStore((s) => s.doc.units);
  const grid = useToolStore((s) => s.settings.gridSpacing);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => paint(c, view, units, grid, side);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [view, units, grid, side]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className={side === "top" ? "h-[22px] min-w-0 flex-1 border-b border-black bg-white" : "h-full w-[32px] shrink-0 border-r border-black bg-white"}
    />
  );
}
