#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderReport, toJson, type Lang } from "./report.js";
import { run } from "./run.js";

const HELP = `frameproof <url> --design <figma-link | design.png> [options]

Compares a built page with its design: pixels, and (with a Figma frame) every text's
content, font, size, weight, line height, spacing, colour and position.

  --design, -d        Figma frame link (needs FIGMA_TOKEN) or a PNG exported at 1x
  --figma-json        saved Figma nodes response, to check texts when --design is a PNG
  --out, -o           report folder (default: frameproof-report)
  --lang              report language: en | es (default: en)
  --height            browser window height in px, for pages sized with vh
                      (default: frame height, up to 1200)
  --wait-for          CSS selector to wait for before capturing
  --hide              CSS selector to hide (cookie banners, live chat); repeatable
  --delay             extra milliseconds to wait after load
  --header            extra request header "Name: value"; repeatable (staging auth)
  --threshold         pixel colour sensitivity 0–1 (default 0.05)
  --position          px a text may drift before it counts as moved (default 4)
  --fail-on           exit 1 when issues are found: text | any | never (default: never)
  --help, -h

Examples:
  FIGMA_TOKEN=… frameproof https://staging.example.com "https://www.figma.com/design/KEY/Site?node-id=12-34"
  frameproof http://localhost:3000 -d home.png --figma-json home.json --fail-on text
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      design: { type: "string", short: "d" },
      "figma-json": { type: "string" },
      out: { type: "string", short: "o", default: "frameproof-report" },
      lang: { type: "string", default: "en" },
      height: { type: "string" },
      "wait-for": { type: "string" },
      hide: { type: "string", multiple: true },
      delay: { type: "string" },
      header: { type: "string", multiple: true },
      threshold: { type: "string" },
      position: { type: "string" },
      "fail-on": { type: "string", default: "never" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || !positionals[0]) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 2);
  }
  // The design may be given as the second positional for convenience.
  const design = values.design ?? positionals[1];
  if (!design) {
    console.error("Missing --design (a Figma frame link or a PNG).\n");
    process.stdout.write(HELP);
    process.exit(2);
  }
  const lang = (values.lang === "es" ? "es" : "en") as Lang;
  const failOn = values["fail-on"];
  if (!["text", "any", "never"].includes(failOn!)) throw new Error("--fail-on must be text, any or never");

  const headers: Record<string, string> = {};
  for (const h of values.header ?? []) {
    const i = h.indexOf(":");
    if (i < 1) throw new Error(`Bad --header "${h}", expected "Name: value"`);
    headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
  }
  const num = (v: string | undefined, name: string) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a positive number`);
    return n;
  };

  const result = await run({
    url: positionals[0],
    design,
    figmaJson: values["figma-json"],
    viewportHeight: num(values.height, "height"),
    waitFor: values["wait-for"],
    hide: values.hide,
    delay: num(values.delay, "delay"),
    headers,
    threshold: num(values.threshold, "threshold"),
    tolerances: values.position ? { position: num(values.position, "position")! } : undefined,
  });

  const out = path.resolve(values.out!);
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(path.join(out, "index.html"), renderReport(result, lang)),
    writeFile(path.join(out, "report.json"), JSON.stringify(toJson(result), null, 2)),
    writeFile(path.join(out, "design.png"), result.images.design),
    writeFile(path.join(out, "page.png"), result.images.page),
    writeFile(path.join(out, "diff.png"), result.images.diff),
  ]);

  const lines = [
    `Pixel match ${result.pixels.matchPercent.toFixed(2)}%`,
    result.texts ? `${result.texts.matched}/${result.texts.total} texts found, ${result.issues.length} text/style issues` : "texts not checked (no Figma data)",
    `${result.visual.length} other visual differences`,
  ];
  for (const i of result.issues.slice(0, 20)) lines.push(`  · ${i.layer}: ${i.message}`);
  if (result.issues.length > 20) lines.push(`  … and ${result.issues.length - 20} more`);
  lines.push(`Report: ${path.join(out, "index.html")}`);
  console.log(lines.join("\n"));

  const fail = (failOn === "text" && result.issues.length > 0) || (failOn === "any" && (result.issues.length > 0 || result.visual.length > 0));
  process.exit(fail ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(`frameproof: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
