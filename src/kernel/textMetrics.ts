// Text measurement shared by the canvas, hit-testing, PDF and DXF: Helvetica
// advance widths (Adobe AFM, 1/1000 em). Text "height" everywhere in this app
// is the em size, so a string's width = sum(widths) / 1000 × height.
import type { Vec2 } from "./vec";
import { add, rotate } from "./vec";

const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p-z { | } ~
];
const EXTRA: Record<string, number> = { "°": 400, "±": 584, "Ø": 778, "⌀": 778, "×": 584, "½": 834, "¼": 834, "¾": 834, "′": 191, "″": 355 };

export function charWidth(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c >= 32 && c <= 126) return ASCII[c - 32];
  return EXTRA[ch] ?? 556;
}

/** Width of `str` at em size `h`. */
export function textWidth(str: string, h: number): number {
  let w = 0;
  for (const ch of str) w += charWidth(ch);
  return (w / 1000) * h;
}

export type TextAlign = "left" | "center" | "right";

/**
 * Corners of a text box (CCW from bottom-left). The anchor is on the baseline at
 * the left, centre or right; the box runs from 0.22 em below the baseline
 * (descenders) to 0.78 em above it.
 */
export function textBoxCorners(anchor: Vec2, str: string, h: number, angle: number, align: TextAlign = "left"): Vec2[] {
  const w = textWidth(str, h);
  const x0 = align === "left" ? 0 : align === "center" ? -w / 2 : -w;
  const lo = -0.22 * h;
  const hi = 0.78 * h;
  return [
    { x: x0, y: lo },
    { x: x0 + w, y: lo },
    { x: x0 + w, y: hi },
    { x: x0, y: hi },
  ].map((p) => add(anchor, rotate(p, angle)));
}
