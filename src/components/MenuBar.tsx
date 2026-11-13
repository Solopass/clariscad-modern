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
import { groupSelection, lockSelection, ungroupSelection, unlockSelection } from "../state/groups";
import { describeSelection } from "../state/inspect";
import { SheetDialog } from "./SheetDialog";
import { shortcutText } from "../input/keymap";
import { runCommand } from "../input/runCommand";

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
    const onCmd = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const g = useToolStore.getState().settings.gridSpacing;
      const center = () => selectionCenter() ?? { x: 0, y: 0 };
      if (id === "file.plot") setPlotOpen(true);
      else if (id === "edit.info") info();
      else if (id === "layout.sheet") setSheetOpen(true);
      else if (id === "arrange.step")
        setDialog({
          title: "Step and Repeat",
          okLabel: "Repeat",
          fields: [
            { key: "n", label: "Copies", kind: "count", value: 3 },
            { key: "dx", label: "Horizontal offset", kind: "length", value: g * 12 },
            { key: "dy", label: "Vertical offset", kind: "length", value: 0 },
          ],
          run: (v) => stepAndRepeat(v.n, { x: v.dx, y: v.dy }),
        });
      else if (id === "arrange.polar") {
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
      } else if (id === "arrange.rotate")
        setDialog({
          title: "Rotate (about the selection's center)",
          fields: [{ key: "a", label: "Angle (CCW)", kind: "angle", value: Math.PI / 2 }],
          run: (v) => rotateSelection((v.a * 180) / Math.PI, center()),
        });
      else if (id === "arrange.scale")
        setDialog({
          title: "Scale (about the selection's center)",
          fields: [{ key: "k", label: "Factor", kind: "number", value: 2 }],
          run: (v) => v.k > 0 && scaleSelection(v.k, center()),
        });
    };
    window.addEventListener("temaricad:command", onCmd);
    return () => {
      window.removeEventListener("temaricad:plot", open);
      window.removeEventListener("temaricad:command", onCmd);
    };
  }, []);
  const ds = useDocumentStore();
  const settings = useToolStore((s) => s.settings);
  const setSetting = useToolStore((s) => s.setSetting);
  const lastUndo = ds.undoStack[ds.undoStack.length - 1];
  const lastRedo = ds.redoStack[ds.redoStack.length - 1];
  const sc = shortcutText;

  const menus: Menu[] = [
    {
      title: "File",
      items: [
        { label: "New", shortcut: sc("file.new"), run: newDrawing },
        { label: "Open…", shortcut: sc("file.open"), run: () => void openDrawing() },
        "-",
        { label: "Save", shortcut: sc("file.save"), run: () => void saveDrawing() },
        { label: "Save As…", shortcut: sc("file.saveAs"), run: () => void saveDrawingAs() },
        "-",
        { label: "Export DXF…", shortcut: sc("file.dxf"), run: () => void exportDxfFile() },
        { label: "Export PNG…", shortcut: sc("file.png"), run: () => void exportPngFile() },
        { label: "Plot (PDF / SVG)…", shortcut: sc("file.plot"), run: () => setPlotOpen(true) },
      ],
    },
    {
      title: "Edit",
      items: [
        { label: lastUndo ? `Undo ${lastUndo.label}` : "Can't Undo", shortcut: sc("edit.undo"), disabled: !lastUndo, run: ds.undo },
        { label: lastRedo ? `Redo ${lastRedo.label}` : "Can't Redo", shortcut: sc("edit.redo"), disabled: !lastRedo, run: ds.redo },
        "-",
        { label: "Cut", shortcut: sc("edit.cut"), disabled: !ds.selection.size, run: cutSelection },
        { label: "Copy", shortcut: sc("edit.copy"), disabled: !ds.selection.size, run: copySelection },
        { label: "Paste", shortcut: sc("edit.paste"), run: pasteSelection },
        {
          label: "Clear",
          shortcut: "Del",
          disabled: !ds.selection.size,
          run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })),
        },
        {
          label: "Select All",
          shortcut: sc("edit.selectAll"),
          run: () => runCommand("edit.selectAll", { zoomBy() {}, zoomFit() {}, fitSheet() {}, cancelTool() {} }),
        },
        {
          label: "Get Info…",
          shortcut: sc("edit.info"),
          disabled: !ds.selection.size,
          run: () => window.dispatchEvent(new CustomEvent("temaricad:command", { detail: "edit.info" })),
        },
      ],
    },
    {
      title: "View",
      items: [
        { label: "Zoom In", shortcut: sc("view.zoomIn"), run: () => viewportRef.current?.zoomBy(1.5) },
        { label: "Zoom Out", shortcut: sc("view.zoomOut"), run: () => viewportRef.current?.zoomBy(1 / 1.5) },
        { label: "Fit to Drawing", shortcut: sc("view.fit"), run: () => viewportRef.current?.zoomFit() },
        { label: "Fit Page", shortcut: sc("view.fitPage"), run: () => viewportRef.current?.fitSheet() },
        "-",
        { label: "Show Grid", shortcut: sc("view.grid"), checked: settings.gridVisible, run: () => setSetting("gridVisible", !settings.gridVisible) },
        { label: "Show Line Weights", shortcut: sc("view.weights"), checked: settings.showWeights, run: () => setSetting("showWeights", !settings.showWeights) },
      ],
    },
    {
      title: "Arrange",
      items: (() => {
        const none = !ds.selection.size;
        const one = ds.selection.size < 2;
        const grouped = ds.doc.entities.some((e) => ds.selection.has(e.id) && e.groups?.length);
        const g = settings.gridSpacing;
        const center = () => selectionCenter() ?? { x: 0, y: 0 };
        return [
          { label: "Group", shortcut: sc("arrange.group"), disabled: one, run: groupSelection },
          { label: "Ungroup", shortcut: sc("arrange.ungroup"), disabled: !grouped, run: ungroupSelection },
          { label: "Lock", shortcut: sc("arrange.lock"), disabled: none, run: lockSelection },
          { label: "Unlock", shortcut: sc("arrange.unlock"), run: unlockSelection },
          "-",
          { label: "Duplicate", shortcut: sc("edit.duplicate"), disabled: none, run: () => duplicate({ x: g, y: -g }) },
          {
            label: "Step and Repeat…",
            shortcut: sc("arrange.step"),
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
            shortcut: sc("arrange.polar"),
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
            shortcut: sc("arrange.rotate"),
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
            shortcut: sc("arrange.scale"),
            disabled: none,
            run: () =>
              setDialog({
                title: "Scale (about the selection's center)",
                fields: [{ key: "k", label: "Factor", kind: "number", value: 2 }],
                run: (v) => v.k > 0 && scaleSelection(v.k, center()),
              }),
          },
          { label: "Flip Horizontal", shortcut: sc("arrange.flipH"), disabled: none, run: () => flipSelection("horizontal", center()) },
          { label: "Flip Vertical", shortcut: sc("arrange.flipV"), disabled: none, run: () => flipSelection("vertical", center()) },
          "-",
          { label: "Align Left", shortcut: sc("arrange.alignLeft"), disabled: one, run: () => alignSelection("left") },
          { label: "Align Right", shortcut: sc("arrange.alignRight"), disabled: one, run: () => alignSelection("right") },
          { label: "Align Top", shortcut: sc("arrange.alignTop"), disabled: one, run: () => alignSelection("top") },
          { label: "Align Bottom", shortcut: sc("arrange.alignBottom"), disabled: one, run: () => alignSelection("bottom") },
          { label: "Align Horizontal Centers", shortcut: sc("arrange.alignH"), disabled: one, run: () => alignSelection("hcenter") },
          { label: "Align Vertical Centers", shortcut: sc("arrange.alignV"), disabled: one, run: () => alignSelection("vcenter") },
          "-",
          { label: "Bring to Front", shortcut: sc("arrange.front"), disabled: none, run: () => reorder("front") },
          { label: "Send to Back", shortcut: sc("arrange.back"), disabled: none, run: () => reorder("back") },
          "-",
          {
            label: "Make Symbol…",
            shortcut: sc("arrange.symbol"),
            disabled: none,
            run: () => {
              const name = prompt("Symbol name", `Symbol ${ds.doc.symbols.length + 1}`);
              if (name) makeSymbol(name);
            },
          },
          { label: "Explode Symbol", shortcut: sc("arrange.explode"), disabled: !ds.doc.entities.some((e) => ds.selection.has(e.id) && e.kind === "symbol"), run: explodeSelection },
        ] as (Item | "-")[];
      })(),
    },
    {
      title: "Layout",
      items: [
        { label: "Rulers & Drawing Size…", shortcut: sc("layout.sheet"), run: () => setSheetOpen(true) },
        "-",
        ...UNITS.map(([u, label]) => ({ label, checked: ds.doc.units === u, run: () => ds.setUnits(u) })),
        "-",
        ...STANDARD_LABELS.map(([s, label]) => ({ label: `Standard: ${label}`, checked: ds.doc.standard === s, run: () => ds.setStandard(s) })),
      ] as (Item | "-")[],
    },
    {
      title: "Window",
      items: [
        ...(
          [
            ["modifiers", "Modifiers", "window.modifiers"],
            ["layers", "Layers", "window.layers"],
            ["attributes", "Attributes", "window.attributes"],
            ["symbols", "Symbols", "window.symbols"],
          ] as [PaletteId, string, string][]
        ).map(([id, label, sid]) => ({ label, shortcut: sc(sid), checked: palettes[id], run: () => setPalette(id, !palettes[id]) })),
        "-",
        { label: "Shortcuts", shortcut: sc("window.shortcuts"), checked: false, run: () => window.dispatchEvent(new CustomEvent("temaricad:command", { detail: "window.shortcuts" })) },
      ],
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
