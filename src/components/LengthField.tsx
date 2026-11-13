// Numeric field that accepts unit expressions (12'-4 3/8", 24 + 3/16, 1.5m)
// and shows its value in the drawing's units. Commits on Enter or blur.
import { useEffect, useState } from "react";
import { formatLength, parseAngle, parseLength, parseNumber } from "../kernel/units";
import { useDocumentStore } from "../state/useDocumentStore";

interface Props {
  value: number;
  onChange(v: number): void;
  kind?: "length" | "angle" | "count";
  width?: number;
  min?: number;
  max?: number;
  label?: string;
}

export function LengthField({ value, onChange, kind = "length", width = 80, min, max, label }: Props) {
  const units = useDocumentStore((s) => s.doc.units);
  const show = (v: number) => (kind === "length" ? formatLength(v, units) : kind === "angle" ? `${+v.toFixed(4)}°` : String(v));
  const [text, setText] = useState(show(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(show(value)), [value, units]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    try {
      let v = kind === "length" ? parseLength(text, units) : kind === "angle" ? (parseAngle(text) * 180) / Math.PI : Math.round(parseNumber(text));
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      setBad(false);
      onChange(v);
      setText(show(v));
    } catch {
      setBad(true);
    }
  };

  return (
    <label className="inline-flex items-center gap-1">
      {label && <span>{label}</span>}
      <input
        className="mac-field"
        style={{ width, borderColor: bad ? "#d6001c" : undefined }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setText(show(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}
