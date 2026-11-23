import type { PageText } from "./capture.js";
import type { Box, DesignText } from "./spec.js";

export type IssueKind =
  | "missing"
  | "text"
  | "font-family"
  | "font-size"
  | "font-weight"
  | "line-height"
  | "letter-spacing"
  | "color"
  | "position";

export interface Issue {
  kind: IssueKind;
  layer: string;
  expected: string;
  actual: string;
  designBox: Box;
  pageBox?: Box;
  selector?: string;
  /** For "position": how far the page element sits from the design, rounded to 0.1px (0 = within tolerance). */
  offset?: { dx: number; dy: number };
  message: string;
}

export interface Tolerances {
  /** px of drift allowed before a text counts as moved */
  position: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  /** Euclidean distance in 0–255 RGB space */
  color: number;
}

export const DEFAULT_TOLERANCES: Tolerances = { position: 4, fontSize: 0.5, lineHeight: 1, letterSpacing: 0.2, color: 12 };

export const normalizeText = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const key = (s: string) => normalizeText(s).toLowerCase();

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export const similarity = (a: string, b: string) => {
  const x = key(a);
  const y = key(b);
  const len = Math.max(x.length, y.length);
  return len ? 1 - levenshtein(x, y) / len : 1;
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export const colorDistance = (a: string, b: string) => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

/** First family of a CSS font stack, unquoted. */
export const primaryFamily = (stack: string) =>
  stack
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");

const anchorX = (b: Box, align: DesignText["align"]) =>
  align === "center" ? b.x + b.width / 2 : align === "right" ? b.x + b.width : b.x;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Pairs each design text with the page element that best matches it (same words first, then the closest one),
 * then compares their style and position. Each page element is used once.
 */
export function compareTexts(design: DesignText[], page: PageText[], tol: Tolerances = DEFAULT_TOLERANCES) {
  const issues: Issue[] = [];
  const used = new Set<number>();
  let matched = 0;

  // Exact text matches are claimed first so a near match can't steal an element that belongs to another layer.
  const order = [...design].sort((a, b) => {
    const ea = page.some((p) => key(p.text) === key(a.text)) ? 0 : 1;
    const eb = page.some((p) => key(p.text) === key(b.text)) ? 0 : 1;
    return ea - eb;
  });

  for (const d of order) {
    let best = -1;
    let bestScore = -Infinity;
    page.forEach((p, i) => {
      if (used.has(i)) return;
      const sim = similarity(d.text, p.text);
      if (sim < 0.6) return;
      const dist = Math.hypot(p.box.x - d.box.x, p.box.y - d.box.y);
      // Text similarity dominates; distance breaks ties between repeated labels ("Add", "Add", …).
      const score = sim * 1000 - dist;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });

    // Rewritten copy ("Clases en grupo" → "Clases grupales") shares too few letters to match by text, but it still
    // sits where the layer is: take an unused element whose box overlaps most of the layer's.
    if (best < 0) {
      let bestOverlap = 0.5;
      page.forEach((p, i) => {
        if (used.has(i)) return;
        const o = overlapRatio(d.box, p.box);
        if (o > bestOverlap) {
          bestOverlap = o;
          best = i;
        }
      });
    }

    const base = { layer: d.name, designBox: d.box };
    if (best < 0) {
      issues.push({ ...base, kind: "missing", expected: d.text, actual: "", message: `"${short(d.text)}" is in the design but not on the page` });
      continue;
    }
    used.add(best);
    matched++;
    const p = page[best];
    const at = { ...base, pageBox: p.box, selector: p.selector };
    const add = (kind: IssueKind, expected: string, actual: string, message: string) =>
      issues.push({ ...at, kind, expected, actual, message });

    if (normalizeText(d.text) !== normalizeText(p.text)) {
      add("text", d.text, p.text, `Text differs: "${short(d.text)}" → "${short(p.text)}"`);
    }
    const fam = primaryFamily(p.fontFamily);
    if (d.fontFamily && fam.toLowerCase() !== d.fontFamily.toLowerCase()) {
      add("font-family", d.fontFamily, fam, `Font is ${fam}, design uses ${d.fontFamily}`);
    }
    if (Math.abs(d.fontSize - p.fontSize) > tol.fontSize) {
      add("font-size", `${fmt(d.fontSize)}px`, `${fmt(p.fontSize)}px`, `Font size ${fmt(p.fontSize)}px, design ${fmt(d.fontSize)}px`);
    }
    if (d.fontWeight !== p.fontWeight) {
      add("font-weight", String(d.fontWeight), String(p.fontWeight), `Weight ${p.fontWeight}, design ${d.fontWeight}`);
    }
    if (d.lineHeight !== null && p.lineHeight !== null && Math.abs(d.lineHeight - p.lineHeight) > tol.lineHeight) {
      add("line-height", `${fmt(d.lineHeight)}px`, `${fmt(p.lineHeight)}px`, `Line height ${fmt(p.lineHeight)}px, design ${fmt(d.lineHeight)}px`);
    }
    if (Math.abs(d.letterSpacing - p.letterSpacing) > tol.letterSpacing) {
      add("letter-spacing", `${fmt(d.letterSpacing)}px`, `${fmt(p.letterSpacing)}px`, `Letter spacing ${fmt(p.letterSpacing)}px, design ${fmt(d.letterSpacing)}px`);
    }
    if (colorDistance(d.color, p.color) > tol.color) {
      add("color", d.color, p.color, `Colour ${p.color}, design ${d.color}`);
    }
    const dx = anchorX(p.box, d.align) - anchorX(d.box, d.align);
    const dy = p.box.y - d.box.y;
    if (Math.abs(dx) > tol.position || Math.abs(dy) > tol.position) {
      const offset = {
        dx: Math.abs(dx) > tol.position ? Math.round(dx * 10) / 10 : 0,
        dy: Math.abs(dy) > tol.position ? Math.round(dy * 10) / 10 : 0,
      };
      const parts = [
        offset.dx ? `${fmt(Math.abs(offset.dx))}px ${offset.dx > 0 ? "right" : "left"}` : "",
        offset.dy ? `${fmt(Math.abs(offset.dy))}px ${offset.dy > 0 ? "down" : "up"}` : "",
      ].filter(Boolean);
      issues.push({
        ...at,
        kind: "position",
        expected: `${fmt(d.box.x)}, ${fmt(d.box.y)}`,
        actual: `${fmt(p.box.x)}, ${fmt(p.box.y)}`,
        offset,
        message: `Moved ${parts.join(" and ")} from where the design puts it`,
      });
    }
  }

  return { issues, matched, total: design.length };
}

/** Intersection over the smaller box, so a short label inside a wider element still counts. */
export function overlapRatio(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height, b.width * b.height);
}

function short(s: string, n = 48) {
  const t = normalizeText(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
