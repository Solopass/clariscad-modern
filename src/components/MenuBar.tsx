// Classic menu bar. Click a title to open; hover moves between open menus.
import { useEffect, useState } from "react";
import type { UnitSystem } from "../kernel/types";
import { useDocumentStore } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";
import { viewportRef } from "../canvas/controller";
import { Dialog, type DialogField } from "./Dialog";
import { PlotDialog } from "./PlotDialog";
import { exportDxfFile, exportPngFile, newDrawing, openDrawing, saveDrawing, saveDrawingAs } from "../state/fileCommands";
import type { PaletteId, PaletteState } from "../App";
import type { DraftingStandard } from "../kernel/types";
import { explodeSelection, makeSymbol } from "../state/symbols";
import { alignSelection, duplicate, flipSelection, polarArray, reorder, rotateSelection, scaleSelection, selectionCenter, stepAndRepeat } from "../state/arrange";
import { copySelection, cutSelection, pasteSelection } from "../state/clipboard";
import { groupSelection, ungroupSelection } from "../state/groups";
import { describeSelection } from "../state/inspect";
import { SheetDialog } from "./SheetDialog";

const STANDARD_LABELS: [DraftingStandard, string][] = [
  ["ANSI", "ANSI Y14.5"],
  ["ISO", "ISO"],
  ["DIN", "DIN"],
  ["JIS", "JIS"],
  ["BS308", "BS 308"],
];

type DialogSpec = { title: string; fields: DialogField[]; note?: string; okLabel?: string; run(v: Record<string, number>): void };

interface Item {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  run?: () => void;
}
type Menu = { title: string; items: (Item | "-")[] };

const UNITS: [UnitSystem, string][] = [
  ["architectural", `Architectural (1'-2 1/2")`],
  ["engineering", `Engineering (1.208')`],
  ["inches", `Decimal Inches (14.5")`],
  ["feet", `Decimal Feet`],
  ["mm", "Millimeters"],
  ["cm", "Centimeters"],
  ["m", "Meters"],
];

export function MenuBar({ palettes, setPalette }: { palettes: PaletteState; setPalette(id: PaletteId, v: boolean): void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [plotOpen, setPlotOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    const open = () => setPlotOpen(true);
    window.addEventListener("temaricad:plot", open);
    const info = () => {
      const spec = describeSelection();
      if (spec) setDialog({ title: spec.title, fields: spec.fields, note: spec.note, okLabel: "Apply", run: spec.apply });
    };
    window.addEventListener("temaricad:info", info);
    return () => {
      window.removeEventListener("temaricad:plot", open);
      window.removeEventListener("temaricad:info", info);
    };
  }, []);
  const ds = useDocumentStore();
  const settings = useToolStore((s) => s.settings);
  const setSetting = useToolStore((s) => s.setSetting);
  const lastUndo = ds.undoStack[ds.undoStack.length - 1];
  const lastRedo = ds.redoStack[ds.redoStack.length - 1];
  const mod = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";

  const menus: Menu[] = [
    {
      title: "File",
      items: [
        { label: "New", shortcut: `${mod}N`, run: newDrawing },
        { label: "Open…", shortcut: `${mod}O`, run: () => void openDrawing() },
        "-",
        { label: "Save", shortcut: `${mod}S`, run: () => void saveDrawing() },
        { label: "Save As…", shortcut: `${mod}⇧S`, run: () => void saveDrawingAs() },
        "-",
        { label: "Export DXF…", run: () => void exportDxfFile() },
        { label: "Export PNG…", run: () => void exportPngFile() },
        { label: "Plot (PDF / SVG)…", shortcut: `${mod}P`, run: () => setPlotOpen(true) },
      ],
    },
    {
      title: "Edit",
      items: [
        { label: lastUndo ? `Undo ${lastUndo.label}` : "Can't Undo", shortcut: `${mod}Z`, disabled: !lastUndo, run: ds.undo },
        { label: lastRedo ? `Redo ${lastRedo.label}` : "Can't Redo", shortcut: `${mod}Y`, disabled: !lastRedo, run: ds.redo },
        "-",
        { label: "Cut", shortcut: `${mod}X`, disabled: !ds.selection.size, run: cutSelection },
        { label: "Copy", shortcut: `${mod}C`, disabled: !ds.selection.size, run: copySelection },
        { label: "Paste", shortcut: `${mod}V`, run: pasteSelection },
        {
          label: "Clear",
          shortcut: "Del",
          disabled: !ds.selection.size,
          run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })),
        },
        {
          label: "Select All",
          shortcut: `${mod}A`,
          run: () => {
            useToolStore.getState().setTool("select");
            ds.setSelection(ds.doc.entities.map((e) => e.id));
          },
        },
        {
          label: "Get Info…",
          shortcut: `${mod}I`,
          disabled: !ds.selection.size,
          run: () => window.dispatchEvent(new Event("temaricad:info")),
        },
      ],
    },
    {
      title: "View",
      items: [
        { label: "Zoom In", shortcut: `${mod}+`, run: () => viewportRef.current?.zoomBy(1.5) },
        { label: "Zoom Out", shortcut: `${mod}-`, run: () => viewportRef.current?.zoomBy(1 / 1.5) },
        { label: "Fit to Drawing", shortcut: "F", run: () => viewportRef.current?.zoomFit() },
        { label: "Fit Page", shortcut: "Shift+F", run: () => viewportRef.current?.fitSheet() },
        "-",
        { label: "Show Grid", checked: settings.gridVisible, run: () => setSetting("gridVisible", !settings.gridVisible) },
        { label: "Show Line Weights", checked: settings.showWeights, run: () => setSetting("showWeights", !settings.showWeights) },
      ],
    },
    {
      title: "Arrange",
      items: (() => {
        const none = !ds.selection.size;
        const one = ds.selection.size < 2;
        const grouped = ds.doc.entities.some((e) => ds.selection.has(e.id) && e.groupId);
        const g = settings.gridSpacing;
        const center = () => selectionCenter() ?? { x: 0, y: 0 };
        return [
          { label: "Group", shortcut: `${mod}G`, disabled: one, run: groupSelection },
          { label: "Ungroup", shortcut: `${mod}⇧G`, disabled: !grouped, run: ungroupSelection },
          "-",
          { label: "Duplicate", shortcut: `${mod}D`, disabled: none, run: () => duplicate({ x: g, y: -g }) },
          {
            label: "Step and Repeat…",
            disabled: none,
            run: () =>
              setDialog({
                title: "Step and Repeat",
                okLabel: "Repeat",
                fields: [
                  { key: "n", label: "Copies", kind: "count", value: 3 },
                  { key: "dx", label: "Horizontal offset", kind: "length", value: g * 12 },
                  { key: "dy", label: "Vertical offset", kind: "length", value: 0 },
                ],
                run: (v) => stepAndRepeat(v.n, { x: v.dx, y: v.dy }),
              }),
          },
          {
            label: "Polar Array…",
            disabled: none,
            run: () => {
              const c = center();
              setDialog({
                title: "Polar Array",
                okLabel: "Array",
                fields: [
                  { key: "n", label: "Total items", kind: "count", value: 6 },
                  { key: "a", label: "Fill angle", kind: "angle", value: 2 * Math.PI },
                  { key: "x", label: "Center X", kind: "length", value: c.x },
                  { key: "y", label: "Center Y", kind: "length", value: c.y },
                ],
                run: (v) => polarArray(v.n, (v.a * 180) / Math.PI, { x: v.x, y: v.y }),
              });
            },
          },
          "-",
          {
            label: "Rotate…",
            disabled: none,
            run: () =>
              setDialog({
                title: "Rotate (about the selection's center)",
                fields: [{ key: "a", label: "Angle (CCW)", kind: "angle", value: Math.PI / 2 }],
                run: (v) => rotateSelection((v.a * 180) / Math.PI, center()),
              }),
          },
          {
            label: "Scale…",
            disabled: none,
            run: () =>
              setDialog({
                title: "Scale (about the selection's center)",
                fields: [{ key: "k", label: "Factor", kind: "number", value: 2 }],
                run: (v) => v.k > 0 && scaleSelection(v.k, center()),
              }),
          },
          { label: "Flip Horizontal", disabled: none, run: () => flipSelection("horizontal", center()) },
          { label: "Flip Vertical", disabled: none, run: () => flipSelection("vertical", center()) },
          "-",
          { label: "Align Left", disabled: one, run: () => alignSelection("left") },
          { label: "Align Right", disabled: one, run: () => alignSelection("right") },
          { label: "Align Top", disabled: one, run: () => alignSelection("top") },
          { label: "Align Bottom", disabled: one, run: () => alignSelection("bottom") },
          { label: "Align Horizontal Centers", disabled: one, run: () => alignSelection("hcenter") },
          { label: "Align Vertical Centers", disabled: one, run: () => alignSelection("vcenter") },
          "-",
          { label: "Bring to Front", disabled: none, run: () => reorder("front") },
          { label: "Send to Back", disabled: none, run: () => reorder("back") },
          "-",
          {
            label: "Make Symbol…",
            disabled: none,
            run: () => {
              const name = prompt("Symbol name", `Symbol ${ds.doc.symbols.length + 1}`);
              if (name) makeSymbol(name);
            },
          },
          { label: "Explode Symbol", disabled: !ds.doc.entities.some((e) => ds.selection.has(e.id) && e.kind === "symbol"), run: explodeSelection },
        ] as (Item | "-")[];
      })(),
    },
    {
      title: "Layout",
      items: [
        { label: "Rulers & Drawing Size…", run: () => setSheetOpen(true) },
        "-",
        ...UNITS.map(([u, label]) => ({ label, checked: ds.doc.units === u, run: () => ds.setUnits(u) })),
        "-",
        ...STANDARD_LABELS.map(([s, label]) => ({ label: `Standard: ${label}`, checked: ds.doc.standard === s, run: () => ds.setStandard(s) })),
      ] as (Item | "-")[],
    },
    {
      title: "Window",
      items: (
        [
          ["modifiers", "Modifiers"],
          ["layers", "Layers"],
          ["attributes", "Attributes"],
          ["symbols", "Symbols"],
        ] as [PaletteId, string][]
      ).map(([id, label]) => ({ label, checked: palettes[id], run: () => setPalette(id, !palettes[id]) })),
    },
  ];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-menubar]")) setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <>
    {plotOpen && <PlotDialog onClose={() => setPlotOpen(false)} />}
    {sheetOpen && <SheetDialog onClose={() => setSheetOpen(false)} />}
    {dialog && (
      <Dialog
        title={dialog.title}
        fields={dialog.fields}
        note={dialog.note}
        okLabel={dialog.okLabel}
        onCancel={() => setDialog(null)}
        onOk={(v) => {
          setDialog(null);
          dialog.run(v);
        }}
      />
    )}
    <div data-menubar className="relative z-50 flex h-[20px] items-stretch border-b border-black bg-white px-2">
      <span className="mr-3 flex items-center font-bold" title="TemariCad">◆</span>
      {menus.map((m) => (
        <div key={m.title} className="relative">
          <button
            className="h-full px-2"
            style={{ background: open === m.title ? "#000" : undefined, color: open === m.title ? "#fff" : undefined }}
            onPointerDown={() => setOpen(open === m.title ? null : m.title)}
            onPointerEnter={() => open && setOpen(m.title)}
          >
            {m.title}
          </button>
          {open === m.title && (
            <div className="mac-frame absolute top-[19px] left-0 max-h-[70vh] min-w-[240px] overflow-y-auto py-[2px]">
              {m.items.map((it, i) =>
                it === "-" ? (
                  <div key={i} className="my-[3px] border-t border-dotted border-black" />
                ) : (
                  <div
                    key={i}
                    aria-disabled={it.disabled}
                    className="mac-menu-item flex cursor-default justify-between gap-6 py-[1px] pr-3 pl-1"
                    style={{ color: it.disabled ? "#999" : undefined }}
                    onPointerUp={() => {
                      if (it.disabled) return;
                      setOpen(null);
                      it.run?.();
                    }}
                  >
                    <span>
                      <span className="inline-block w-4">{it.checked ? "✓" : ""}</span>
                      {it.label}
                    </span>
                    {it.shortcut && <span>{it.shortcut}</span>}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
    </>
  );
}
