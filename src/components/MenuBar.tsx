// Classic menu bar. Click a title to open; hover moves between open menus.
import { useEffect, useState } from "react";
import type { UnitSystem } from "../kernel/types";
import { useDocumentStore, newDocument } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";
import { viewportRef } from "../canvas/controller";
import { Dialog, type DialogField } from "./Dialog";
import { duplicate, flipSelection, polarArray, reorder, rotateSelection, scaleSelection, selectionCenter, stepAndRepeat } from "../state/arrange";

type DialogSpec = { title: string; fields: DialogField[]; okLabel?: string; run(v: Record<string, number>): void };

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

export function MenuBar({ modifiersOpen, setModifiersOpen }: { modifiersOpen: boolean; setModifiersOpen(v: boolean): void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
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
        {
          label: "New",
          run: () => {
            if (!ds.doc.entities.length || confirm("Discard this drawing and start a new one?")) ds.load(newDocument());
          },
        },
        { label: "Open…  (Milestone 5)", disabled: true },
        { label: "Save  (Milestone 5)", disabled: true },
      ],
    },
    {
      title: "Edit",
      items: [
        { label: lastUndo ? `Undo ${lastUndo.label}` : "Can't Undo", shortcut: `${mod}Z`, disabled: !lastUndo, run: ds.undo },
        { label: lastRedo ? `Redo ${lastRedo.label}` : "Can't Redo", shortcut: `${mod}Y`, disabled: !lastRedo, run: ds.redo },
        "-",
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
      ],
    },
    {
      title: "View",
      items: [
        { label: "Zoom In", shortcut: `${mod}+`, run: () => viewportRef.current?.zoomBy(1.5) },
        { label: "Zoom Out", shortcut: `${mod}-`, run: () => viewportRef.current?.zoomBy(1 / 1.5) },
        { label: "Fit to Drawing", shortcut: "F", run: () => viewportRef.current?.zoomFit() },
        "-",
        { label: "Show Grid", checked: settings.gridVisible, run: () => setSetting("gridVisible", !settings.gridVisible) },
        { label: "Show Line Weights", checked: settings.showWeights, run: () => setSetting("showWeights", !settings.showWeights) },
      ],
    },
    {
      title: "Arrange",
      items: (() => {
        const none = !ds.selection.size;
        const g = settings.gridSpacing;
        const center = () => selectionCenter() ?? { x: 0, y: 0 };
        return [
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
          { label: "Bring to Front", disabled: none, run: () => reorder("front") },
          { label: "Send to Back", disabled: none, run: () => reorder("back") },
        ] as (Item | "-")[];
      })(),
    },
    {
      title: "Layout",
      items: UNITS.map(([u, label]) => ({ label, checked: ds.doc.units === u, run: () => ds.setUnits(u) })),
    },
    {
      title: "Window",
      items: [{ label: "Modifiers", checked: modifiersOpen, run: () => setModifiersOpen(!modifiersOpen) }],
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
    {dialog && (
      <Dialog
        title={dialog.title}
        fields={dialog.fields}
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
            <div className="mac-frame absolute top-[19px] left-0 min-w-[220px] py-[2px]">
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
