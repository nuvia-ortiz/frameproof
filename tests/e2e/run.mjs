// End-to-end: the real CLI, a real browser, the example landing page.
// The design is rendered on this machine first so fonts and anti-aliasing match whatever OS runs the test.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { referenceFromPage } from "../../dist/reference.js";
import { toUrl } from "../../dist/run.js";
import { writeFile } from "node:fs/promises";

const sh = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), "frameproof-"));
const designPng = path.join(dir, "design.png");
const designJson = path.join(dir, "design.figma.json");
const { nodes, png } = await referenceFromPage(toUrl("examples/landing/design.html"), 1280, "Home");
await writeFile(designPng, png);
await writeFile(designJson, JSON.stringify(nodes));

async function cli(page, out, ...extra) {
  const args = ["dist/cli.js", page, "-d", designPng, "--figma-json", designJson, "-o", out, ...extra];
  try {
    const { stdout } = await sh(process.execPath, args);
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}
const readReport = async (out) => JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));

test("the design compared with itself is clean", async () => {
  const out = path.join(dir, "self");
  const res = await cli("examples/landing/design.html", out, "--fail-on", "any");
  assert.equal(res.code, 0, res.stdout + res.stderr);
  const r = await readReport(out);
  assert.equal(r.pixels.matchPercent, 100);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.visual, []);
  assert.equal(r.texts.matched, r.texts.total);
});

test("every slip planted in build.html is reported", async () => {
  const out = path.join(dir, "build");
  const res = await cli("examples/landing/build.html", out, "--fail-on", "text");
  assert.equal(res.code, 1, "issues must fail the run with --fail-on text");
  const r = await readReport(out);
  const has = (layer, kind) => r.issues.some((i) => i.layer.startsWith(layer) && i.kind === kind);

  for (const nav of ["Servicios", "Precios", "Contacto"]) assert.ok(has(nav, "font-weight"), `${nav} weight`);
  assert.ok(has("Tu bici a punto", "font-size"), "h1 size");
  assert.ok(has("Taller de barrio", "color"), "lead colour");
  assert.ok(has("Clases en grupo", "text"), "changed copy");
  assert.ok(has("Recogida a domicilio", "position"), "moved card title");
  assert.ok(has("Aviso legal", "missing"), "missing footer link");

  const size = r.issues.find((i) => i.kind === "font-size");
  assert.deepEqual([size.expected, size.actual], ["48px", "44px"]);
  const text = r.issues.find((i) => i.kind === "text");
  assert.equal(text.actual, "Clases grupales");
  const moved = r.issues.find((i) => i.layer === "Recogida a domicilio" && i.kind === "position");
  assert.deepEqual(moved.offset, { dx: 0, dy: 12 });

  // The button's new colour isn't a text property: it has to come out of the pixel comparison, with the colours.
  const button = r.visual.find((v) => v.colors?.design === "#2f6b4f");
  assert.ok(button, JSON.stringify(r.visual));
  assert.equal(button.colors.page, "#3d8a63");

  // Nothing unplanted: untouched texts produce no issues.
  for (const clean of ["Rueda Libre", "Puesta a punto", "Pedir cita"]) {
    assert.ok(!r.issues.some((i) => i.layer.startsWith(clean)), `${clean} should be clean`);
  }
});

test("the HTML report works in a browser", async () => {
  const out = path.join(dir, "build-es");
  await cli("examples/landing/build.html", out, "--lang", "es");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(out, "index.html")).href);
    await page.getByText("Revisión de diseño").first().waitFor();
    assert.ok(await page.getByText("Tamaño 44px; en el diseño 48px").isVisible());

    // Clicking an issue lights up its box in the visible view.
    await page.locator(".issue", { hasText: "Tamaño" }).click();
    const lit = page.locator(".pane.on .mark.hit");
    assert.equal(await lit.count(), 2, "design and page boxes");

    // Swipe view shows its slider; the overlay slider stays hidden.
    await page.getByRole("tab", { name: "Deslizar" }).click();
    assert.ok(await page.locator("#swipe").isVisible());
    assert.ok(!(await page.locator("#onion").isVisible()));
    await page.locator("#swipe").fill("20");
    assert.equal(await page.locator("#swipeTop").evaluate((el) => el.style.width), "20%");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("bad input fails with a readable message", async () => {
  const res = await sh(process.execPath, ["dist/cli.js", "https://example.com", "-d", "https://www.figma.com/design/KEY/Site"]).catch((e) => e);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /node-id/);
});
