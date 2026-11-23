import type { Issue } from "./compare.js";
import type { Result } from "./run.js";

export type Lang = "en" | "es";

const T = {
  en: {
    title: "Design check",
    against: "against",
    match: "Pixel match",
    texts: "Texts found",
    issues: "Text and style issues",
    visual: "Other visual differences",
    side: "Side by side",
    swipe: "Swipe",
    onion: "Overlay",
    diff: "Differences",
    design: "Design",
    page: "Page",
    opacity: "Page opacity",
    none: "No differences found.",
    noSpec: "Only pixels were compared. Add the Figma link or --figma-json to check texts, fonts and colours.",
    expected: "Design",
    actual: "Page",
    region: "Area",
    changed: "changed",
    kinds: {
      missing: "Missing",
      text: "Text",
      "font-family": "Font",
      "font-size": "Size",
      "font-weight": "Weight",
      "line-height": "Line height",
      "letter-spacing": "Spacing",
      color: "Colour",
      position: "Position",
    },
    visualHint: "Images, shapes, backgrounds or spacing that differ outside the checked texts.",
  },
  es: {
    title: "Revisión de diseño",
    against: "frente a",
    match: "Coincidencia de píxeles",
    texts: "Textos encontrados",
    issues: "Fallos de texto y estilo",
    visual: "Otras diferencias visuales",
    side: "Lado a lado",
    swipe: "Deslizar",
    onion: "Superponer",
    diff: "Diferencias",
    design: "Diseño",
    page: "Web",
    opacity: "Opacidad de la web",
    none: "No hay diferencias.",
    noSpec: "Solo se compararon píxeles. Añade el enlace de Figma o --figma-json para revisar textos, letras y colores.",
    expected: "Diseño",
    actual: "Web",
    region: "Zona",
    changed: "cambiado",
    kinds: {
      missing: "Falta",
      text: "Texto",
      "font-family": "Tipografía",
      "font-size": "Tamaño",
      "font-weight": "Grosor",
      "line-height": "Interlineado",
      "letter-spacing": "Espaciado",
      color: "Color",
      position: "Posición",
    },
    visualHint: "Imágenes, formas, fondos o espacios que cambian fuera de los textos revisados.",
  },
} as const;

/** One sentence per issue, in the report's language. */
export function describe(i: Issue, lang: Lang): string {
  const es = lang === "es";
  const d = i.expected;
  const a = i.actual;
  switch (i.kind) {
    case "missing":
      return es ? `"${d}" está en el diseño pero no en la web` : `"${d}" is in the design but not on the page`;
    case "text":
      return es ? "El texto no coincide" : "The text is different";
    case "font-family":
      return es ? `Tipografía ${a}; el diseño usa ${d}` : `Font is ${a}; the design uses ${d}`;
    case "font-size":
      return es ? `Tamaño ${a}; en el diseño ${d}` : `Font size ${a}; the design has ${d}`;
    case "font-weight":
      return es ? `Grosor ${a}; en el diseño ${d}` : `Weight ${a}; the design has ${d}`;
    case "line-height":
      return es ? `Interlineado ${a}; en el diseño ${d}` : `Line height ${a}; the design has ${d}`;
    case "letter-spacing":
      return es ? `Espaciado entre letras ${a}; en el diseño ${d}` : `Letter spacing ${a}; the design has ${d}`;
    case "color":
      return es ? "Color de texto distinto" : "Different text colour";
    case "position": {
      const { dx, dy } = i.offset ?? { dx: 0, dy: 0 };
      const parts: string[] = [];
      if (dx) parts.push(es ? `${Math.abs(dx)} px a la ${dx > 0 ? "derecha" : "izquierda"}` : `${Math.abs(dx)}px ${dx > 0 ? "right" : "left"}`);
      if (dy) parts.push(es ? `${Math.abs(dy)} px más ${dy > 0 ? "abajo" : "arriba"}` : `${Math.abs(dy)}px ${dy > 0 ? "down" : "up"}`);
      return es ? `Desplazado ${parts.join(" y ")} respecto al diseño` : `Moved ${parts.join(" and ")} from where the design puts it`;
    }
  }
}

export function sizeNote(r: Result, lang: Lang): string | null {
  const es = lang === "es";
  const { width, height } = r.pixels.pageSize;
  if (width > r.width)
    return es
      ? `La web mide ${width} px de ancho y el diseño ${r.width} px: hay scroll horizontal o un ancho fijo.`
      : `The page is ${width}px wide and the frame ${r.width}px: something overflows or has a fixed width.`;
  if (height !== r.height) {
    const n = Math.min(height, r.height);
    return es
      ? `La web mide ${height} px de alto y el diseño ${r.height} px; se compararon los primeros ${n} px.`
      : `The page is ${height}px tall and the frame ${r.height}px; the top ${n}px were compared.`;
  }
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

export function renderReport(r: Result, lang: Lang = "en"): string {
  const t = T[lang];
  const marks = [
    ...r.issues.map((i, n) => ({ id: `i${n}`, box: i.designBox, pageBox: i.pageBox, kind: "m-issue" })),
    ...r.visual.map((v, n) => ({ id: `v${n}`, box: v.box, pageBox: v.box, kind: "m-visual" })),
  ];
  const swatch = (v: string) => (/^#[0-9a-f]{6}$/i.test(v) ? `<i class="sw" style="background:${v}"></i>` : "");

  // Group by layer so one heading with three wrong properties reads as one problem with three facts.
  const groups = new Map<string, { layer: string; selector?: string; items: { n: number; i: Result["issues"][number] }[] }>();
  r.issues.forEach((i, n) => {
    const k = i.layer + "|" + (i.selector ?? "");
    if (!groups.has(k)) groups.set(k, { layer: i.layer, selector: i.selector, items: [] });
    groups.get(k)!.items.push({ n, i });
  });

  const issueHtml = [...groups.values()]
    .map(
      (g) => `<li class="group">
  <div class="layer">${esc(g.layer)}${g.selector ? ` <code>${esc(g.selector)}</code>` : ""}</div>
  <ul>${g.items
    .map(
      ({ n, i }) => `<li><button class="issue" data-mark="i${n}">
    <span class="chip k-${i.kind}">${esc(t.kinds[i.kind])}</span>
    <span class="msg">${esc(describe(i, lang))}</span>
    ${i.kind === "color" || i.kind === "text" ? `<span class="vals"><span>${t.expected}: ${swatch(i.expected)}${esc(i.expected)}</span><span>${t.actual}: ${swatch(i.actual)}${esc(i.actual)}</span></span>` : ""}
  </button></li>`,
    )
    .join("")}</ul></li>`,
    )
    .join("");

  const visualHtml = r.visual
    .map(
      (v, n) => `<li><button class="issue" data-mark="v${n}"><span class="chip k-visual">${t.region} ${n + 1}</span>
  <span class="msg">${v.box.width}×${v.box.height}px · x ${v.box.x}, y ${v.box.y} · ${Math.round(v.changed * 100)}% ${t.changed}</span>
  ${v.colors ? `<span class="vals"><span>${t.expected}: ${swatch(v.colors.design)}${v.colors.design}</span><span>${t.actual}: ${swatch(v.colors.page)}${v.colors.page}</span></span>` : ""}</button></li>`,
    )
    .join("");

  const boxes = (which: "design" | "page") =>
    marks
      .map((m) => {
        const b = which === "page" && m.pageBox ? m.pageBox : m.box;
        return `<div class="mark ${m.kind}" data-id="${m.id}" style="left:${(b.x / r.width) * 100}%;top:${(b.y / r.height) * 100}%;width:${(b.width / r.width) * 100}%;height:${(b.height / r.height) * 100}%"></div>`;
      })
      .join("");

  const scoreClass = r.pixels.matchPercent >= 98 ? "good" : r.pixels.matchPercent >= 90 ? "warn" : "bad";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title)} · ${esc(r.designName)}</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--ink:#16181d;--muted:#5d6470;--line:#e2e5ea;--accent:#3a5bdc;--issue:#e6285a;--visual:#d98a00;--good:#16794a;--warn:#a05a00;--bad:#c01f4b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--panel:#1a1d24;--ink:#e9ebef;--muted:#9aa2ae;--line:#2b303a;--accent:#8aa2ff;--issue:#ff5c86;--visual:#ffb340;--good:#4cc98a;--warn:#ffb340;--bad:#ff6b8f;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--line);background:var(--panel)}
h1{margin:0 0 4px;font-size:20px}
.sub{color:var(--muted);word-break:break-all}
.sub a{color:var(--accent)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;padding:16px 24px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.kpi span{color:var(--muted);font-size:13px}
.good b{color:var(--good)}.warn b{color:var(--warn)}.bad b{color:var(--bad)}
.note{margin:0 24px 12px;padding:10px 14px;border-radius:8px;background:var(--panel);border:1px solid var(--line);color:var(--muted)}
main{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:16px;padding:0 24px 24px;align-items:start}
@media (max-width:1000px){main{grid-template-columns:1fr}}
.viewer{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.tabs{display:flex;gap:4px;padding:8px;border-bottom:1px solid var(--line);flex-wrap:wrap;align-items:center}
.tabs button{border:0;background:none;color:var(--muted);padding:6px 12px;border-radius:6px;font:inherit;cursor:pointer}
.tabs button[aria-selected=true]{background:var(--bg);color:var(--ink);font-weight:600}
.tabs .ctl[hidden]{display:none}
.tabs label{margin-left:auto;color:var(--muted);display:flex;gap:8px;align-items:center}
.stage{padding:12px;overflow:auto;max-height:calc(100vh - 140px)}
.pane{display:none}.pane.on{display:block}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cap{font-size:12px;color:var(--muted);margin-bottom:4px}
.frame{position:relative;line-height:0}
.frame img{width:100%;display:block;border:1px solid var(--line)}
.over{position:absolute;inset:0}
.swipe .top{position:absolute;inset:0;overflow:hidden;width:50%;border-right:2px solid var(--accent)}
.swipe .top img{width:auto;max-width:none;height:100%}
.mark{position:absolute;border:2px solid var(--issue);border-radius:3px;pointer-events:none;transition:box-shadow .15s}
.mark.m-visual{border-color:var(--visual);border-style:dashed}
.mark.hit{box-shadow:0 0 0 4px color-mix(in srgb,var(--issue) 35%,transparent);background:color-mix(in srgb,var(--issue) 12%,transparent)}
.mark.m-visual.hit{box-shadow:0 0 0 4px color-mix(in srgb,var(--visual) 35%,transparent);background:color-mix(in srgb,var(--visual) 12%,transparent)}
aside{display:flex;flex-direction:column;gap:16px}
section.list{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
h2{font-size:15px;margin:0 0 8px}
.hint{color:var(--muted);font-size:13px;margin:-4px 0 8px}
ul{list-style:none;margin:0;padding:0}
.group{border-top:1px solid var(--line);padding:8px 0}.group:first-child{border-top:0}
.layer{font-weight:600;margin-bottom:4px;word-break:break-word}
.layer code{font-weight:400;color:var(--muted);font-size:12px}
.issue{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;width:100%;text-align:left;background:none;border:0;padding:6px;border-radius:6px;color:inherit;font:inherit;cursor:pointer}
.issue:hover,.issue:focus-visible,.issue.on{background:var(--bg)}
.chip{font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,var(--issue) 14%,transparent);color:var(--issue);white-space:nowrap}
.k-visual{background:color-mix(in srgb,var(--visual) 16%,transparent);color:var(--visual)}
.msg{flex:1 1 200px}
.vals{display:flex;gap:12px;flex-wrap:wrap;width:100%;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;border:1px solid var(--line);margin-right:4px;vertical-align:-1px}
.empty{color:var(--muted)}
</style>
</head>
<body>
<header>
  <h1>${esc(t.title)}: ${esc(r.designName)}</h1>
  <div class="sub">${t.against} ${/^https?:/.test(r.url) ? `<a href="${esc(r.url)}">${esc(r.pageLabel)}</a>` : `<code>${esc(r.pageLabel)}</code>`} · ${r.width}×${r.height}px · ${esc(new Date(r.createdAt).toLocaleString(lang === "es" ? "es-ES" : "en-GB"))}</div>
</header>
<div class="kpis">
  <div class="kpi ${scoreClass}"><b>${r.pixels.matchPercent.toFixed(2)}%</b><span>${t.match}</span></div>
  ${r.texts ? `<div class="kpi"><b>${r.texts.matched}/${r.texts.total}</b><span>${t.texts}</span></div>` : ""}
  ${r.texts ? `<div class="kpi ${r.issues.length ? "bad" : "good"}"><b>${r.issues.length}</b><span>${t.issues}</span></div>` : ""}
  <div class="kpi ${r.visual.length ? "warn" : "good"}"><b>${r.visual.length}</b><span>${t.visual}</span></div>
</div>
${sizeNote(r, lang) ? `<p class="note">${esc(sizeNote(r, lang)!)}</p>` : ""}
${r.texts ? "" : `<p class="note">${esc(t.noSpec)}</p>`}
<main>
  <div class="viewer">
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="true" data-pane="side">${t.side}</button>
      <button role="tab" aria-selected="false" data-pane="swipe">${t.swipe}</button>
      <button role="tab" aria-selected="false" data-pane="onion">${t.onion}</button>
      <button role="tab" aria-selected="false" data-pane="diff">${t.diff}</button>
      <label class="ctl" data-for="swipe" hidden><input type="range" id="swipe" min="0" max="100" value="50" aria-label="${t.swipe}"></label>
      <label class="ctl" data-for="onion" hidden>${t.opacity} <input type="range" id="onion" min="0" max="100" value="50"></label>
    </div>
    <div class="stage">
      <div class="pane on" data-pane="side"><div class="pair">
        <div><div class="cap">${t.design}</div><div class="frame"><img src="${dataUri(r.images.design)}" alt="${t.design}"><div class="over">${boxes("design")}</div></div></div>
        <div><div class="cap">${t.page}</div><div class="frame"><img src="${dataUri(r.images.page)}" alt="${t.page}"><div class="over">${boxes("page")}</div></div></div>
      </div></div>
      <div class="pane" data-pane="swipe"><div class="frame swipe"><img src="${dataUri(r.images.page)}" alt="${t.page}"><div class="top" id="swipeTop"><img src="${dataUri(r.images.design)}" alt="${t.design}"></div><div class="over">${boxes("design")}</div></div></div>
      <div class="pane" data-pane="onion"><div class="frame"><img src="${dataUri(r.images.design)}" alt="${t.design}"><img id="onionTop" src="${dataUri(r.images.page)}" alt="${t.page}" style="position:absolute;inset:0;opacity:.5"><div class="over">${boxes("design")}</div></div></div>
      <div class="pane" data-pane="diff"><div class="frame"><img src="${dataUri(r.images.diff)}" alt="${t.diff}"><div class="over">${boxes("design")}</div></div></div>
    </div>
  </div>
  <aside>
    ${r.texts ? `<section class="list"><h2>${t.issues} (${r.issues.length})</h2>${r.issues.length ? `<ul>${issueHtml}</ul>` : `<p class="empty">${t.none}</p>`}</section>` : ""}
    <section class="list"><h2>${t.visual} (${r.visual.length})</h2><p class="hint">${t.visualHint}</p>${r.visual.length ? `<ul>${visualHtml}</ul>` : `<p class="empty">${t.none}</p>`}</section>
  </aside>
</main>
<script>
const tabs=[...document.querySelectorAll('[role=tab]')];
tabs.forEach(b=>b.addEventListener('click',()=>{
  tabs.forEach(x=>x.setAttribute('aria-selected',x===b));
  document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.dataset.pane===b.dataset.pane));
  document.querySelectorAll('.ctl').forEach(c=>c.hidden=c.dataset.for!==b.dataset.pane);
}));
const swipeTop=document.getElementById('swipeTop');
const fitSwipe=()=>{const img=swipeTop.querySelector('img');img.style.width=swipeTop.parentElement.clientWidth+'px';img.style.height='auto'};
new ResizeObserver(fitSwipe).observe(swipeTop.parentElement);
document.getElementById('swipe').addEventListener('input',e=>swipeTop.style.width=e.target.value+'%');
document.getElementById('onion').addEventListener('input',e=>document.getElementById('onionTop').style.opacity=e.target.value/100);
document.querySelectorAll('.issue').forEach(b=>b.addEventListener('click',()=>{
  const id=b.dataset.mark;
  document.querySelectorAll('.issue').forEach(x=>x.classList.toggle('on',x===b));
  let first=null;
  document.querySelectorAll('.mark').forEach(m=>{const on=m.dataset.id===id;m.classList.toggle('hit',on);if(on&&!first&&m.closest('.pane.on'))first=m});
  if(first)first.scrollIntoView({block:'center',behavior:'smooth'});
}));
</script>
</body>
</html>`;
}

/** The machine-readable report: everything except the images. */
export function toJson(r: Result) {
  const { images: _images, ...rest } = r;
  return rest;
}
