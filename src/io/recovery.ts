// Crash recovery: an autosaved copy of an unsaved drawing.
//  Desktop: $APPLOCALDATA/recovery/autosave.tcad (written to a temp file, then renamed).
//  Browser: localStorage (about 5 MB; a too-large drawing just isn't kept).
import { isTauri } from "./platform";

const KEY = "temaricad.recovery.v1";

export interface Recovery {
  savedAt: string;
  fileName: string;
  text: string;
}

async function tauriPaths() {
  const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
  const dir = await join(await appLocalDataDir(), "recovery");
  return { dir, file: await join(dir, "autosave.tcad"), tmp: await join(dir, "autosave.tmp") };
}

export async function writeRecovery(r: Recovery): Promise<boolean> {
  const payload = JSON.stringify(r);
  if (isTauri()) {
    try {
      const fs = await import("@tauri-apps/plugin-fs");
      const p = await tauriPaths();
      await fs.mkdir(p.dir, { recursive: true });
      await fs.writeTextFile(p.tmp, payload);
      await fs.rename(p.tmp, p.file);
      return true;
    } catch {
      return false;
    }
  }
  try {
    localStorage.setItem(KEY, payload);
    return true;
  } catch {
    return false; // quota exceeded or storage blocked
  }
}

export async function readRecovery(): Promise<Recovery | null> {
  try {
    let raw: string | null = null;
    if (isTauri()) {
      const fs = await import("@tauri-apps/plugin-fs");
      const p = await tauriPaths();
      if (await fs.exists(p.file)) raw = await fs.readTextFile(p.file);
    } else raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Recovery;
    return r && typeof r.text === "string" ? r : null;
  } catch {
    return null;
  }
}

export async function clearRecovery(): Promise<void> {
  try {
    if (isTauri()) {
      const fs = await import("@tauri-apps/plugin-fs");
      const p = await tauriPaths();
      if (await fs.exists(p.file)) await fs.remove(p.file);
    } else localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
