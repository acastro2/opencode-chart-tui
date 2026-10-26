// A one-page colour gallery of every family, built from the same samples.
//
//   node scripts/gallery.mjs [--theme light]
//
// Opens assets/<type>.svg in the browser. Regenerate the SVGs first with
// `node scripts/images.mjs 76` if the chart code changed.

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLES } from "./corpus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const themeIndex = args.indexOf("--theme");
const themeName = themeIndex >= 0 && args[themeIndex + 1] === "light" ? "light" : "dark";
const assets = themeName === "dark" ? "assets" : "assets/light";
const output = themeName === "dark" ? "review/gallery.html" : "review/gallery-light.html";
const ui =
  themeName === "light"
    ? { scheme: "light", page: "#ffffff", text: "#1f2328", muted: "#57606a", border: "#d0d7de", card: "#f6f8fa" }
    : { scheme: "dark", page: "#0b0d10", text: "#e6edf3", muted: "#8b949e", border: "#21262d", card: "#0d1117" };
const names = Object.keys(SAMPLES);
const missing = names.filter((name) => !existsSync(resolve(root, `${assets}/${name}.svg`)));

const cards = names
  .map(
    (name) => `      <a class="card" href="../${assets}/${name}.svg" target="_blank" rel="noreferrer">
        <div class="name">${name}</div>
        <img src="../${assets}/${name}.svg" alt="${name} chart" loading="lazy">
      </a>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chart gallery</title>
<style>
  :root { color-scheme: ${ui.scheme}; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; background: ${ui.page}; color: ${ui.text};
         font: 14px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  h1 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  p  { margin: 0 0 24px; color: ${ui.muted}; }
  .grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); }
  .card { display: block; border: 1px solid ${ui.border}; border-radius: 10px; background: ${ui.card};
          padding: 10px 10px 6px; text-decoration: none; color: inherit; }
  .card:hover { border-color: #3d444d; }
  .name { margin: 0 0 8px; color: ${ui.muted}; font-size: 12px; letter-spacing: .04em; }
  img { display: block; width: 100%; height: auto; border-radius: 8px; }
  @media (max-width: 520px) { body { padding: 14px; } .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <h1>Chart gallery${themeName === "light" ? " (light)" : ""}</h1>
  <p>All ${names.length} families, rendered from <code>scripts/samples.mjs</code>. Click a card for the full-size SVG.</p>
  <div class="grid">
${cards}
  </div>
</body>
</html>
`;

writeFileSync(resolve(root, output), html);
console.log(`${output}: ${names.length - missing.length}/${names.length} families`);
if (missing.length > 0) console.log(`missing: ${missing.join(", ")}`);
