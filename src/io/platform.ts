// File access for both the desktop app (Tauri dialogs + fs plugin) and a plain
// browser (File System Access API where available, else upload/download).

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  name: string;
  /** Desktop path (null in the browser). */
  path: string | null;
  bytes: Uint8Array;
  /** Browser file handle, for saving back to the same file (opaque). */
  handle?: unknown;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

type Handle = { createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }>; getFile(): Promise<File>; name: string };
const fsa = () => window as unknown as {
  showOpenFilePicker?: (o: unknown) => Promise<Handle[]>;
  showSaveFilePicker?: (o: unknown) => Promise<Handle>;
};
const pickerTypes = (filters: FileFilter[]) =>
  filters.map((f) => ({ description: f.name, accept: { "application/octet-stream": f.extensions.map((e) => `.${e}`) } }));

export async function openFile(filters: FileFilter[]): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, directory: false, filters });
    if (!path || Array.isArray(path)) return null;
    return { name: baseName(path), path, bytes: await readFile(path) };
  }
  const w = fsa();
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: pickerTypes(filters), multiple: false });
      const file = await h.getFile();
      return { name: file.name, path: null, bytes: new Uint8Array(await file.arrayBuffer()), handle: h };
    } catch {
      return null; // cancelled
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}

/**
 * Save data. With `path` (desktop) or a remembered handle (browser) and `ask` false,
 * writes straight back; otherwise asks where. Returns the chosen name/path, or null if cancelled.
 */
export async function saveFile(opts: {
  suggestedName: string;
  filters: FileFilter[];
  data: string | Uint8Array;
  path?: string | null;
  /** Browser handle of the document's own file (from open or an earlier save). */
  handle?: unknown;
  ask?: boolean;
}): Promise<{ name: string; path: string | null; handle?: unknown } | null> {
  const { data } = opts;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
    let path = opts.ask === false ? opts.path : null;
    if (!path) path = await save({ defaultPath: opts.suggestedName, filters: opts.filters });
    if (!path) return null;
    if (typeof data === "string") await writeTextFile(path, data);
    else await writeFile(path, data);
    return { name: baseName(path), path };
  }
  const w = fsa();
  const blob = new Blob([typeof data === "string" ? data : (data as BlobPart)]);
  let h = opts.ask === false ? (opts.handle as Handle | undefined) : undefined;
  if (!h && w.showSaveFilePicker) {
    try {
      h = await w.showSaveFilePicker({ suggestedName: opts.suggestedName, types: pickerTypes(opts.filters) });
    } catch {
      return null; // cancelled
    }
  }
  if (h) {
    const ws = await h.createWritable();
    await ws.write(blob);
    await ws.close();
    return { name: h.name, path: null, handle: h };
  }
  // Plain download.
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = opts.suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return { name: opts.suggestedName, path: null };
}

/** Desktop window title (the browser tab title is set separately). */
export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}
