import { useEffect, useRef } from "react";
import { ViewportController, viewportRef } from "../canvas/controller";
import { useDocumentStore } from "../state/useDocumentStore";
import { useToolStore } from "../state/useToolStore";

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLCanvasElement>(null);
  const stat = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = new ViewportController(host.current!, grid.current!, stat.current!, over.current!);
    viewportRef.current = c;
    // Dev hooks for console/automated checks (import() from the console can get a second module copy).
    Object.assign(window, { __cad: c, __stores: { doc: useDocumentStore, tool: useToolStore } });
    return () => {
      c.dispose();
      viewportRef.current = null;
    };
  }, []);

  return (
    <div ref={host} className="viewport relative h-full w-full overflow-hidden">
      <canvas ref={grid} />
      <canvas ref={stat} />
      <canvas ref={over} className="overlay" />
    </div>
  );
}
