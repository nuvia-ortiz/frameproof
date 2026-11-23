import { capturePage } from "./capture.js";
import { primaryFamily } from "./compare.js";
import { hexToRgb } from "./compare.js";
import type { FigmaNode, FigmaNodesResponse } from "./spec.js";

/**
 * Renders a reference page (a prototype, or an approved version of the site) and describes it in the same shape as
 * Figma's GET /v1/files/:key/nodes response, so it can stand in for a Figma frame. The frame is placed away from the
 * origin, as frames on a Figma canvas usually are, so the offset handling is exercised too.
 */
export async function referenceFromPage(url: string, width: number, name = "Reference") {
  const cap = await capturePage(url, { width, height: 900 });
  const origin = { x: 1200, y: -340 };
  const children: FigmaNode[] = cap.texts.map((t, i) => {
    const [r, g, b] = hexToRgb(t.color);
    return {
      id: `2:${i + 1}`,
      name: t.text.length > 24 ? t.text.slice(0, 24) + "…" : t.text,
      type: "TEXT",
      characters: t.text,
      absoluteBoundingBox: { x: origin.x + t.box.x, y: origin.y + t.box.y, width: t.box.width, height: t.box.height },
      fills: [{ type: "SOLID", color: { r: r / 255, g: g / 255, b: b / 255, a: 1 } }],
      style: {
        fontFamily: primaryFamily(t.fontFamily),
        fontWeight: t.fontWeight,
        fontSize: t.fontSize,
        letterSpacing: t.letterSpacing,
        lineHeightPx: t.lineHeight ?? undefined,
        lineHeightUnit: t.lineHeight === null ? "INTRINSIC_%" : "PIXELS",
        textAlignHorizontal: t.align.toUpperCase(),
      },
    };
  });
  const nodes: FigmaNodesResponse = {
    name,
    nodes: {
      "1:2": {
        document: {
          id: "1:2",
          name,
          type: "FRAME",
          absoluteBoundingBox: { x: origin.x, y: origin.y, width: cap.width, height: cap.height },
          children,
        },
      },
    },
  };
  return { nodes, png: cap.png };
}
