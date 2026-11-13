// Minimal PDF 1.4 writer: vector pages with lines, fills and Helvetica text.
// Everything written is 7-bit ASCII (text uses WinAnsi octal escapes), so
// string length == byte length and the xref offsets are exact.

export interface PdfPage {
  /** Page size in points (1/72 in). */
  width: number;
  height: number;
  /** Content stream operators (already in PDF syntax). */
  ops: string[];
}

/** Number formatting: short, no exponents, no "-0". */
export const n = (v: number): string => {
  if (!Number.isFinite(v)) throw new Error(`PDF: invalid number ${v}`);
  const r = Math.round(v * 1000) / 1000;
  return (Object.is(r, -0) ? 0 : r).toString();
};

// WinAnsi (cp1252) codes for characters outside Latin-1 that we use; Latin-1 maps to itself.
const WIN_ANSI_EXTRA: Record<string, number> = { "€": 0x80, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94 };
// Symbols with no WinAnsi glyph get a close stand-in.
const SUBSTITUTE: Record<string, string> = { "⌀": "Ø", "Δ": "D", "≈": "~", "′": "'", "″": '"' };

/** A PDF literal string in WinAnsi encoding, ASCII-only bytes. */
export function pdfString(text: string): string {
  let out = "(";
  for (const raw of text) {
    const ch = SUBSTITUTE[raw] ?? raw;
    let code = ch.codePointAt(0)!;
    if (code > 255) code = WIN_ANSI_EXTRA[ch] ?? 0x3f; // '?'
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code < 32 || code > 126) out += "\\" + code.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out + ")";
}

/** Serialise pages to a PDF file (as a binary-safe string of ASCII bytes). */
export function buildPdf(pages: PdfPage[], info: { title?: string; producer?: string } = {}): string {
  const objects: string[] = []; // 1-based object bodies
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(""); // placeholder, filled below
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const infoObj = add(`<< /Producer ${pdfString(info.producer ?? "TemariCad")} /Title ${pdfString(info.title ?? "Drawing")} >>`);
  const kids: number[] = [];
  for (const p of pages) {
    const stream = p.ops.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(p.width)} ${n(p.height)}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/** Bytes for saving (every char is < 128). */
export const pdfBytes = (pdf: string): Uint8Array => Uint8Array.from(pdf, (c) => c.charCodeAt(0));
