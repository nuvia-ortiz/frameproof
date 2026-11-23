import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { Box } from "./spec.js";

export interface PixelResult {
  width: number;
  height: number;
  diffPixels: number;
  /** 0–100, share of compared pixels that match */
  matchPercent: number;
  /** Design and page cropped/padded to the same size, plus the diff image. */
  design: Buffer;
  page: Buffer;
  diff: Buffer;
  regions: Box[];
  /** Full size of the captured page, which can differ from the frame. */
  pageSize: { width: number; height: number };
}

/** Puts `src` on a canvas of the given size (white background), cropping what doesn't fit. */
function fit(src: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(src, out, 0, 0, Math.min(src.width, width), Math.min(src.height, height), 0, 0);
  return out;
}

/**
 * Groups changed pixels into rectangles: the image is split into cells, cells with enough changed pixels are
 * "hot", and touching hot cells (with a one-cell gap allowed) become one region.
 */
export function findRegions(mask: Uint8Array, width: number, height: number, cell = 8, minPixels = 3): Box[] {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const counts = new Uint16Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x++) if (mask[y * width + x]) counts[row + Math.floor(x / cell)]++;
  }
  const hot = (i: number) => counts[i] >= minPixels;
  const seen = new Uint8Array(cols * rows);
  const boxes: Box[] = [];
  for (let start = 0; start < counts.length; start++) {
    if (!hot(start) || seen[start]) continue;
    let minC = cols, minR = rows, maxC = 0, maxR = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const c = i % cols;
      const r = (i - c) / cols;
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const j = nr * cols + nc;
          if (!seen[j] && hot(j)) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    boxes.push({
      x: minC * cell,
      y: minR * cell,
      width: Math.min(width, (maxC + 1) * cell) - minC * cell,
      height: Math.min(height, (maxR + 1) * cell) - minR * cell,
    });
  }
  return boxes.sort((a, b) => b.width * b.height - a.width * a.height);
}

const DIFF: [number, number, number] = [230, 40, 90];

/** 1 where pixelmatch painted a real difference (anti-aliasing is painted in another colour and ignored). */
export function diffMask(diffPng: Buffer): Uint8Array {
  const img = PNG.sync.read(diffPng);
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (img.data[o] === DIFF[0] && img.data[o + 1] === DIFF[1] && img.data[o + 2] === DIFF[2]) mask[i] = 1;
  }
  return mask;
}

export function comparePixels(designPng: Buffer, pagePng: Buffer, threshold = 0.05): PixelResult {
  const d = PNG.sync.read(designPng);
  const p = PNG.sync.read(pagePng);
  // The design defines the canvas: a taller page is cropped to the frame, a shorter one leaves white that shows up.
  const width = d.width;
  const height = d.height;
  const a = fit(d, width, height);
  const b = fit(p, width, height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold,
    includeAA: false,
    alpha: 0.15,
    diffColor: DIFF,
  });

  const diffPng = PNG.sync.write(diff);
  const mask = diffMask(diffPng);

  return {
    width,
    height,
    diffPixels,
    matchPercent: Math.round((1 - diffPixels / (width * height)) * 10000) / 100,
    design: PNG.sync.write(a),
    page: PNG.sync.write(b),
    diff: diffPng,
    regions: findRegions(mask, width, height),
    pageSize: { width: p.width, height: p.height },
  };
}
