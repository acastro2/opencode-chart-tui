// Pictures for the README: one SVG per family, drawn from the real renderer.
//
//   node scripts/images.mjs [width] [--theme light]
//
// Each image is the chart's own styled runs, drawn as a terminal would draw them
// but without trusting a font: mosaic and block glyphs become rectangles, so the
// shapes are exact even where a reader's font has no Unicode 13 character. Text
// stays text, in a monospace stack.
//
// Writes assets/<type>.svg, or assets/light/<type>.svg with --theme light.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderChartRows } from "../src/chart.js";
import { styleOf, themeOf } from "../src/theme.js";
import { availableModes, glyphFor, modeShape } from "../src/mosaic.js";
import { SAMPLES } from "./samples.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const themeIndex = args.indexOf("--theme");
const themeName = themeIndex >= 0 && args[themeIndex + 1] === "light" ? "light" : "dark";
const out = resolve(here, "..", themeName === "dark" ? "assets" : "assets/light");
const width = Number(args.find((arg) => /^\d+$/.test(arg))) || 76;
const chrome =
  themeName === "light"
    ? { page: "#ffffff", bar: "#f3f4f6", title: "#57606a", fg: "#1f2328" }
    : { page: "#0b0d10", bar: "#161b22", title: "#8b949e", fg: "#e6edf3" };

const CELL_W = 8;
const CELL_H = 16;
const PAD = 14;
const BAR = 26;
const FONT = 12.5;
const TEXT = "'JetBrains Mono','SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace";

// ---------------------------------------------------------------- glyph shapes

/** mask -> sub-cell rectangles, for every glyph the mosaic tables can produce. */
function mosaicShapes() {
  const shapes = new Map();
  for (const mode of availableModes()) {
    const { columns, rows } = modeShape(mode);
    for (let mask = 1; mask <= 2 ** (columns * rows) - 1; mask += 1) {
      const glyph = glyphFor(mask, mode);
      if (!glyph || glyph === " " || shapes.has(glyph)) continue;
      const rects = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if ((mask >> (row * columns + column)) & 1) {
            rects.push([column / columns, row / rows, 1 / columns, 1 / rows]);
          }
        }
      }
      shapes.set(glyph, rects);
    }
  }
  return shapes;
}

const MOSAIC = mosaicShapes();
const EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const BOTTOM = ["▁", "▂", "▃", "▄", "▅", "▆", "▇"];
const SHADES = { "░": 0.25, "▒": 0.5, "▓": 0.75 };

/** Rectangles for one glyph, as fractions of the cell, or null when it is text. */
function shapesFor(char) {
  if (char === "█") return [[0, 0, 1, 1]];
  const mosaic = MOSAIC.get(char);
  if (mosaic) return mosaic;
  const left = EIGHTHS.indexOf(char);
  if (left >= 0) return [[0, 0, (left + 1) / 8, 1]];
  const bottom = BOTTOM.indexOf(char);
  if (bottom >= 0) return [[0, 1 - (bottom + 1) / 8, 1, (bottom + 1) / 8]];
  if (char === "▀") return [[0, 0, 1, 0.5]];
  if (char === "▐") return [[0.5, 0, 0.5, 1]];
  if (char in SHADES) return [[0, 0, 1, 1]];
  return null;
}

const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ------------------------------------------------------------------- rendering

function image(name, spec) {
  const theme = themeOf(spec);
  const palette = spec.palette ?? theme.palette;
  const rows = renderChartRows({ ...spec, width });
  const columns = Math.max(width, ...rows.map((row) => row.width));

  const cols = columns * CELL_W;
  const height = rows.length * CELL_H;
  const parts = [];
  let shapes = 0;
  let letters = 0;

  rows.forEach((row, y) => {
    let x = 0;
    for (const run of row.runs) {
      const style = styleOf(run, palette, theme);
      const fg = style.fg ?? chrome.fg;
      for (const char of run.text) {
        const px = PAD + x * CELL_W;
        const py = BAR + y * CELL_H;
        if (style.bg) {
          parts.push(`<rect x="${px}" y="${py}" width="${CELL_W}" height="${CELL_H}" fill="${style.bg}"/>`);
        }
        if (char !== " ") {
          const rects = shapesFor(char);
          if (rects) {
            const fade = SHADES[char];
            const opacity = fade ? ` fill-opacity="${fade}"` : "";
            for (const [fx, fy, fw, fh] of rects) {
              parts.push(
                `<rect x="${(px + fx * CELL_W).toFixed(2)}" y="${(py + fy * CELL_H).toFixed(2)}" ` +
                  `width="${(fw * CELL_W).toFixed(2)}" height="${(fh * CELL_H).toFixed(2)}" fill="${fg}"${opacity}/>`,
              );
              shapes += 1;
            }
          } else {
            parts.push(
              `<text x="${px + CELL_W / 2}" y="${py + CELL_H - 4}" fill="${fg}" font-size="${FONT}" ` +
                `font-family="${TEXT}" text-anchor="middle">${escape(char)}</text>`,
            );
            letters += 1;
          }
        }
        x += 1;
      }
    }
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols + 2 * PAD}" height="${height + BAR + PAD}" viewBox="0 0 ${cols + 2 * PAD} ${height + BAR + PAD}" font-family="${TEXT}" shape-rendering="crispEdges">
<rect width="100%" height="100%" rx="10" fill="${chrome.page}"/>
<rect x="0" y="0" width="100%" height="${BAR}" rx="10" fill="${chrome.bar}"/>
<rect x="0" y="${BAR - 10}" width="100%" height="10" fill="${chrome.bar}"/>
<circle cx="16" cy="${BAR / 2}" r="5" fill="#ff5f57"/><circle cx="34" cy="${BAR / 2}" r="5" fill="#febc2e"/><circle cx="52" cy="${BAR / 2}" r="5" fill="#28c840"/>
<text x="${(cols + 2 * PAD) / 2}" y="${BAR / 2 + 4}" fill="${chrome.title}" font-size="12" text-anchor="middle">${escape(name)}</text>
${parts.join("\n")}
</svg>
`;

  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, `${name}.svg`), svg);
  return { rows: rows.length, columns, shapes, letters };
}

const names = Object.keys(SAMPLES);
let failed = 0;
for (const name of names) {
  try {
    const info = image(name, { ...SAMPLES[name], type: name, theme: themeName });
    console.log(
      `  ${name.padEnd(12)} ${String(info.columns).padStart(3)}x${info.rows}  ` +
        `${String(info.shapes).padStart(5)} shapes  ${String(info.letters).padStart(4)} glyphs`,
    );
  } catch (error) {
    failed += 1;
    console.log(`  ${name.padEnd(12)} FAILED ${error?.message ?? error}`);
  }
}
console.log(`\n${names.length - failed}/${names.length} images written to ${out}`);
