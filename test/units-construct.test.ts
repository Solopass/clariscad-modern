import { describe, expect, test } from "bun:test";
import {
  ParseError,
  apply,
  arc3P,
  arcStartEndRadius,
  circle3P,
  dist,
  formatLength,
  invert,
  multiply,
  parseAngle,
  parseLength,
  rect3P,
  regularPolygon,
  regularPolygonFromEdge,
  rotation,
  simplifyPolyline,
  tangentTangentRadius,
  translation,
} from "../src/kernel";

const IN = 25.4;
const FT = 304.8;

describe("parseLength", () => {
  test.each([
    [`12'-4 3/8"`, "architectural", 12 * FT + 4.375 * IN],
    [`12'4"`, "architectural", 12 * FT + 4 * IN],
    [`3/8"`, "architectural", 0.375 * IN],
    ["24 + 3/16", "architectural", (24 + 3 / 16) * IN],
    ["4 3/8", "inches", 4.375 * IN],
    ["12.365'", "engineering", 12.365 * FT],
    ["12.365", "engineering", 12.365 * FT],
    ["1.5m - 20cm", "mm", 1300],
    ["(2' + 3\") * 2", "architectural", 2 * (2 * FT + 3 * IN)],
    ["100 / 4", "mm", 25],
    ["-5mm", "m", -5],
    ["10", "cm", 100],
    ["2 ft", "mm", 2 * FT],
  ] as const)("%s (%s)", (text, sys, mm) => {
    expect(parseLength(text, sys)).toBeCloseTo(mm, 9);
  });

  test("bad input throws ParseError", () => {
    expect(() => parseLength("12 +", "mm")).toThrow(ParseError);
    expect(() => parseLength("abc", "mm")).toThrow(ParseError);
    expect(() => parseLength("2mm * 3mm", "mm")).toThrow(ParseError);
    expect(() => parseLength("1/0", "mm")).toThrow(ParseError);
  });

  test("angles", () => {
    expect(parseAngle("45")).toBeCloseTo(Math.PI / 4, 12);
    expect(parseAngle("90 - 22.5°")).toBeCloseTo((67.5 * Math.PI) / 180, 12);
  });
});

describe("formatLength", () => {
  test("architectural with reduced fractions", () => {
    expect(formatLength(12 * FT + 4.375 * IN, "architectural")).toBe(`12'-4 3/8"`);
    expect(formatLength(0.5 * IN, "architectural")).toBe(`0'-1/2"`);
    expect(formatLength(12 * FT, "architectural")).toBe(`12'-0"`);
    // 11.99999" rounds up into the next foot
    expect(formatLength(11.99999 * IN, "architectural")).toBe(`1'-0"`);
  });
  test("decimal systems", () => {
    expect(formatLength(12.365 * FT, "engineering")).toBe(`12.365'`);
    expect(formatLength(1234.5, "mm")).toBe("1234.50 mm");
    expect(formatLength(1234.5, "m")).toBe("1.2345 m");
  });
  test("round trip", () => {
    for (const mm of [0.1, 25.4, 1000, 3657.6, 9999.9])
      expect(parseLength(formatLength(mm, "mm", { precision: 6 }), "mm")).toBeCloseTo(mm, 6);
  });
});

describe("construction helpers", () => {
  test("circle through three points", () => {
    const c = circle3P({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 })!;
    expect(dist(c.center, { x: 0, y: 0 })).toBeLessThan(1e-12);
    expect(c.r).toBeCloseTo(1, 12);
    expect(circle3P({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  test("3-point arc direction follows the middle point", () => {
    const up = arc3P({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 })!;
    expect(up.start).toBeCloseTo(0, 12);
    expect(up.end).toBeCloseTo(Math.PI, 12);
    const down = arc3P({ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 })!;
    expect(down.start).toBeCloseTo(Math.PI, 12);
    expect(down.end).toBeCloseTo(0, 12);
  });

  test("start-end-radius arc", () => {
    const a = arcStartEndRadius({ x: -3, y: 0 }, { x: 3, y: 0 }, 5)!;
    expect(dist(a.center, { x: 0, y: 4 })).toBeLessThan(1e-12);
    expect(arcStartEndRadius({ x: 0, y: 0 }, { x: 20, y: 0 }, 5)).toBeNull();
  });

  test("regular polygons", () => {
    const hex = regularPolygon({ x: 0, y: 0 }, { x: 2, y: 0 }, 6);
    expect(hex.length).toBe(6);
    for (let i = 0; i < 6; i++) expect(dist(hex[i], hex[(i + 1) % 6])).toBeCloseTo(2, 12);
    const sq = regularPolygon({ x: 0, y: 0 }, { x: 1, y: 0 }, 4, "circumscribed");
    for (const p of sq) expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeCloseTo(1, 12);
    const tri = regularPolygonFromEdge({ x: 0, y: 0 }, { x: 1, y: 0 }, 3);
    expect(tri[2].x).toBeCloseTo(0.5, 12);
    expect(tri[2].y).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  test("3-point rectangle", () => {
    const r = rect3P({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 });
    expect(dist(r[2], { x: 4, y: 3 })).toBeLessThan(1e-12);
    expect(dist(r[3], { x: 0, y: 3 })).toBeLessThan(1e-12);
  });

  test("tangent-tangent-radius between two perpendicular lines", () => {
    const res = tangentTangentRadius(
      { t: "seg", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { t: "seg", a: { x: 0, y: 0 }, b: { x: 0, y: 10 } },
      2,
    );
    expect(res.length).toBe(4);
    const q1 = res.find((c) => c.center.x > 0 && c.center.y > 0)!;
    expect(dist(q1.center, { x: 2, y: 2 })).toBeLessThan(1e-12);
    expect(dist(q1.t1, { x: 2, y: 0 })).toBeLessThan(1e-12);
    expect(dist(q1.t2, { x: 0, y: 2 })).toBeLessThan(1e-12);
  });

  test("tangent-tangent-radius line and circle", () => {
    const res = tangentTangentRadius(
      { t: "seg", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
      { t: "arc", c: { x: 0, y: 3 }, r: 2, start: 0, sweep: 2 * Math.PI },
      1,
    );
    // Circle bottom is at y=1, so the only radius-1 fits sit above the line, touching the circle from outside.
    expect(res.length).toBe(2);
    for (const c of res) {
      expect(Math.abs(c.center.y - 1)).toBeLessThan(1e-9);
      expect(Math.abs(dist(c.center, { x: 0, y: 3 }) - 3)).toBeLessThan(1e-9);
    }
  });
});

describe("transforms and decimation", () => {
  test("compose and invert", () => {
    const t = multiply(translation(5, -2), rotation(0.7));
    const p = { x: 3, y: 4 };
    const back = apply(invert(t), apply(t, p));
    expect(dist(back, p)).toBeLessThan(1e-12);
  });

  test("RDP keeps corners and drops collinear points", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.001 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2.001, y: 2 },
      { x: 2, y: 3 },
    ];
    expect(simplifyPolyline(pts, 0.01)).toEqual([pts[0], pts[2], pts[5]]);
  });
});
