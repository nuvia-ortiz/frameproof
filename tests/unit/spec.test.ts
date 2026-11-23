import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFigmaFrame } from "../../src/figma.js";
import { figmaColorToHex, parseFigmaUrl, specFromFigma, type FigmaNodesResponse } from "../../src/spec.js";

const frame: FigmaNodesResponse = {
  name: "Site",
  nodes: {
    "12:34": {
      document: {
        id: "12:34",
        name: "Home",
        type: "FRAME",
        absoluteBoundingBox: { x: 500, y: -200, width: 1280, height: 900 },
        children: [
          {
            id: "1",
            name: "Title",
            type: "TEXT",
            characters: "Hello there",
            absoluteBoundingBox: { x: 580, y: -100, width: 300, height: 56 },
            fills: [{ type: "SOLID", color: { r: 0.184, g: 0.42, b: 0.31, a: 1 } }],
            style: { fontFamily: "Fraunces", fontWeight: 600, fontSize: 48, lineHeightPx: 56, letterSpacing: -0.5, textAlignHorizontal: "CENTER" },
          },
          { id: "2", name: "Hidden", type: "TEXT", visible: false, characters: "nope", absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 } },
          {
            id: "3",
            name: "Group",
            type: "GROUP",
            children: [
              {
                id: "4",
                name: "Label",
                type: "TEXT",
                characters: "book now",
                absoluteBoundingBox: { x: 600, y: 0, width: 80, height: 20 },
                style: { fontFamily: "Inter", fontSize: 14, textCase: "UPPER", lineHeightUnit: "INTRINSIC_%" },
              },
            ],
          },
        ],
      },
    },
  },
};

describe("specFromFigma", () => {
  const spec = specFromFigma(frame);

  it("takes the frame size and makes text boxes relative to it", () => {
    expect(spec).toMatchObject({ name: "Home", width: 1280, height: 900 });
    expect(spec.texts[0].box).toEqual({ x: 80, y: 100, width: 300, height: 56 });
  });

  it("reads type style, colour and alignment", () => {
    expect(spec.texts[0]).toMatchObject({
      fontFamily: "Fraunces",
      fontWeight: 600,
      fontSize: 48,
      lineHeight: 56,
      letterSpacing: -0.5,
      color: "#2f6b4f",
      align: "center",
    });
  });

  it("skips hidden layers, walks into groups and applies text case", () => {
    expect(spec.texts.map((t) => t.text)).toEqual(["Hello there", "BOOK NOW"]);
    expect(spec.texts[1]).toMatchObject({ lineHeight: null, fontWeight: 400, align: "left" });
  });

  it("explains a wrong node id", () => {
    expect(() => specFromFigma(frame, "9:9")).toThrow(/9:9/);
  });
});

describe("parseFigmaUrl", () => {
  it("reads file key and node id from design and file links", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/My-Site?node-id=12-34&t=x")).toEqual({ fileKey: "AbC123", nodeId: "12:34" });
    expect(parseFigmaUrl("https://figma.com/file/XyZ/Old?node-id=1%3A2")).toEqual({ fileKey: "XyZ", nodeId: "1:2" });
    expect(parseFigmaUrl("https://www.figma.com/design/AbC123/My-Site")).toEqual({ fileKey: "AbC123", nodeId: undefined });
  });
  it("rejects other sites and local files", () => {
    expect(parseFigmaUrl("https://example.com/design/abc")).toBeNull();
    expect(parseFigmaUrl("https://notfigma.com/design/abc")).toBeNull();
    expect(parseFigmaUrl("design.png")).toBeNull();
  });
});

it("converts Figma 0–1 colours to hex", () => {
  expect(figmaColorToHex({ r: 1, g: 1, b: 1 })).toBe("#ffffff");
  expect(figmaColorToHex({ r: 0, g: 0.5, b: 1 })).toBe("#0080ff");
});

describe("fetchFigmaFrame", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the token and downloads the rendered frame", async () => {
    const calls: { url: string; token?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, token: (init?.headers as Record<string, string> | undefined)?.["X-Figma-Token"] });
      if (url.includes("/nodes")) return new Response(JSON.stringify(frame));
      if (url.includes("/images/")) return new Response(JSON.stringify({ err: null, images: { "12:34": "https://cdn.test/frame.png" } }));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const res = await fetchFigmaFrame("KEY", "12:34", "secret");
    expect(res.png).toEqual(Buffer.from([1, 2, 3]));
    expect(calls[0]).toEqual({ url: "https://api.figma.com/v1/files/KEY/nodes?ids=12%3A34", token: "secret" });
    expect(calls[1].url).toBe("https://api.figma.com/v1/images/KEY?ids=12%3A34&format=png&scale=1");
    // The image CDN link is signed; the token must not travel to it.
    expect(calls[2]).toEqual({ url: "https://cdn.test/frame.png", token: undefined });
  });

  it("turns a 403 into a hint about the token", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));
    await expect(fetchFigmaFrame("KEY", "1:2", "bad")).rejects.toThrow(/FIGMA_TOKEN/);
  });
});
