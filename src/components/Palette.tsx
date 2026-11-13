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
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);

  // Keep the palette on screen after window resizes.
  useEffect(() => {
    const clamp = () =>
      setPos((p) => {
        const w = el.current?.offsetWidth ?? 100;
        return { x: Math.min(Math.max(0, p.x), window.innerWidth - w), y: Math.min(Math.max(20, p.y), window.innerHeight - 30) };
      });
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
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
      <div className="mac-title" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {onClose && <button className="mac-close" aria-label={`Close ${title}`} onClick={onClose} />}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}
