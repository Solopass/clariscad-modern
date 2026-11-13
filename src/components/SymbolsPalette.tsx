// Symbol library: the drawing's own symbols plus the built-in set, with
// previews. Click one to place it; make/explode/import/export from here.
import { useEffect, useRef } from "react";
import type { SymbolDef } from "../kernel/types";
import { toPrims } from "../kernel/prims";
import { useDocumentStore } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";
import { BUILTIN_SYMBOLS, deleteSymbol, explodeSelection, exportLibrary, importLibraryOps, makeSymbol, symbolInUse } from "../state/symbols";
import { tracePrim } from "../canvas/render";
import { Palette } from "./Palette";

function Preview({ def, symbols }: { def: SymbolDef; symbols: Map<string, SymbolDef> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = 40 * dpr;
    c.height = 40 * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 40, 40);
    const prims = def.entities.flatMap((e) => toPrims(e, { symbols }));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of prims)
      for (const q of p.t === "seg" ? [p.a, p.b] : p.t === "arc" ? [{ x: p.c.x - p.r, y: p.c.y - p.r }, { x: p.c.x + p.r, y: p.c.y + p.r }] : []) {
        minX = Math.min(minX, q.x);
        minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
    if (!Number.isFinite(minX)) return;
    const zoom = 32 / Math.max(maxX - minX, maxY - minY, 1e-9);
    const cam = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom, width: 40, height: 40 };
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of prims) tracePrim(ctx, cam, p);
    ctx.stroke();
  }, [def, symbols]);
  return <canvas ref={ref} style={{ width: 40, height: 40 }} className="border border-black bg-white" />;
}

export function SymbolsPalette({ onClose }: { onClose(): void }) {
  const doc = useDocumentStore((s) => s.doc);
  const selection = useDocumentStore((s) => s.selection);
  const current = useToolStore((s) => (s.tool === "symbol" ? s.settings.symbolId : null));
  const setSetting = useToolStore((s) => s.setSetting);
  const setTool = useToolStore((s) => s.setTool);
  const file = useRef<HTMLInputElement>(null);

  const own = doc.symbols;
  const builtins = BUILTIN_SYMBOLS.filter((b) => !own.some((s) => s.id === b.id));
  const all = new Map([...BUILTIN_SYMBOLS, ...own].map((s) => [s.id, s]));
  const hasInstances = doc.entities.some((e) => selection.has(e.id) && e.kind === "symbol");

  const pick = (id: string) => {
    setSetting("symbolId", id);
    setTool("symbol");
  };

  const download = () => {
    const blob = new Blob([exportLibrary(own)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "symbols.tcsym";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const row = (def: SymbolDef, builtin: boolean) => (
    <div
      key={def.id}
      className="mac-menu-item flex cursor-default items-center gap-2 px-1 py-[2px]"
      style={{ background: current === def.id ? "#000" : undefined, color: current === def.id ? "#fff" : undefined }}
      onClick={() => pick(def.id)}
      title={def.opening ? "Click, then click on a wall to put it in an opening" : "Click, then click in the drawing to place it"}
    >
      <Preview def={def} symbols={all} />
      <span className="flex-1 truncate">{def.name}</span>
      {builtin ? (
        <span className="text-[9px] opacity-60">built-in</span>
      ) : (
        !symbolInUse(doc, def.id) && (
          <button
            className="px-1 text-[10px]"
            title="Delete this unused symbol"
            onClick={(e) => {
              e.stopPropagation();
              deleteSymbol(def.id);
            }}
          >
            ✕
          </button>
        )
      )}
    </div>
  );

  return (
    <Palette id="symbols" title="Symbols" initial={{ x: 26, y: 404 }} onClose={onClose}>
      <div className="w-[220px]">
        <div className="max-h-[260px] overflow-y-auto">
          {own.map((d) => row(d, false))}
          {builtins.map((d) => row(d, true))}
        </div>
        <div className="flex flex-wrap gap-1 border-t border-black p-1">
          <button
            className="mac-btn"
            disabled={!selection.size}
            onClick={() => {
              const name = prompt("Symbol name", `Symbol ${own.length + 1}`);
              if (name) makeSymbol(name);
            }}
          >
            Make
          </button>
          <button className="mac-btn" disabled={!hasInstances} onClick={explodeSelection}>
            Explode
          </button>
          <button className="mac-btn" onClick={() => file.current?.click()}>
            Import…
          </button>
          <button className="mac-btn" disabled={!own.length} onClick={download}>
            Export…
          </button>
          <input
            ref={file}
            type="file"
            accept=".tcsym,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const s = useDocumentStore.getState();
                const { ops, added } = importLibraryOps(s.doc, await f.text());
                if (ops.length) s.commit({ label: "Import Symbols", ops });
                alert(added ? `Imported ${added} symbol(s).` : "Those symbols are already in this drawing.");
              } catch (err) {
                alert((err as Error).message);
              }
            }}
          />
        </div>
      </div>
    </Palette>
  );
}
