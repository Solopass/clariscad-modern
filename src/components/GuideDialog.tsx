// Classic Mac-styled User Guide modal, parsed from src/guide/GUIDE.md.
// Organized into tabbed sections with live keyword search.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import guideMd from "../guide/GUIDE.md?raw";

export interface GuideSection {
  id: string;
  title: string;
  body: string;
}

export function parseGuideSections(md: string): GuideSection[] {
  const parts = md.split(/\r?\n## /);
  return parts.slice(1).map((raw, idx) => {
    const nl = raw.indexOf("\n");
    const title = (nl >= 0 ? raw.slice(0, nl) : raw).trim();
    const body = (nl >= 0 ? raw.slice(nl + 1) : "").trim();
    return { id: `sec-${idx}`, title, body };
  });
}

export const GUIDE_SECTIONS: GuideSection[] = parseGuideSections(guideMd);

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={k++} className="rounded-[2px] border border-black/40 bg-[#f3f3f3] px-1 py-[0.5px] font-mono text-[10.5px]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={k++}>{renderInline(tok.slice(2, -2))}</strong>);
    } else {
      out.push(<em key={k++}>{renderInline(tok.slice(1, -1))}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function MarkdownView({ body }: { body: string }) {
  const lines = body.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={k++} className="mt-3 mb-1 border-b border-dotted border-black/40 pb-0.5 text-[12px] font-bold">
          {renderInline(line.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <div key={k++} className="my-2 border-l-2 border-black bg-[#f6f6f6] px-2.5 py-1.5 text-[11px]">
          {renderInline(quote.join(" "))}
        </div>,
      );
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        rows.push(cells);
        i++;
      }
      const header = rows[0] ?? [];
      const data = rows.slice(2); // skip | :--- | separator
      nodes.push(
        <table key={k++} className="my-2 w-full border-collapse border border-black text-[11px]">
          <thead>
            <tr className="bg-[#eee]">
              {header.map((h, ci) => (
                <th key={ci} className="border border-black px-2 py-1 text-left font-bold">
                  {renderInline(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, ri) => (
              <tr key={ri} className={ri % 2 ? "bg-[#fafafa]" : "bg-white"}>
                {r.map((c, ci) => (
                  <td key={ci} className="border border-black px-2 py-1 align-top">
                    {renderInline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (line.startsWith("- ") || /^\d+\.\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s/.test(lines[i]) : lines[i].startsWith("- "))) {
        items.push(lines[i].replace(/^(- |\d+\.\s)/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      nodes.push(
        <Tag key={k++} className={`my-1.5 space-y-1 pl-5 text-[11.5px] leading-[1.45] ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("#") && !lines[i].startsWith("- ") && !lines[i].startsWith("|") && !lines[i].startsWith("> ") && !/^\d+\.\s/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    nodes.push(
      <p key={k++} className="my-1.5 text-[11.5px] leading-[1.5]">
        {renderInline(para.join(" "))}
      </p>,
    );
  }

  return <div>{nodes}</div>;
}

export function GuideDialog({ initialTab = 0, onClose }: { initialTab?: number; onClose(): void }) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      GUIDE_SECTIONS.map((s, idx) => ({
        idx,
        hit: !q || s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
      })),
    [q],
  );

  const active = GUIDE_SECTIONS[tab] ?? GUIDE_SECTIONS[0];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/15 p-4" onPointerDown={onClose}>
      <div
        className="mac-frame flex h-[min(82vh,640px)] w-[min(92vw,840px)] flex-col p-[3px]"
        style={{ outline: "1px solid #000", outlineOffset: -4 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mac-title shrink-0">
          <button className="mac-close" aria-label="Close Guide" onClick={onClose} />
          <span>TemariCad User Guide</span>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black bg-[#f7f7f7] px-3 py-1.5">
          <span className="text-[11px] font-bold">Complete Reference &amp; Workflows</span>
          <div className="flex items-center gap-1.5">
            <input
              type="search"
              placeholder="Search guide (e.g. fillet, dxf, hatch)…"
              className="mac-field w-[240px]"
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                const nq = next.trim().toLowerCase();
                if (nq) {
                  const first = GUIDE_SECTIONS.findIndex((s) => s.title.toLowerCase().includes(nq) || s.body.toLowerCase().includes(nq));
                  if (first >= 0) setTab(first);
                }
              }}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 bg-white">
          <nav className="w-[190px] shrink-0 overflow-y-auto border-r border-black bg-[#f4f4f4] p-1.5" aria-label="Guide sections">
            {GUIDE_SECTIONS.map((s, i) => {
              const selected = i === tab;
              const matched = matches[i]?.hit;
              return (
                <button
                  key={s.id}
                  onClick={() => setTab(i)}
                  className="mb-0.5 block w-full border px-2 py-1.5 text-left text-[11px]"
                  style={{
                    borderColor: selected ? "#000" : "transparent",
                    background: selected ? "#000" : matched && q ? "#fff" : "transparent",
                    color: selected ? "#fff" : matched ? "#000" : "#999",
                    fontWeight: selected || (matched && q) ? 700 : 400,
                  }}
                >
                  {i + 1}. {s.title}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
            <h2 className="mb-2 border-b-2 border-black pb-1 text-[15px] font-bold">{active.title}</h2>
            <MarkdownView body={active.body} />
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-black bg-white px-3 py-1.5">
          <span className="text-[10.5px] text-[#555]">Source: src/guide/GUIDE.md</span>
          <div className="flex gap-2">
            <button
              className="mac-btn"
              disabled={tab <= 0}
              onClick={() => setTab((t) => Math.max(0, t - 1))}
            >
              ◀ Prev
            </button>
            <button
              className="mac-btn"
              disabled={tab >= GUIDE_SECTIONS.length - 1}
              onClick={() => setTab((t) => Math.min(GUIDE_SECTIONS.length - 1, t + 1))}
            >
              Next ▶
            </button>
            <button className="mac-btn" style={{ boxShadow: "0 0 0 2px #fff, 0 0 0 3px #000" }} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
