// Edit the five title-block fields. The sheet and the Plot dialog share them.
import { useState } from "react";
import type { TitleBlock } from "../kernel/types";
import { setTitleBlock, titleBlockOf } from "../state/titleBlock";
import { useDocumentStore } from "../state/useDocumentStore";

const FIELDS: [keyof TitleBlock, string][] = [
  ["title", "Title"],
  ["drawnBy", "Drawn by"],
  ["date", "Date"],
  ["scale", "Scale"],
  ["sheetNo", "Sheet no."],
];

export function TitleFields({ compact = false }: { compact?: boolean }) {
  const doc = useDocumentStore((s) => s.doc);
  const current = titleBlockOf(doc);
  const [draft, setDraft] = useState(current);
  const [key, setKey] = useState(JSON.stringify(current));
  const live = JSON.stringify(current);
  if (live !== key) {
    setKey(live);
    setDraft(current);
  }
  const commit = (next: TitleBlock) => {
    setDraft(next);
    setTitleBlock(next);
  };
  return (
    <div className="flex flex-col gap-1">
      {FIELDS.map(([k, label]) => (
        <label key={k} className="flex items-center justify-between gap-2 text-[12px]">
          {label}
          <input
            className={compact ? "mac-field w-[150px]" : "mac-field w-[160px]"}
            value={draft[k]}
            placeholder={k === "scale" ? "layer scale" : k === "title" ? "Untitled" : ""}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            onBlur={() => {
              if (draft[k] !== current[k]) commit({ ...current, [k]: draft[k] });
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function TitleBlockDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/10 pt-20" onPointerDown={onClose}>
      <div className="mac-frame p-[3px]" style={{ outline: "1px solid #000", outlineOffset: -4 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex w-[300px] flex-col gap-2 p-4">
          <b>Title Block</b>
          <TitleFields />
          <div className="mt-2 flex justify-end">
            <button className="mac-btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
