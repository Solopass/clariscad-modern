// Small modal dialog with numeric fields (classic Mac double-bordered box).
import { useState } from "react";
import { formatLength, parseAngle, parseLength, parseNumber } from "../kernel/units";
import { useDocumentStore } from "../state/useDocumentStore";

export interface DialogField {
  key: string;
  label: string;
  kind: "length" | "angle" | "count" | "number";
  value: number;
}

interface Props {
  title: string;
  fields: DialogField[];
  /** A line under the fields (a measured length, a hint). */
  note?: string;
  okLabel?: string;
  onOk(values: Record<string, number>): void;
  onCancel(): void;
}

export function Dialog({ title, fields, note, okLabel = "OK", onOk, onCancel }: Props) {
  const units = useDocumentStore((s) => s.doc.units);
  const show = (f: DialogField) => (f.kind === "length" ? formatLength(f.value, units) : f.kind === "angle" ? `${+((f.value * 180) / Math.PI).toFixed(4)}°` : String(f.value));
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, show(f)])));
  const [error, setError] = useState("");

  const submit = () => {
    try {
      const out: Record<string, number> = {};
      for (const f of fields) {
        const t = text[f.key];
        out[f.key] = f.kind === "length" ? parseLength(t, units) : f.kind === "angle" ? parseAngle(t) : f.kind === "count" ? Math.round(parseNumber(t)) : parseNumber(t);
      }
      onOk(out);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/10 pt-24" onPointerDown={onCancel}>
      <div className="mac-frame p-[3px]" style={{ outline: "1px solid #000", outlineOffset: -4 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="min-w-[280px] p-4">
          <b className="mb-3 block">{title}</b>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
            {fields.map((f, i) => (
              <label key={f.key} className="contents">
                <span className="text-right">{f.label}</span>
                <input
                  autoFocus={i === 0}
                  className="mac-field"
                  value={text[f.key]}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setText({ ...text, [f.key]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                    if (e.key === "Escape") onCancel();
                  }}
                />
              </label>
            ))}
          </div>
          {note && <p className="mt-2 max-w-[320px] text-[11px] text-[#444]">{note}</p>}
          {error && <p className="mt-2 text-[#d6001c]">{error}</p>}
          <div className="mt-4 flex justify-end gap-3">
            <button className="mac-btn" onClick={onCancel}>
              Cancel
            </button>
            <button className="mac-btn" style={{ boxShadow: "0 0 0 2px #fff, 0 0 0 3px #000" }} onClick={submit}>
              {okLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
