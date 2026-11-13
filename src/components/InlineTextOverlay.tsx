// Floating on-canvas text editor triggered by the Text tool or double-clicking text.
// Enter commits, Shift+Enter inserts a newline, Escape cancels.
import { useEffect, useRef, useState } from "react";

interface EditReq {
  x: number;
  y: number;
  initial: string;
  fontSizePx: number;
  onCommit(text: string): void;
}

export function InlineTextOverlay() {
  const [req, setReq] = useState<EditReq | null>(null);
  const [val, setVal] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const onReq = (e: Event) => {
      const detail = (e as CustomEvent<EditReq>).detail;
      doneRef.current = false;
      setReq(detail);
      setVal(detail.initial);
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.select();
      });
    };
    window.addEventListener("temaricad:text-edit", onReq);
    return () => window.removeEventListener("temaricad:text-edit", onReq);
  }, []);

  if (!req) return null;

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const text = val.trimEnd();
    const cb = req.onCommit;
    setReq(null);
    if (commit && text.trim()) cb(text);
  };

  return (
    <textarea
      ref={ref}
      value={val}
      rows={Math.max(1, val.split("\n").length)}
      placeholder="Type text (Shift+Enter for new line)…"
      className="mac-field absolute z-30 min-w-[160px] resize border border-black bg-white/95 px-1.5 py-0.5 font-sans leading-[1.35] shadow-[2px_2px_0_#000]"
      style={{
        left: Math.max(4, req.x),
        top: Math.max(4, req.y - req.fontSizePx * 0.9),
        fontSize: req.fontSizePx,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
      }}
    />
  );
}
