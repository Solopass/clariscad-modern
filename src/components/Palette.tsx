// Floating palette window: striped title bar, close box, drag to move.
// Position is remembered per viewer (best effort).
import { type ReactNode, useEffect, useRef, useState } from "react";

interface Props {
  id: string;
  title: string;
  initial: { x: number; y: number };
  onClose?: () => void;
  children: ReactNode;
}

const key = (id: string) => `temaricad.palette.${id}`;

function loadPos(id: string, fallback: { x: number; y: number }) {
  try {
    const raw = localStorage.getItem(key(id));
    if (raw) return JSON.parse(raw) as { x: number; y: number };
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

export function Palette({ id, title, initial, onClose, children }: Props) {
  const [pos, setPos] = useState(() => loadPos(id, initial));
  const [shaded, setShaded] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onReset = () => {
      setShaded(false);
      setPos(initial);
    };
    window.addEventListener("temaricad:reset-palettes", onReset);
    return () => window.removeEventListener("temaricad:reset-palettes", onReset);
  }, [initial]);

  // Keep the palette inside its viewport container after window/panel resizes.
  useEffect(() => {
    const clamp = () => {
      const node = el.current;
      const parent = node?.parentElement;
      const pw = parent?.clientWidth ?? window.innerWidth;
      const ph = parent?.clientHeight ?? window.innerHeight;
      const w = node?.offsetWidth ?? 100;
      const h = node?.offsetHeight ?? 40;
      setPos((p) => ({
        x: Math.min(Math.max(0, p.x), Math.max(0, pw - w)),
        y: Math.min(Math.max(20, p.y), Math.max(20, ph - h)),
      }));
    };
    clamp();
    const ro = el.current?.parentElement ? new ResizeObserver(clamp) : null;
    if (el.current?.parentElement) ro?.observe(el.current.parentElement);
    window.addEventListener("resize", clamp);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", clamp);
    };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({ x: e.clientX - drag.current.dx, y: Math.max(20, e.clientY - drag.current.dy) });
  };
  const onUp = () => {
    drag.current = null;
    try {
      localStorage.setItem(key(id), JSON.stringify(pos));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div ref={el} className="mac-frame absolute z-20" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div
        className="mac-title"
        title="Drag to move, double-click to roll up"
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) setShaded((s) => !s);
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {onClose && <button className="mac-close" aria-label={`Close ${title}`} onClick={onClose} />}
        <span>{title}</span>
        <button
          className="mac-close"
          style={{ left: "auto", right: 6 }}
          aria-label={shaded ? `Expand ${title}` : `Collapse ${title}`}
          title={shaded ? "Expand" : "Roll up (WindowShade)"}
          onClick={() => setShaded((s) => !s)}
        />
      </div>
      {!shaded && children}
    </div>
  );
}
