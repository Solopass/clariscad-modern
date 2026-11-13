// Every keyboard shortcut in the program. Menus, the key handler and the
// shortcut panel all read this list, so a binding cannot show one key and do another.
// Tool letters come from the tool definitions.
import { TOOLS } from "../tools/defs";

export type ShortcutSection = "File" | "Edit" | "View" | "Arrange" | "Layout" | "Tools" | "Window" | "Drawing";

export interface Chord {
  /** KeyboardEvent.key, compared case-insensitively when it is a single character. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Other key strings that should hit the same command ("=" as well as "+"). */
  alias?: string[];
}

export interface Shortcut {
  id: string;
  label: string;
  section: ShortcutSection;
  chord: Chord;
  /**
   * Shown in the panel, handled by the drawing view rather than runCommand
   * (nudge, finish, pan). The matcher ignores these.
   */
  hint?: boolean;
  /** Why this is not the key Claris CAD used. */
  remap?: string;
}

const mod = (key: string, extra: Partial<Chord> = {}): Chord => ({ key, mod: true, ...extra });

const COMMANDS: Shortcut[] = [
  { id: "file.new", label: "New", section: "File", chord: mod("n"), remap: "Ctrl/⌘N is also the browser’s new window. The drawing takes it while a page is focused; if the browser still wins, use the File menu." },
  { id: "file.open", label: "Open", section: "File", chord: mod("o") },
  { id: "file.save", label: "Save", section: "File", chord: mod("s") },
  { id: "file.saveAs", label: "Save As", section: "File", chord: mod("s", { shift: true }) },
  { id: "file.dxf", label: "Export DXF", section: "File", chord: mod("e", { shift: true }) },
  { id: "file.png", label: "Export PNG", section: "File", chord: mod("e", { alt: true }) },
  { id: "file.plot", label: "Plot", section: "File", chord: mod("p"), remap: "Claris used ⌘P for Print. The browser’s print dialog is the same keys; the drawing takes them for Plot." },

  { id: "edit.undo", label: "Undo", section: "Edit", chord: mod("z") },
  { id: "edit.redo", label: "Redo", section: "Edit", chord: mod("z", { shift: true }) },
  { id: "edit.redoY", label: "Redo", section: "Edit", chord: mod("y") },
  { id: "edit.cut", label: "Cut", section: "Edit", chord: mod("x") },
  { id: "edit.copy", label: "Copy", section: "Edit", chord: mod("c") },
  { id: "edit.paste", label: "Paste", section: "Edit", chord: mod("v") },
  { id: "edit.duplicate", label: "Duplicate", section: "Edit", chord: mod("d"), remap: "⌘D was Duplicate in Claris. Ctrl/⌘D is also Bookmark in the browser; the drawing takes it while the page is focused." },
  { id: "edit.selectAll", label: "Select All", section: "Edit", chord: mod("a") },
  { id: "edit.info", label: "Get Info", section: "Edit", chord: mod("i") },
  { id: "edit.clear", label: "Clear", section: "Edit", chord: { key: "Delete" }, hint: true },
  { id: "edit.clear2", label: "Clear", section: "Edit", chord: { key: "Backspace" }, hint: true },

  { id: "view.zoomIn", label: "Zoom In", section: "View", chord: mod("+", { alias: ["="] }) },
  { id: "view.zoomOut", label: "Zoom Out", section: "View", chord: mod("-") },
  { id: "view.fit", label: "Fit to Drawing", section: "View", chord: { key: "f" }, remap: "Ctrl/⌘0 resets the browser’s own zoom and cannot be overridden, so Fit is the F key." },
  { id: "view.fitPage", label: "Fit Page", section: "View", chord: { key: "f", shift: true } },
  { id: "view.grid", label: "Show Grid", section: "View", chord: { key: "g", alt: true }, remap: "Ctrl/⌘R reloads the page, so the grid toggle is Alt+G." },
  { id: "view.weights", label: "Line Weights", section: "View", chord: { key: "w", alt: true } },

  { id: "arrange.group", label: "Group", section: "Arrange", chord: mod("g"), remap: "⌘G was Group. Ctrl/⌘G is Find Next in the browser; the drawing takes it while the page is focused." },
  { id: "arrange.ungroup", label: "Ungroup", section: "Arrange", chord: mod("g", { shift: true }), remap: "Ctrl/⌘U is View Source and cannot be overridden, so Ungroup is Ctrl/⌘Shift+G." },
  { id: "arrange.lock", label: "Lock", section: "Arrange", chord: mod("k", { shift: true }), remap: "Ctrl/⌘L focuses the address bar and Ctrl/⌘K focuses search. Lock is Ctrl/⌘Shift+K." },
  { id: "arrange.unlock", label: "Unlock", section: "Arrange", chord: mod("k", { alt: true }) },
  { id: "arrange.front", label: "Bring to Front", section: "Arrange", chord: mod("]", { shift: true }) },
  { id: "arrange.back", label: "Send to Back", section: "Arrange", chord: mod("[", { shift: true }) },
  { id: "arrange.flipH", label: "Flip Horizontal", section: "Arrange", chord: { key: "h", alt: true }, remap: "Ctrl/⌘H is the browser’s history and cannot be overridden." },
  { id: "arrange.flipV", label: "Flip Vertical", section: "Arrange", chord: { key: "v", alt: true } },
  { id: "arrange.alignLeft", label: "Align Left", section: "Arrange", chord: { key: "ArrowLeft", mod: true, alt: true } },
  { id: "arrange.alignRight", label: "Align Right", section: "Arrange", chord: { key: "ArrowRight", mod: true, alt: true } },
  { id: "arrange.alignTop", label: "Align Top", section: "Arrange", chord: { key: "ArrowUp", mod: true, alt: true } },
  { id: "arrange.alignBottom", label: "Align Bottom", section: "Arrange", chord: { key: "ArrowDown", mod: true, alt: true } },
  { id: "arrange.alignH", label: "Align Centers ↔", section: "Arrange", chord: mod("h", { alt: true }) },
  { id: "arrange.alignV", label: "Align Centers ↕", section: "Arrange", chord: mod("j", { alt: true }) },
  { id: "arrange.rotate", label: "Rotate", section: "Arrange", chord: mod("r", { alt: true }), remap: "Ctrl/⌘R reloads the page, so Rotate is Ctrl/⌘Alt+R." },
  { id: "arrange.scale", label: "Scale", section: "Arrange", chord: mod("s", { alt: true }) },
  { id: "arrange.step", label: "Step and Repeat", section: "Arrange", chord: mod("d", { alt: true }) },
  { id: "arrange.polar", label: "Polar Array", section: "Arrange", chord: mod("p", { alt: true }) },
  { id: "arrange.symbol", label: "Make Symbol", section: "Arrange", chord: mod("y", { shift: true }) },
  { id: "arrange.explode", label: "Explode Symbol", section: "Arrange", chord: mod("y", { alt: true }) },
  { id: "dim.flip", label: "Flip Dimension", section: "Arrange", chord: { key: "f", alt: true, shift: true } },
  { id: "dim.text", label: "Dimension Text", section: "Arrange", chord: { key: "t", alt: true, shift: true } },
  { id: "wall.swing", label: "Flip Door Swing", section: "Arrange", chord: { key: "s", alt: true, shift: true } },
  { id: "symbol.edit", label: "Edit Symbol", section: "Arrange", chord: { key: "e", alt: true, shift: true }, remap: "Ctrl/⌘Shift+E is Export DXF." },
  { id: "layout.title", label: "Title Block", section: "Layout", chord: { key: "b", alt: true, shift: true } },

  { id: "layout.sheet", label: "Rulers & Drawing Size", section: "Layout", chord: mod("r", { alt: true }), remap: "Ctrl/⌘R reloads the page, so the rulers dialog is Ctrl/⌘Alt+R." },

  { id: "window.shortcuts", label: "Shortcuts", section: "Window", chord: mod("/") },
  { id: "window.modifiers", label: "Modifiers", section: "Window", chord: { key: "1", alt: true }, remap: "Ctrl/⌘1 switches browser tabs and cannot be overridden. Palette keys use Alt." },
  { id: "window.layers", label: "Layers", section: "Window", chord: { key: "2", alt: true } },
  { id: "window.attributes", label: "Attributes", section: "Window", chord: { key: "3", alt: true } },
  { id: "window.symbols", label: "Symbols", section: "Window", chord: { key: "4", alt: true } },

  { id: "draw.nudgeLeft", label: "Nudge left", section: "Drawing", chord: { key: "ArrowLeft" }, hint: true },
  { id: "draw.nudgeRight", label: "Nudge right", section: "Drawing", chord: { key: "ArrowRight" }, hint: true },
  { id: "draw.nudgeUp", label: "Nudge up", section: "Drawing", chord: { key: "ArrowUp" }, hint: true },
  { id: "draw.nudgeDown", label: "Nudge down", section: "Drawing", chord: { key: "ArrowDown" }, hint: true },
  { id: "draw.nudgeBig", label: "Nudge ×10", section: "Drawing", chord: { key: "ArrowLeft", shift: true }, hint: true },
  { id: "draw.finish", label: "Finish", section: "Drawing", chord: { key: "Enter" }, hint: true },
  { id: "draw.cancel", label: "Cancel", section: "Drawing", chord: { key: "Escape" }, hint: true },
  { id: "draw.pan", label: "Pan (hold)", section: "Drawing", chord: { key: " " }, hint: true },
  { id: "draw.tab", label: "Type a length", section: "Drawing", chord: { key: "Tab" }, hint: true },
  { id: "draw.ortho", label: "45° lock (hold)", section: "Drawing", chord: { key: "Shift" }, hint: true },
];

const TOOL_SHORTCUTS: Shortcut[] = TOOLS.map((t) => ({
  id: `tool:${t.id}`,
  label: t.label,
  section: "Tools" as const,
  chord: { key: t.key },
}));

export const SHORTCUTS: Shortcut[] = [...TOOL_SHORTCUTS, ...COMMANDS];

export const SECTIONS: ShortcutSection[] = ["Tools", "File", "Edit", "View", "Arrange", "Layout", "Window", "Drawing"];

const norm = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

export function matchShortcut(ev: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Shortcut | undefined {
  const modOn = ev.ctrlKey || ev.metaKey;
  const key = norm(ev.key);
  return SHORTCUTS.find((s) => {
    if (s.hint) return false;
    const names = [s.chord.key, ...(s.chord.alias ?? [])].map(norm);
    return names.includes(key) && !!s.chord.mod === modOn && !!s.chord.shift === ev.shiftKey && !!s.chord.alt === ev.altKey;
  });
}

export function shortcutById(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Delete: "Del",
  Backspace: "⌫",
  Enter: "Enter",
  Tab: "Tab",
  Shift: "Shift",
};

/** Label for menus and the shortcut panel. `mac` chooses ⌘ / ⌥. */
export function chordLabel(chord: Chord, mac: boolean): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (chord.alt) parts.push(mac ? "⌥" : "Alt");
  if (chord.shift) parts.push(mac ? "⇧" : "Shift");
  parts.push(KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return mac ? parts.join("") : parts.join("+");
}

export function shortcutText(id: string, mac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")): string {
  const s = shortcutById(id);
  return s ? chordLabel(s.chord, mac) : "";
}

/** One entry per command in the panel (Redo is listed once). */
export function panelShortcuts(): Shortcut[] {
  const seen = new Set<string>();
  return SHORTCUTS.filter((s) => {
    const key = s.label + s.section;
    if (s.id === "edit.redoY" || s.id === "edit.clear2") return false;
    if (seen.has(key) && s.hint) return false;
    seen.add(key);
    return true;
  });
}
