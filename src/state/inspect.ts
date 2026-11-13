// Get Info: the numeric edit of whatever is selected. A pure move is stored as
// a transform so associative dimensions follow; changing a length or a radius
// rewrites the object itself.
import type { Entity } from "../kernel/types";
import { entityBBox, unionBox } from "../kernel/prims";
import { scaleAbout, transformEntity, translateEntity } from "../kernel/edit";
import { multiply, translation, type Transform2D } from "../kernel/transform";
import { formatLength } from "../kernel/units";
import { angleOf, dist } from "../kernel/vec";
import type { DialogField } from "../components/Dialog";
import { replacePatch } from "./ops";
import { useDocumentStore } from "./useDocumentStore";

const store = () => useDocumentStore.getState();

export interface InfoSpec {
  title: string;
  note: string;
  fields: DialogField[];
  apply(v: Record<string, number>): void;
}

const deg = (rad: number) => `${+(((rad * 180) / Math.PI + 360) % 360).toFixed(2)}°`;

function commitOne(before: Entity, after: Entity, transform?: Transform2D) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  store().commit(replacePatch("Get Info", [[before, after]], transform ? { transform } : {}));
}

function centerOf(ents: Entity[]): { x: number; y: number } | null {
  const { index } = store();
  let box = null;
  for (const e of ents) {
    const b = entityBBox(e, index.ctx);
    if (b) box = box ? unionBox(box, b) : b;
  }
  return box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : null;
}

function moveAll(ents: Entity[], from: { x: number; y: number }, to: { x: number; y: number }) {
  const d = { x: to.x - from.x, y: to.y - from.y };
  if (d.x === 0 && d.y === 0) return;
  const T = translation(d.x, d.y);
  store().commit(
    replacePatch(
      "Get Info",
      ents.map((e) => [e, translateEntity(e, d)]),
      { transform: T },
    ),
  );
}

/** Dialog contents for the current selection, or null when nothing is selected. */
export function describeSelection(): InfoSpec | null {
  const { doc, selection } = store();
  const ents = doc.entities.filter((e) => selection.has(e.id));
  if (!ents.length) return null;
  const units = doc.units;

  if (ents.length === 1) {
    const e = ents[0];
    if (e.kind === "line") {
      const len = dist(e.a, e.b);
      const ang = angleOf({ x: e.b.x - e.a.x, y: e.b.y - e.a.y });
      return {
        title: "Line",
        note: `Length ${formatLength(len, units)}, angle ${deg(ang)}`,
        fields: [
          { key: "x1", label: "Start X", kind: "length", value: e.a.x },
          { key: "y1", label: "Start Y", kind: "length", value: e.a.y },
          { key: "x2", label: "End X", kind: "length", value: e.b.x },
          { key: "y2", label: "End Y", kind: "length", value: e.b.y },
        ],
        apply: (v) => {
          const a = { x: v.x1, y: v.y1 };
          const b = { x: v.x2, y: v.y2 };
          const dx = a.x - e.a.x;
          const dy = a.y - e.a.y;
          const same = Math.abs(b.x - e.b.x - dx) < 1e-6 && Math.abs(b.y - e.b.y - dy) < 1e-6;
          if (same) commitOne(e, translateEntity(e, { x: dx, y: dy }), translation(dx, dy));
          else commitOne(e, { ...e, a, b });
        },
      };
    }
    if (e.kind === "circle") {
      return {
        title: "Circle",
        note: `Diameter ${formatLength(e.r * 2, units)}`,
        fields: [
          { key: "x", label: "Center X", kind: "length", value: e.center.x },
          { key: "y", label: "Center Y", kind: "length", value: e.center.y },
          { key: "r", label: "Radius", kind: "length", value: e.r },
        ],
        apply: (v) => {
          if (!(v.r > 0)) return;
          const k = v.r / e.r;
          const T = multiply(translation(v.x - e.center.x, v.y - e.center.y), scaleAbout(e.center, k));
          commitOne(e, transformEntity(e, T), T);
        },
      };
    }
    if (e.kind === "arc") {
      return {
        title: "Arc",
        note: `Radius ${formatLength(e.r, units)}, ${deg(e.start)} → ${deg(e.end)} CCW`,
        fields: [
          { key: "x", label: "Center X", kind: "length", value: e.center.x },
          { key: "y", label: "Center Y", kind: "length", value: e.center.y },
          { key: "r", label: "Radius", kind: "length", value: e.r },
          { key: "s", label: "Start angle", kind: "angle", value: e.start },
          { key: "en", label: "End angle", kind: "angle", value: e.end },
        ],
        apply: (v) => {
          if (!(v.r > 0)) return;
          const anglesSame = Math.abs(v.s - e.start) < 1e-9 && Math.abs(v.en - e.end) < 1e-9;
          if (anglesSame) {
            const k = v.r / e.r;
            const T = multiply(translation(v.x - e.center.x, v.y - e.center.y), scaleAbout(e.center, k));
            commitOne(e, transformEntity(e, T), T);
          } else {
            commitOne(e, { ...e, center: { x: v.x, y: v.y }, r: v.r, start: v.s, end: v.en });
          }
        },
      };
    }
    if (e.kind === "rect") {
      return {
        title: "Rectangle",
        note: e.cornerRadius > 0 ? `Corner radius ${formatLength(e.cornerRadius, units)}` : "Square corners",
        fields: [
          { key: "x", label: "Center X", kind: "length", value: e.center.x },
          { key: "y", label: "Center Y", kind: "length", value: e.center.y },
          { key: "w", label: "Width", kind: "length", value: e.width },
          { key: "h", label: "Height", kind: "length", value: e.height },
          { key: "a", label: "Rotation", kind: "angle", value: e.rotation },
          { key: "c", label: "Corner radius", kind: "length", value: e.cornerRadius },
        ],
        apply: (v) => {
          if (!(v.w > 0) || !(v.h > 0) || v.c < 0) return;
          const moved = Math.abs(v.w - e.width) < 1e-6 && Math.abs(v.h - e.height) < 1e-6 && Math.abs(v.a - e.rotation) < 1e-9 && Math.abs(v.c - e.cornerRadius) < 1e-6;
          if (moved) {
            const d = { x: v.x - e.center.x, y: v.y - e.center.y };
            commitOne(e, translateEntity(e, d), translation(d.x, d.y));
          } else {
            commitOne(e, { ...e, center: { x: v.x, y: v.y }, width: v.w, height: v.h, rotation: v.a, cornerRadius: v.c });
          }
        },
      };
    }
    if (e.kind === "ellipse") {
      return {
        title: "Ellipse",
        note: "",
        fields: [
          { key: "x", label: "Center X", kind: "length", value: e.center.x },
          { key: "y", label: "Center Y", kind: "length", value: e.center.y },
          { key: "rx", label: "Radius X", kind: "length", value: e.rx },
          { key: "ry", label: "Radius Y", kind: "length", value: e.ry },
          { key: "a", label: "Rotation", kind: "angle", value: e.rotation },
        ],
        apply: (v) => {
          if (!(v.rx > 0) || !(v.ry > 0)) return;
          const moved = Math.abs(v.rx - e.rx) < 1e-6 && Math.abs(v.ry - e.ry) < 1e-6 && Math.abs(v.a - e.rotation) < 1e-9;
          if (moved) {
            const d = { x: v.x - e.center.x, y: v.y - e.center.y };
            commitOne(e, translateEntity(e, d), translation(d.x, d.y));
          } else commitOne(e, { ...e, center: { x: v.x, y: v.y }, rx: v.rx, ry: v.ry, rotation: v.a });
        },
      };
    }
    if (e.kind === "text") {
      return {
        title: "Text",
        note: `“${e.text}” — double-click the text to edit the words`,
        fields: [
          { key: "x", label: "X", kind: "length", value: e.position.x },
          { key: "y", label: "Y", kind: "length", value: e.position.y },
          { key: "h", label: "Height (paper)", kind: "length", value: e.height },
          { key: "a", label: "Rotation", kind: "angle", value: e.rotation },
        ],
        apply: (v) => {
          if (!(v.h > 0)) return;
          const moved = Math.abs(v.h - e.height) < 1e-9 && Math.abs(v.a - e.rotation) < 1e-9;
          if (moved) {
            const d = { x: v.x - e.position.x, y: v.y - e.position.y };
            commitOne(e, translateEntity(e, d), translation(d.x, d.y));
          } else commitOne(e, { ...e, position: { x: v.x, y: v.y }, height: v.h, rotation: v.a });
        },
      };
    }
  }

  const c = centerOf(ents);
  if (!c) return null;
  const kinds = new Set(ents.map((e) => e.kind));
  const grouped = ents.some((e) => e.groups?.length);
  return {
    title: ents.length === 1 ? ents[0].kind : grouped ? "Group" : "Selection",
    note: `${ents.length} object${ents.length === 1 ? "" : "s"}${kinds.size === 1 ? "" : ` (${kinds.size} kinds)`}. Moving the center moves them together.`,
    fields: [
      { key: "x", label: "Center X", kind: "length", value: c.x },
      { key: "y", label: "Center Y", kind: "length", value: c.y },
    ],
    apply: (v) => moveAll(ents, c, { x: v.x, y: v.y }),
  };
}
