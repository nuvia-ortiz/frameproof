import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { capturePage } from "./capture.js";
import { compareTexts, DEFAULT_TOLERANCES, type Issue, type Tolerances } from "./compare.js";
import { fetchFigmaFrame } from "./figma.js";
import { comparePixels, diffMask, findRegions, type PixelResult } from "./pixels.js";
import { parseFigmaUrl, specFromFigma, type Box, type DesignSpec, type FigmaNodesResponse } from "./spec.js";

export interface RunOptions {
  url: string;
  /** A Figma frame link, or a PNG exported from the design. */
  design: string;
  /** Saved GET /v1/files/:key/nodes response, for text and style checks without a token. */
  figmaJson?: string;
  figmaToken?: string;
  /** Browser window height; matters for pages sized with vh. Default: the frame height, capped at 1200. */
  viewportHeight?: number;
  waitFor?: string;
  hide?: string[];
  delay?: number;
  headers?: Record<string, string>;
  threshold?: number;
  tolerances?: Partial<Tolerances>;
}

export interface VisualDiff {
  box: Box;
  /** Share of the region's pixels that changed */
  changed: number;
  /** Set when the area changed from one flat colour to another (a background, a border). */
  colors?: { design: string; page: string };
}

const hexAt = (data: Buffer, i: number) =>
  "#" + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]].map((n) => n.toString(16).padStart(2, "0")).join("");

function top(counts: Map<string, number>): [string, number] {
  let best: [string, number] = ["", 0];
  for (const e of counts) if (e[1] > best[1]) best = e;
  return best;
}

export interface Result {
  url: string;
  /** What the report shows for the page: the URL, or a local file's path relative to where it ran. */
  pageLabel: string;
  designName: string;
  createdAt: string;
  width: number;
  height: number;
  pixels: Omit<PixelResult, "design" | "page" | "diff">;
  texts: { matched: number; total: number } | null;
  issues: Issue[];
  /** Pixel regions that no text issue explains: images, shapes, spacing, backgrounds. */
  visual: VisualDiff[];
  images: { design: Buffer; page: Buffer; diff: Buffer };
}

/** Lets a local HTML file be passed as the page: `frameproof dist/index.html …`. */
export function toUrl(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  if (existsSync(input)) return pathToFileURL(path.resolve(input)).href;
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(input)) return "http://" + input;
  return input;
}

export async function run(opts: RunOptions): Promise<Result> {
  opts = { ...opts, url: toUrl(opts.url) };
  let spec: DesignSpec | null = null;
  let designPng: Buffer;

  const figma = parseFigmaUrl(opts.design);
  if (figma) {
    if (!figma.nodeId) throw new Error("The Figma link has no node-id. Select the frame in Figma and copy its link (Copy link to selection).");
    const token = opts.figmaToken ?? process.env.FIGMA_TOKEN;
    if (!token) throw new Error("A Figma link needs a personal access token in FIGMA_TOKEN (Figma → Settings → Security).");
    const res = await fetchFigmaFrame(figma.fileKey, figma.nodeId, token);
    spec = specFromFigma(res.nodes, figma.nodeId);
    designPng = res.png;
  } else {
    designPng = await readFile(opts.design);
    if (opts.figmaJson) {
      spec = specFromFigma(JSON.parse(await readFile(opts.figmaJson, "utf8")) as FigmaNodesResponse);
    }
  }

  const img = PNG.sync.read(designPng);
  const width = spec?.width ?? img.width;
  const height = spec?.height ?? img.height;
  // A 2x export is scaled down by telling the reader up front rather than guessing.
  if (spec && img.width !== spec.width) {
    throw new Error(`The design image is ${img.width}px wide but the frame is ${spec.width}px. Export it at 1x.`);
  }

  const page = await capturePage(opts.url, {
    width,
    height: opts.viewportHeight ?? Math.min(height, 1200),
    waitFor: opts.waitFor,
    hide: opts.hide,
    delay: opts.delay,
    headers: opts.headers,
  });

  const pixels = comparePixels(designPng, page.png, opts.threshold);
  const tol = { ...DEFAULT_TOLERANCES, ...opts.tolerances };
  const textResult = spec ? compareTexts(spec.texts, page.texts, tol) : null;
  const issues = textResult?.issues ?? [];

  // Pixels already explained by a text issue are blanked out, so what is left is everything else that changed:
  // a button's background, an image, a border, a gap.
  const mask = diffMask(pixels.diff);
  const blank = (b: Box, pad = 4) => {
    for (let y = Math.max(0, Math.floor(b.y - pad)); y < Math.min(pixels.height, Math.ceil(b.y + b.height + pad)); y++)
      for (let x = Math.max(0, Math.floor(b.x - pad)); x < Math.min(pixels.width, Math.ceil(b.x + b.width + pad)); x++)
        mask[y * pixels.width + x] = 0;
  };
  for (const i of issues) {
    blank(i.designBox);
    if (i.pageBox) blank(i.pageBox);
  }
  const dImg = PNG.sync.read(pixels.design);
  const pImg = PNG.sync.read(pixels.page);
  const visual: VisualDiff[] = findRegions(mask, pixels.width, pixels.height)
    // Tiny specks are rendering noise (subpixel text, image decoding), not something a developer can act on.
    .filter((box) => box.width * box.height >= 256)
    .map((box) => {
      let changed = 0;
      const dc = new Map<string, number>();
      const pc = new Map<string, number>();
      for (let y = box.y; y < box.y + box.height; y++)
        for (let x = box.x; x < box.x + box.width; x++) {
          const i = y * pixels.width + x;
          if (!mask[i]) continue;
          changed++;
          const dh = hexAt(dImg.data, i);
          const ph = hexAt(pImg.data, i);
          dc.set(dh, (dc.get(dh) ?? 0) + 1);
          pc.set(ph, (pc.get(ph) ?? 0) + 1);
        }
      const share = changed / (box.width * box.height);
      const v: VisualDiff = { box, changed: Math.round(share * 100) / 100 };
      // When most changed pixels go from one flat colour to another, that pair is the fix: report it.
      const [dTop, dN] = top(dc);
      const [pTop, pN] = top(pc);
      if (dN / changed > 0.6 && pN / changed > 0.6) v.colors = { design: dTop, page: pTop };
      return v;
    })
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  const { design, page: pageImg, diff, ...pixelInfo } = pixels;
  return {
    url: opts.url,
    pageLabel: opts.url.startsWith("file:") ? path.relative(process.cwd(), fileURLToPath(opts.url)).replaceAll("\\", "/") : opts.url,
    designName: spec?.name ?? opts.design.split(/[\\/]/).pop()!,
    createdAt: new Date().toISOString(),
    width,
    height,
    pixels: pixelInfo,
    texts: textResult ? { matched: textResult.matched, total: textResult.total } : null,
    issues,
    visual,
    images: { design, page: pageImg, diff },
  };
}
