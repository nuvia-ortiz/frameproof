import { describe, expect, it } from "vitest";
import type { PageText } from "../../src/capture.js";
import { colorDistance, compareTexts, overlapRatio, primaryFamily, similarity } from "../../src/compare.js";
import { findRegions } from "../../src/pixels.js";
import type { DesignText } from "../../src/spec.js";

const style = { fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 24, letterSpacing: 0, color: "#222222" };
const d = (over: Partial<DesignText>): DesignText => ({
  id: "x",
  name: over.text ?? "x",
  text: "x",
  box: { x: 0, y: 0, width: 100, height: 24 },
  align: "left",
  ...style,
  ...over,
});
const p = (over: Partial<PageText>): PageText => ({
  text: "x",
  selector: "p",
  box: { x: 0, y: 0, width: 100, height: 24 },
  align: "left",
  ...style,
  fontFamily: '"Inter", system-ui, sans-serif',
  ...over,
});

describe("compareTexts", () => {
  it("passes when everything matches within tolerance", () => {
    const res = compareTexts(
      [d({ text: "Book a table" })],
      [p({ text: "Book  a table", box: { x: 3, y: -2, width: 98, height: 24 }, color: "#252525", fontSize: 16.4 })],
    );
    expect(res).toEqual({ issues: [], matched: 1, total: 1 });
  });

  it("reports each wrong property separately", () => {
    const res = compareTexts(
      [d({ text: "Hello", fontWeight: 600, fontSize: 48, lineHeight: 56, letterSpacing: -0.5, color: "#2f6b4f" })],
      [p({ text: "Hello", fontWeight: 400, fontSize: 44, lineHeight: 52, letterSpacing: 0, color: "#3d8a63", fontFamily: "Arial, sans-serif" })],
    );
    expect(res.issues.map((i) => i.kind).sort()).toEqual(["color", "font-family", "font-size", "font-weight", "letter-spacing", "line-height"]);
    expect(res.issues.find((i) => i.kind === "font-size")).toMatchObject({ expected: "48px", actual: "44px" });
  });

  it("measures centred text from its centre, so a wider box doesn't count as moved", () => {
    const res = compareTexts(
      [d({ text: "Centred", align: "center", box: { x: 100, y: 0, width: 200, height: 24 } })],
      [p({ text: "Centred", align: "center", box: { x: 0, y: 0, width: 400, height: 24 } })],
    );
    expect(res.issues).toEqual([]);
  });

  it("reports drift with direction", () => {
    const res = compareTexts([d({ text: "Moved" })], [p({ text: "Moved", box: { x: 0, y: 12, width: 100, height: 24 } })]);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]).toMatchObject({ kind: "position", offset: { dx: 0, dy: 12 } });
  });

  it("pairs repeated labels by position", () => {
    const res = compareTexts(
      [d({ text: "Add", box: { x: 0, y: 0, width: 40, height: 20 } }), d({ text: "Add", box: { x: 0, y: 300, width: 40, height: 20 }, color: "#ff0000" })],
      [p({ text: "Add", box: { x: 0, y: 301, width: 40, height: 20 }, selector: "#second" }), p({ text: "Add", box: { x: 0, y: 1, width: 40, height: 20 }, selector: "#first" })],
    );
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]).toMatchObject({ kind: "color", selector: "#second" });
  });

  it("finds rewritten copy at the same place and flags missing text", () => {
    const res = compareTexts(
      [d({ text: "Clases en grupo", box: { x: 0, y: 0, width: 140, height: 28 } }), d({ text: "Aviso legal", box: { x: 0, y: 500, width: 80, height: 20 } })],
      [p({ text: "Clases grupales", box: { x: 0, y: 0, width: 130, height: 28 } })],
    );
    expect(res.matched).toBe(1);
    expect(res.issues.map((i) => [i.kind, i.layer])).toEqual([
      ["text", "Clases en grupo"],
      ["missing", "Aviso legal"],
    ]);
  });

  it("lets an exact match win over a near match", () => {
    // "Contact us" would grab the "Contact" element if it were matched first.
    const res = compareTexts(
      [d({ text: "Contact us", box: { x: 0, y: 100, width: 90, height: 20 } }), d({ text: "Contact", box: { x: 0, y: 0, width: 60, height: 20 } })],
      [p({ text: "Contact", box: { x: 0, y: 100, width: 60, height: 20 } })],
    );
    expect(res.issues.find((i) => i.layer === "Contact")?.kind).toBe("position");
    expect(res.issues.find((i) => i.layer === "Contact us")?.kind).toBe("missing");
  });
});

describe("helpers", () => {
  it("similarity ignores case and spacing", () => {
    expect(similarity("Hello  World", "hello world")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });
  it("primaryFamily unquotes the first family", () => {
    expect(primaryFamily('"Fraunces", Georgia, serif')).toBe("Fraunces");
  });
  it("colorDistance", () => {
    expect(colorDistance("#000000", "#000")).toBe(0);
    expect(Math.round(colorDistance("#000000", "#ffffff"))).toBe(442);
  });
  it("overlapRatio uses the smaller box", () => {
    expect(overlapRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(1);
    expect(overlapRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 })).toBe(0);
  });
});

describe("findRegions", () => {
  const W = 100;
  const H = 100;
  const paint = (mask: Uint8Array, x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) mask[y * W + x] = 1;
  };

  it("groups nearby changes and keeps distant ones apart", () => {
    const mask = new Uint8Array(W * H);
    paint(mask, 2, 2, 10, 10);
    paint(mask, 20, 4, 6, 6); // within the two-cell gap → same region
    paint(mask, 70, 80, 12, 12);
    const boxes = findRegions(mask, W, H);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual({ x: 0, y: 0, width: 32, height: 16 });
    expect(boxes[1]).toEqual({ x: 64, y: 80, width: 24, height: 16 });
  });

  it("ignores isolated noise pixels", () => {
    const mask = new Uint8Array(W * H);
    mask[50 * W + 50] = 1;
    mask[10 * W + 90] = 1;
    expect(findRegions(mask, W, H)).toEqual([]);
  });
});
