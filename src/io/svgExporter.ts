// True-size SVG: one paper millimetre per SVG unit, with width/height in mm.
import type { DisplayList, Mark } from "./plot";
import { PEN_BY_COLOR } from "./plot";

export interface PlotStyle {
  /** Model mm per paper mm (48 = 1/4" = 1'-0"). */
  scale: number;
  /** Paper margin around the drawing, mm. */
  margin?: number;
  /** Plot everything black. */
  monochrome?: boolean;
  /** Use the colour → pen width table instead of each object's pen. */
  penByColor?: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function penFor(m: { pen: number; color: string }, st: PlotStyle): number {
  return st.penByColor ? (PEN_BY_COLOR[m.color.toLowerCase()] ?? m.pen) : m.pen;
}
export const colorFor = (c: string, st: PlotStyle) => (st.monochrome ? "#000000" : c);

export function exportSvg(dl: DisplayList, st: PlotStyle): string {
  const margin = st.margin ?? 10;
  const b = dl.bbox ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const s = st.scale;
  const W = (b.maxX - b.minX) / s + 2 * margin;
  const H = (b.maxY - b.minY) / s + 2 * margin;
  // Model (y up) → paper (y down) in mm.
  const X = (x: number) => (x - b.minX) / s + margin;
  const Y = (y: number) => (b.maxY - y) / s + margin;

  const body: string[] = [];
  const mark = (m: Mark) => {
    switch (m.t) {
      case "stroke": {
        const d = m.pts.map((p, i) => `${i ? "L" : "M"}${f(X(p.x))} ${f(Y(p.y))}`).join("") + (m.closed ? "Z" : "");
        const dash = m.dash ? ` stroke-dasharray="${m.dash.map(f).join(" ")}"` : "";
        body.push(`<path d="${d}" fill="none" stroke="${colorFor(m.color, st)}" stroke-width="${f(penFor(m, st))}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
        return;
      }
      case "fill": {
        const d = m.rings.map((r) => r.map((p, i) => `${i ? "L" : "M"}${f(X(p.x))} ${f(Y(p.y))}`).join("") + "Z").join("");
        body.push(`<path d="${d}" fill="${colorFor(m.color, st)}" fill-rule="evenodd"/>`);
        return;
      }
      case "dot":
        body.push(`<circle cx="${f(X(m.p.x))}" cy="${f(Y(m.p.y))}" r="${f(m.r)}" fill="${colorFor(m.color, st)}"/>`);
        return;
      case "text": {
        const anchor = m.align === "left" ? "start" : m.align === "center" ? "middle" : "end";
        const deg = (-m.angle * 180) / Math.PI;
        body.push(
          `<text x="${f(X(m.pos.x))}" y="${f(Y(m.pos.y))}" font-family="Helvetica, Arial, sans-serif" font-size="${f(m.height / s)}" text-anchor="${anchor}" fill="${colorFor(m.color, st)}" transform="rotate(${f(deg)} ${f(X(m.pos.x))} ${f(Y(m.pos.y))})">${esc(m.str)}</text>`,
        );
        return;
      }
    }
  };
  for (const m of dl.marks) mark(m);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">
<rect width="100%" height="100%" fill="#ffffff"/>
${body.join("\n")}
</svg>
`;
}
