// Length parsing and formatting. Model units are millimetres.
//
// parseLength accepts arithmetic with units, e.g.
//   12'-4 3/8"     24 + 3/16     3/8"     1.5m - 20cm     (2' + 3") * 2
// Bare numbers take the unit system's default unit (inches for architectural).
import type { UnitSystem } from "./types";

export const MM_PER = { in: 25.4, ft: 304.8, mm: 1, cm: 10, m: 1000 } as const;
type Unit = keyof typeof MM_PER;

export const DEFAULT_UNIT: Record<UnitSystem, Unit> = {
  architectural: "in",
  engineering: "ft",
  inches: "in",
  feet: "ft",
  mm: "mm",
  cm: "cm",
  m: "m",
};

interface Val {
  v: number;
  /** True when v is a length in mm; false for a bare number. */
  len: boolean;
}

const UNIT_RE = /^\s*(mm|cm|m(?![a-z])|inches|inch|in(?![a-z])|feet|foot|ft|'|"|′|″)/i;
const NUM_RE = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i;
const FRAC_RE = /^\/(\d+\.?\d*)/;
const MIXED_RE = /^\s+(\d+\.?\d*)\/(\d+\.?\d*)/;

function unitOf(tok: string): Unit {
  const t = tok.toLowerCase();
  if (t === "'" || t === "′" || t === "ft" || t === "feet" || t === "foot") return "ft";
  if (t === '"' || t === "″" || t === "in" || t === "inch" || t === "inches") return "in";
  return t as Unit;
}

export class ParseError extends Error {}

class Parser {
  i = 0;
  constructor(
    private s: string,
    private def: number,
  ) {}

  private rest() {
    return this.s.slice(this.i);
  }
  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  private bare(a: Val): number {
    return a.len ? a.v : a.v * this.def;
  }

  parse(): Val {
    const v = this.expr();
    this.ws();
    if (this.i < this.s.length) throw new ParseError(`Unexpected "${this.s.slice(this.i)}"`);
    return v;
  }

  private expr(): Val {
    let a = this.term();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c !== "+" && c !== "-") return a;
      this.i++;
      const b = this.term();
      const sign = c === "+" ? 1 : -1;
      a = a.len === b.len ? { v: a.v + sign * b.v, len: a.len } : { v: this.bare(a) + sign * this.bare(b), len: true };
    }
  }

  private term(): Val {
    let a = this.factor();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c !== "*" && c !== "/" && c !== "×" && c !== "÷") return a;
      this.i++;
      const b = this.factor();
      if (c === "*" || c === "×") {
        if (a.len && b.len) throw new ParseError("Cannot multiply two lengths");
        a = { v: a.v * b.v, len: a.len || b.len };
      } else {
        if (b.v === 0) throw new ParseError("Division by zero");
        if (b.len && !a.len) throw new ParseError("Cannot divide a number by a length");
        a = { v: a.v / b.v, len: a.len && !b.len };
      }
    }
  }

  private factor(): Val {
    this.ws();
    const c = this.s[this.i];
    if (c === "-") {
      this.i++;
      const f = this.factor();
      return { v: -f.v, len: f.len };
    }
    if (c === "+") {
      this.i++;
      return this.factor();
    }
    if (c === "(") {
      this.i++;
      const v = this.expr();
      this.ws();
      if (this.s[this.i] !== ")") throw new ParseError("Missing )");
      this.i++;
      const u = UNIT_RE.exec(this.rest());
      if (u && !v.len) {
        this.i += u[0].length;
        return { v: v.v * MM_PER[unitOf(u[1])], len: true };
      }
      return v;
    }
    return this.quantity().val;
  }

  /** number [fraction | mixed fraction] [unit] [, and after feet: an optional "-inches" part] */
  private quantity(): { val: Val; unit?: Unit } {
    this.ws();
    const m = NUM_RE.exec(this.rest());
    if (!m) throw new ParseError(this.i >= this.s.length ? "Unexpected end of input" : `Unexpected "${this.s[this.i]}"`);
    this.i += m[0].length;
    let n = parseFloat(m[0]);
    const f = FRAC_RE.exec(this.rest());
    if (f) {
      const den = parseFloat(f[1]);
      if (den === 0) throw new ParseError("Division by zero");
      n /= den;
      this.i += f[0].length;
    } else {
      const mx = MIXED_RE.exec(this.rest());
      if (mx) {
        const den = parseFloat(mx[2]);
        if (den === 0) throw new ParseError("Division by zero");
        n += parseFloat(mx[1]) / den;
        this.i += mx[0].length;
      }
    }
    const u = UNIT_RE.exec(this.rest());
    if (!u) return { val: { v: n, len: false } };
    this.i += u[0].length;
    const unit = unitOf(u[1]);
    let v = n * MM_PER[unit];
    if (unit === "ft") {
      // Architectural 12'-4 3/8", 12'4" or 12' 4": an unspaced dash is a separator.
      // A spaced dash (10' - 6") is a real minus and is left for expr().
      const save = this.i;
      const after = /^(-|\s*)(?=[\d.])/.exec(this.rest());
      if (after) {
        this.i += after[0].length;
        const q = this.quantity();
        if (!q.unit || q.unit === "in") v += q.unit ? q.val.v : q.val.v * MM_PER.in;
        else this.i = save;
      }
    }
    return { val: { v, len: true }, unit };
  }
}

/** Parse a length expression to millimetres. Throws ParseError on bad input. */
export function parseLength(text: string, system: UnitSystem = "mm"): number {
  const def = MM_PER[DEFAULT_UNIT[system]];
  const v = new Parser(text.trim(), def).parse();
  return v.len ? v.v : v.v * def;
}

/** Parse a plain number expression (no units), e.g. "360/7". */
export function parseNumber(text: string): number {
  const v = new Parser(text.trim(), 1).parse();
  if (v.len) throw new ParseError("Units are not allowed here");
  return v.v;
}

/** Parse an angle in degrees ("45", "22.5°", "90 - 15") to radians. */
export function parseAngle(text: string): number {
  return (parseNumber(text.replace(/°|deg/gi, "")) * Math.PI) / 180;
}

export interface FormatOptions {
  /** Decimal places for decimal systems. */
  precision?: number;
  /** Smallest fraction for architectural (default 16 → 1/16"). */
  denominator?: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function formatLength(mm: number, system: UnitSystem, opts: FormatOptions = {}): string {
  const neg = mm < 0;
  const a = Math.abs(mm);
  const sign = neg ? "-" : "";
  switch (system) {
    case "architectural": {
      const den = opts.denominator ?? 16;
      const n = Math.round((a / MM_PER.in) * den);
      const feet = Math.floor(n / (12 * den));
      const rem = n - feet * 12 * den;
      const whole = Math.floor(rem / den);
      let fn = rem - whole * den;
      let fd = den;
      if (fn) {
        const g = gcd(fn, fd);
        fn /= g;
        fd /= g;
      }
      const inch = fn ? (whole ? `${whole} ${fn}/${fd}` : `${fn}/${fd}`) : `${whole}`;
      return n === 0 ? `0'-0"` : `${sign}${feet}'-${inch}"`;
    }
    case "engineering":
      return `${sign}${(a / MM_PER.ft).toFixed(opts.precision ?? 3)}'`;
    case "feet":
      return `${sign}${(a / MM_PER.ft).toFixed(opts.precision ?? 4)}'`;
    case "inches":
      return `${sign}${(a / MM_PER.in).toFixed(opts.precision ?? 4)}"`;
    case "mm":
      return `${sign}${a.toFixed(opts.precision ?? 2)} mm`;
    case "cm":
      return `${sign}${(a / MM_PER.cm).toFixed(opts.precision ?? 3)} cm`;
    case "m":
      return `${sign}${(a / MM_PER.m).toFixed(opts.precision ?? 4)} m`;
  }
}

export function formatAngle(rad: number, precision = 2): string {
  let deg = (rad * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  return `${deg.toFixed(precision)}°`;
}
