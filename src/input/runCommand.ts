// What a shortcut does. Dialogs are opened by an event the menu bar listens for,
// so the key and the menu item share one implementation.
import { alignSelection, duplicate, flipSelection, reorder, selectionCenter } from "../state/arrange";
import { copySelection, cutSelection, pasteSelection } from "../state/clipboard";
import { exportDxfFile, exportPngFile, newDrawing, openDrawing, saveDrawing, saveDrawingAs } from "../state/fileCommands";
import { groupSelection, lockSelection, ungroupSelection, unlockSelection } from "../state/groups";
import { explodeSelection, makeSymbol } from "../state/symbols";
import { selectableIds } from "../state/selection";
import { useDocumentStore } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";
import { TOOLS } from "../tools/defs";

export interface CommandHost {
  zoomBy(factor: number): void;
  zoomFit(): void;
  fitSheet(): void;
  cancelTool(): void;
}

const emit = (id: string) => window.dispatchEvent(new CustomEvent("temaricad:command", { detail: id }));

/** Returns true when the id was a real command (including ones the menu bar finishes). */
export function runCommand(id: string, host: CommandHost): boolean {
  if (id.startsWith("tool:")) {
    const toolId = id.slice(5);
    const tool = TOOLS.find((t) => t.id === toolId);
    if (!tool) return false;
    const cur = useToolStore.getState();
    if (cur.tool === tool.id) {
      const i = tool.methods.findIndex((m) => m.id === cur.methods[tool.id]);
      cur.setMethod(tool.id, tool.methods[(i + 1) % tool.methods.length].id);
    } else cur.setTool(tool.id);
    return true;
  }
  const doc = useDocumentStore.getState();
  const center = () => selectionCenter() ?? { x: 0, y: 0 };
  switch (id) {
    case "file.new":
      newDrawing();
      return true;
    case "file.open":
      void openDrawing();
      return true;
    case "file.save":
      void saveDrawing();
      return true;
    case "file.saveAs":
      void saveDrawingAs();
      return true;
    case "file.dxf":
      void exportDxfFile();
      return true;
    case "file.png":
      void exportPngFile();
      return true;
    case "file.plot":
    case "edit.info":
    case "layout.sheet":
    case "arrange.step":
    case "arrange.polar":
    case "arrange.rotate":
    case "arrange.scale":
    case "window.shortcuts":
    case "window.modifiers":
    case "window.layers":
    case "window.attributes":
    case "window.symbols":
      emit(id);
      return true;
    case "edit.undo":
      host.cancelTool();
      doc.undo();
      return true;
    case "edit.redo":
    case "edit.redoY":
      host.cancelTool();
      doc.redo();
      return true;
    case "edit.cut":
      cutSelection();
      return true;
    case "edit.copy":
      copySelection();
      return true;
    case "edit.paste":
      pasteSelection();
      return true;
    case "edit.duplicate": {
      const g = useToolStore.getState().settings.gridSpacing;
      duplicate({ x: g, y: -g });
      return true;
    }
    case "edit.selectAll": {
      useToolStore.getState().setTool("select");
      doc.setSelection(selectableIds(doc.doc, { filter: useToolStore.getState().settings.selectFilter }));
      return true;
    }
    case "view.zoomIn":
      host.zoomBy(1.5);
      return true;
    case "view.zoomOut":
      host.zoomBy(1 / 1.5);
      return true;
    case "view.fit":
      host.zoomFit();
      return true;
    case "view.fitPage":
      host.fitSheet();
      return true;
    case "view.grid":
      useToolStore.getState().setSetting("gridVisible", !useToolStore.getState().settings.gridVisible);
      return true;
    case "view.weights":
      useToolStore.getState().setSetting("showWeights", !useToolStore.getState().settings.showWeights);
      return true;
    case "arrange.group":
      groupSelection();
      return true;
    case "arrange.ungroup":
      ungroupSelection();
      return true;
    case "arrange.lock":
      lockSelection();
      return true;
    case "arrange.unlock":
      unlockSelection();
      return true;
    case "arrange.front":
      reorder("front");
      return true;
    case "arrange.back":
      reorder("back");
      return true;
    case "arrange.flipH":
      flipSelection("horizontal", center());
      return true;
    case "arrange.flipV":
      flipSelection("vertical", center());
      return true;
    case "arrange.alignLeft":
      alignSelection("left");
      return true;
    case "arrange.alignRight":
      alignSelection("right");
      return true;
    case "arrange.alignTop":
      alignSelection("top");
      return true;
    case "arrange.alignBottom":
      alignSelection("bottom");
      return true;
    case "arrange.alignH":
      alignSelection("hcenter");
      return true;
    case "arrange.alignV":
      alignSelection("vcenter");
      return true;
    case "arrange.symbol": {
      const name = prompt("Symbol name", `Symbol ${doc.doc.symbols.length + 1}`);
      if (name) makeSymbol(name);
      return true;
    }
    case "arrange.explode":
      explodeSelection();
      return true;
    default:
      return false;
  }
}
