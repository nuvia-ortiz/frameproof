// The design side, reduced to what can be checked against a browser: the frame size and every visible text layer
// with its position (relative to the frame) and type style.

export type Align = "left" | "center" | "right";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** null = the design leaves it on "auto". */
  lineHeight: number | null;
  letterSpacing: number;
  /** #rrggbb */
  color: string;
}

export interface DesignText extends TextStyle {
  id: string;
  name: string;
  text: string;
  box: Box;
  align: Align;
}

export interface DesignSpec {
  name: string;
  width: number;
  height: number;
  texts: DesignText[];
}

// ---- Figma REST shapes (only the fields used) -------------------------------------------------------------

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}
interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
}
export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  characters?: string;
  absoluteBoundingBox?: Box | null;
  fills?: FigmaPaint[];
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    letterSpacing?: number;
    lineHeightPx?: number;
    lineHeightUnit?: string;
    textAlignHorizontal?: string;
    textCase?: string;
  };
  children?: FigmaNode[];
}
export interface FigmaNodesResponse {
  name?: string;
  nodes: Record<string, { document: FigmaNode } | null>;
}

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");

export function figmaColorToHex(c: FigmaColor): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

function applyCase(text: string, textCase?: string): string {
  if (textCase === "UPPER") return text.toUpperCase();
  if (textCase === "LOWER") return text.toLowerCase();
  if (textCase === "TITLE") return text.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
  return text;
}

/** Turns a Figma frame (as returned by GET /v1/files/:key/nodes) into a spec. */
export function specFromFigma(res: FigmaNodesResponse, nodeId?: string): DesignSpec {
  const entries = Object.entries(res.nodes).filter(([, v]) => v);
  const entry = nodeId ? entries.find(([id]) => id === nodeId) : entries[0];
  if (!entry || !entry[1]) throw new Error(nodeId ? `Node ${nodeId} is not in the Figma response` : "The Figma response has no nodes");
  const frame = entry[1].document;
  const origin = frame.absoluteBoundingBox;
  if (!origin) throw new Error(`"${frame.name}" has no bounding box; pick a frame, not a page`);

  const texts: DesignText[] = [];
  const walk = (node: FigmaNode) => {
    if (node.visible === false) return;
    if (node.type === "TEXT" && node.characters?.trim() && node.absoluteBoundingBox) {
      const s = node.style ?? {};
      const fill = node.fills?.find((f) => f.type === "SOLID" && f.visible !== false && f.color);
      const b = node.absoluteBoundingBox;
      texts.push({
        id: node.id,
        name: node.name,
        text: applyCase(node.characters, s.textCase),
        box: { x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height },
        align: s.textAlignHorizontal === "CENTER" ? "center" : s.textAlignHorizontal === "RIGHT" ? "right" : "left",
        fontFamily: s.fontFamily ?? "",
        fontSize: s.fontSize ?? 0,
        fontWeight: s.fontWeight ?? 400,
        lineHeight: s.lineHeightUnit === "INTRINSIC_%" ? null : (s.lineHeightPx ?? null),
        letterSpacing: s.letterSpacing ?? 0,
        color: fill?.color ? figmaColorToHex(fill.color) : "#000000",
      });
    }
    node.children?.forEach(walk);
  };
  frame.children?.forEach(walk);

  return { name: frame.name, width: Math.round(origin.width), height: Math.round(origin.height), texts };
}

/** Accepts https://www.figma.com/{file|design|proto}/KEY/Name?node-id=12-34 */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const raw = url.searchParams.get("node-id");
  return { fileKey: m[1], nodeId: raw ? raw.replace("-", ":") : undefined };
}
