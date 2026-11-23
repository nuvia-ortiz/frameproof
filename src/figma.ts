import type { FigmaNodesResponse } from "./spec.js";

const API = "https://api.figma.com/v1";

async function get(path: string, token: string): Promise<Response> {
  const res = await fetch(API + path, { headers: { "X-Figma-Token": token } });
  if (res.status === 403) throw new Error("Figma refused the token (403). Check FIGMA_TOKEN and that it can read this file.");
  if (res.status === 404) throw new Error("Figma file or node not found (404). Check the link.");
  if (res.status === 429) throw new Error("Figma rate limit reached (429). Wait a minute and try again.");
  if (!res.ok) throw new Error(`Figma API answered ${res.status} for ${path}`);
  return res;
}

/** Fetches the frame's node tree and a 1x PNG render of it. */
export async function fetchFigmaFrame(fileKey: string, nodeId: string, token: string) {
  const ids = encodeURIComponent(nodeId);
  const nodes = (await (await get(`/files/${fileKey}/nodes?ids=${ids}`, token)).json()) as FigmaNodesResponse;
  const images = (await (await get(`/images/${fileKey}?ids=${ids}&format=png&scale=1`, token)).json()) as {
    err?: string | null;
    images: Record<string, string | null>;
  };
  const href = images.images?.[nodeId];
  if (!href) throw new Error(images.err ? `Figma could not render the frame: ${images.err}` : "Figma returned no image for this frame");
  const png = Buffer.from(await (await fetch(href)).arrayBuffer());
  return { nodes, png };
}
