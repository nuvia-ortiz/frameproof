// Renders examples/landing/design.html into the two files a Figma export would give: a 1x PNG of the frame and the
// nodes JSON. Usage: node scripts/make-fixture.mjs [design.html] [outPrefix]
import { writeFile } from "node:fs/promises";
import { referenceFromPage } from "../dist/reference.js";
import { toUrl } from "../dist/run.js";

const src = process.argv[2] ?? "examples/landing/design.html";
const prefix = process.argv[3] ?? src.replace(/\.html$/, "");
const { nodes, png } = await referenceFromPage(toUrl(src), 1280, "Home · Desktop");
await writeFile(`${prefix}.png`, png);
await writeFile(`${prefix}.figma.json`, JSON.stringify(nodes, null, 2) + "\n");
console.log(`${prefix}.png + ${prefix}.figma.json (${nodes.nodes["1:2"].document.children.length} text layers)`);
