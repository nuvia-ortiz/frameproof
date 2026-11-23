import { chromium } from "playwright";
import type { Box } from "./spec.js";

export interface PageText {
  text: string;
  selector: string;
  box: Box;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | null;
  letterSpacing: number;
  color: string;
  align: "left" | "center" | "right";
}

export interface Capture {
  png: Buffer;
  width: number;
  height: number;
  texts: PageText[];
}

export interface CaptureOptions {
  width: number;
  height: number;
  waitFor?: string;
  hide?: string[];
  /** Extra milliseconds after load, for sites that animate in. */
  delay?: number;
  headers?: Record<string, string>;
}

// Runs inside the page. Every element that directly holds text becomes one entry, measured on its content box
// (padding and border removed), which is what a Figma text layer's box corresponds to.
function collectTexts(): PageText[] {
  const out: PageText[] = [];
  const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : NaN);
  const rgbHex = (v: string) => {
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (!m) return "#000000";
    const [r, g, b] = m[1].split(/[ ,/]+/).map(Number);
    return "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
  };
  const selectorOf = (el: Element) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 4) {
      let part = cur.tagName.toLowerCase();
      const cls = [...cur.classList].slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
      part += cls;
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      if (cur.id) break;
      cur = parent;
    }
    return parts.join(" > ");
  };

  for (const el of document.body.querySelectorAll("*")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"].includes(el.tagName)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    const text = (el as HTMLElement).innerText?.trim();
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const left = r.left + px(cs.paddingLeft) + px(cs.borderLeftWidth);
    const top = r.top + px(cs.paddingTop) + px(cs.borderTopWidth);
    const right = r.right - px(cs.paddingRight) - px(cs.borderRightWidth);
    const bottom = r.bottom - px(cs.paddingBottom) - px(cs.borderBottomWidth);
    const ta = cs.textAlign;
    out.push({
      text,
      selector: selectorOf(el),
      box: { x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top },
      fontFamily: cs.fontFamily,
      fontSize: px(cs.fontSize),
      fontWeight: Number(cs.fontWeight) || 400,
      lineHeight: Number.isNaN(px(cs.lineHeight)) ? null : px(cs.lineHeight),
      letterSpacing: Number.isNaN(px(cs.letterSpacing)) ? 0 : px(cs.letterSpacing),
      color: rgbHex(cs.color),
      align: ta === "center" ? "center" : ta === "right" || ta === "end" ? "right" : "left",
    });
  }
  return out;
}

export async function capturePage(url: string, opts: CaptureOptions): Promise<Capture> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      extraHTTPHeaders: opts.headers,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 30_000 });
    // Animations and carets would show up as differences that have nothing to do with the build.
    await page.addStyleTag({
      content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
    });
    if (opts.hide?.length) {
      await page.addStyleTag({ content: `${opts.hide.join(",")}{visibility:hidden!important}` });
    }
    await page.evaluate(() => document.fonts.ready);
    if (opts.delay) await page.waitForTimeout(opts.delay);

    const texts = await page.evaluate(collectTexts);
    const png = await page.screenshot({ fullPage: true, animations: "disabled" });
    const size = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    return { png, width: size.width, height: size.height, texts };
  } finally {
    await browser.close();
  }
}
