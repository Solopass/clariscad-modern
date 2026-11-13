// Right-click canvas context menu (shown when no multi-point command is finishing).
import { useEffect, useState } from "react";
import { viewportRef } from "../canvas/controller";
import { booleanSelection, duplicate, flipSelection, reorder, selectionCenter } from "../state/arrange";
import { pasteSelection } from "../state/clipboard";
import { groupSelection, lockSelection, ungroupSelection } from "../state/groups";
import { removePatch } from "../state/ops";
import { toggleSymbolEdit } from "../state/symbolEdit";
import { useDocumentStore } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";
import { flipDoorSwings } from "../state/wallEdit";

interface MenuItem {
  label: string;
  disabled?: boolean;
  run(): void;
}

export function ContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setPos((e as CustomEvent<{ x: number; y: number }>).detail);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-context-menu]")) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    window.addEventListener("temaricad:contextmenu", onOpen);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("temaricad:contextmenu", onOpen);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!pos) return null;

  const ds = useDocumentStore.getState();
  const ts = useToolStore.getState();
  const sel = ds.doc.entities.filter((e) => ds.selection.has(e.id));
  const g = ts.settings.gridSpacing;
  const center = () => selectionCenter() ?? { x: 0, y: 0 };

  const items: (MenuItem | "-")[] = sel.length
    ? [
        { label: "Get Info…", run: () => window.dispatchEvent(new CustomEvent("temaricad:command", { detail: "edit.info" })) },
        { label: "Duplicate", run: () => duplicate({ x: g, y: -g }) },
        "-",
        ...(sel.length >= 2
          ? [
              { label: "Group", run: groupSelection },
              { label: "Union", run: () => booleanSelection("union") },
              { label: "Subtract", run: () => booleanSelection("subtract") },
              { label: "Intersect", run: () => booleanSelection("intersect") },
              "-",
            ] as (MenuItem | "-")[]
          : []),
        ...(sel.some((e) => e.groups?.length) ? [{ label: "Ungroup", run: ungroupSelection }] : []),
        { label: "Bring to Front", run: () => reorder("front") },
        { label: "Send to Back", run: () => reorder("back") },
        { label: "Flip Horizontal", run: () => flipSelection("horizontal", center()) },
        { label: "Flip Vertical", run: () => flipSelection("vertical", center()) },
        ...(sel.some((e) => e.kind === "wall" && e.openings?.length) ? [{ label: "Flip Door Swing", run: flipDoorSwings }] : []),
        ...(sel.length === 1 && sel[0].kind === "symbol" ? [{ label: "Edit Symbol in Place", run: toggleSymbolEdit }] : []),
        "-",
        { label: "Lock", run: lockSelection },
        {
          label: "Delete",
          run: () => ds.commit(removePatch(ds.doc, "Delete", sel.map((e) => e.id))),
        },
      ]
    : [
        { label: "Paste", run: pasteSelection },
        "-",
        { label: "Fit to Drawing", run: () => viewportRef.current?.zoomFit() },
        { label: "Fit Page", run: () => viewportRef.current?.fitSheet() },
        { label: "Zoom Window", run: () => viewportRef.current?.startZoomWindow() },
        { label: "Previous View", run: () => viewportRef.current?.previousView() },
        "-",
        { label: ts.settings.gridVisible ? "Hide Grid" : "Show Grid", run: () => ts.setSetting("gridVisible", !ts.settings.gridVisible) },
      ];

  const left = Math.min(pos.x, window.innerWidth - 190);
  const top = Math.min(pos.y, window.innerHeight - items.length * 22 - 12);

  return (
    <div
      data-context-menu
      className="mac-frame fixed z-[65] min-w-[180px] py-[2px]"
      style={{ left: Math.max(4, left), top: Math.max(22, top) }}
    >
      {items.map((it, i) =>
        it === "-" ? (
          <div key={i} className="my-[3px] border-t border-dotted border-black" />
        ) : (
          <div
            key={i}
            aria-disabled={it.disabled}
            className="mac-menu-item cursor-default whitespace-nowrap px-3 py-[1px]"
            style={{ color: it.disabled ? "#999" : undefined }}
            onPointerUp={() => {
              if (it.disabled) return;
              setPos(null);
              it.run();
            }}
          >
            {it.label}
          </div>
        ),
      )}
    </div>
  );
}
