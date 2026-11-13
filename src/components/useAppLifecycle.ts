// App-wide file housekeeping: window title, autosave + recovery, close
// protection, and the File shortcuts (Ctrl/⌘ N, O, S, Shift+S, P).
import { useEffect } from "react";
import { useDocumentStore } from "../state/useDocumentStore";
import { forgetFileHandle } from "../state/fileCommands";
import { parseDocument, serializeDocument } from "../io/nativeJson";
import { clearRecovery, readRecovery, writeRecovery } from "../io/recovery";
import { isTauri, setWindowTitle } from "../io/platform";

const AUTOSAVE_MS = 30_000;

export function useAppLifecycle() {
  // Title: "Plan.tcad • — TemariCad" while unsaved.
  useEffect(() => {
    const update = () => {
      const s = useDocumentStore.getState();
      const layer = s.doc.layers.find((l) => l.id === s.doc.activeLayerId);
      void setWindowTitle(`${s.fileName} — ${layer?.name ?? "Layer"}${s.isDirty() ? " •" : ""} — TemariCad`);
    };
    update();
    return useDocumentStore.subscribe(update);
  }, []);

  // Offer to restore an autosaved drawing on start.
  useEffect(() => {
    void (async () => {
      const r = await readRecovery();
      if (!r) return;
      const when = new Date(r.savedAt).toLocaleString();
      if (window.confirm(`A drawing that was not saved ("${r.fileName}", ${when}) was recovered. Restore it?`)) {
        try {
          const { doc } = parseDocument(r.text);
          forgetFileHandle();
          useDocumentStore.getState().load(doc, { name: r.fileName, dirty: true });
          // Keep the recovery copy until this drawing is saved.
          return;
        } catch (e) {
          window.alert(`The recovered copy could not be read: ${(e as Error).message}`);
        }
      }
      await clearRecovery();
    })();
  }, []);

  // Autosave while there are unsaved changes.
  useEffect(() => {
    let last: unknown = Symbol("nothing autosaved yet");
    const t = setInterval(() => {
      const s = useDocumentStore.getState();
      const top = s.undoStack.at(-1) ?? null;
      if (!s.isDirty() || top === last) return;
      last = top;
      void writeRecovery({ savedAt: new Date().toISOString(), fileName: s.fileName, text: serializeDocument(s.doc) });
    }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, []);

  // Don't lose work on close.
  useEffect(() => {
    if (isTauri()) {
      let un: (() => void) | undefined;
      void (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        un = await getCurrentWindow().onCloseRequested(async (ev) => {
          const s = useDocumentStore.getState();
          if (s.isDirty() && !window.confirm(`"${s.fileName}" has unsaved changes. Quit without saving?`)) {
            ev.preventDefault();
            return;
          }
          await clearRecovery();
        });
      })();
      return () => un?.();
    }
    const before = (e: BeforeUnloadEvent) => {
      if (useDocumentStore.getState().isDirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
}
