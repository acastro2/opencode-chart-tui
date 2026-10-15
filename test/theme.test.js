// The theme: every colour the library draws with comes from here, so a chart
// looks right on a dark terminal and on a light one.

import assert from "node:assert/strict";
import { renderCandleRows } from "../src/candle.js";
import { renderTableRows } from "../src/table.js";
import { PALETTES, THEMES, paletteOf, styleOf, themeOf } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};
const coloursOf = (rows) =>
  new Set(rows.flatMap((row) => row.runs).filter((run) => typeof run.color === "string").map((run) => run.color));

check("the theme comes from the spec, dark by default", () => {
  assert.equal(themeOf({}).name, "dark");
  assert.equal(themeOf({ theme: "light" }).name, "light");
  assert.equal(themeOf({ theme: "nonsense" }).name, "dark", "an unknown theme is not a crash");
});

check("a palette in the spec wins over the theme", () => {
  assert.deepEqual(paletteOf({ palette: ["#111111", "#222222"] }), ["#111111", "#222222"]);
  assert.deepEqual(paletteOf({}), THEMES.dark.palette);
  assert.equal(paletteOf({ theme: "light" })[0], PALETTES.light[0]);
});

check("light paints on white, dark on near black, and the palettes differ", () => {
  assert.equal(THEMES.light.background, "#ffffff");
  assert.equal(THEMES.dark.background, "#0b0b0b");
  assert.notDeepEqual(PALETTES.light, PALETTES.dark);
  assert.ok(THEMES.light.muted !== THEMES.dark.muted, "the muted tone follows the background");
});

check("every run kind maps to a colour and a background", () => {
  const palette = THEMES.dark.palette;
  const theme = THEMES.dark;

  const edge = styleOf({ text: "x", kind: "edge", slice: 1, other: 2 }, palette, theme);
  assert.equal(edge.fg, palette[1], "the glyph carries the winning series");
  assert.equal(edge.bg, palette[2], "the background carries the other one");

  const label = styleOf({ text: "1", kind: "label", slice: 0 }, palette, theme);
  assert.equal(label.bg, palette[0]);
  assert.ok(["#101010", "#ffffff"].includes(String(label.fg).toLowerCase()), `a label contrasts (${label.fg})`);

  const cell = styleOf({ text: " ", kind: "cell", color: "#123456" }, palette, theme);
  assert.equal(cell.bg, "#123456");
  assert.equal(cell.fg, undefined, "a cell is a colour with nothing in it");

  const line = styleOf({ text: "─", kind: "line", slice: 0 }, palette, theme);
  assert.equal(line.bg, palette[0]);
  assert.equal(line.fg, theme.background, "the boundary is the background colour");

  const fill = styleOf({ text: "█", kind: "fill", slice: 3 }, palette, theme);
  assert.equal(fill.fg, palette[3]);
  assert.equal(fill.bg, undefined);

  assert.equal(styleOf({ text: "T", kind: "title" }, palette, theme).bold, true);
  assert.equal(styleOf({ text: "axis", kind: "axis" }, palette, theme).fg, theme.muted);
  assert.equal(styleOf({ text: "grid", kind: "grid" }, palette, theme).fg, theme.muted);
  assert.equal(styleOf({ text: "plain", kind: "outside" }, palette, theme).fg, undefined);

  const fallback = styleOf({ text: "x", kind: "edge", slice: 0 }, palette, theme);
  assert.equal(fallback.bg, theme.background, "a two-colour cell with no second series falls back to the theme");
});

check("an explicit colour beats the palette", () => {
  const style = styleOf({ text: "█", kind: "fill", slice: 0, color: "#abcdef" }, THEMES.light.palette, THEMES.light);
  assert.equal(style.fg, "#abcdef");
});

check("the families take their colours from the theme", () => {
  const spec = { width: 40, height: 8, values: [[10, 12, 9, 11]] };
  const dark = coloursOf(renderCandleRows(spec));
  const light = coloursOf(renderCandleRows({ ...spec, theme: "light" }));
  assert.ok(dark.size > 0 && light.size > 0, "both themes draw a candle");
  assert.notDeepEqual([...dark].sort(), [...light].sort(), "the candle colour follows the theme");
});

check("a fence can still override the colours", () => {
  const colours = coloursOf(renderCandleRows({ width: 40, height: 8, values: [[10, 12, 9, 11]], up: "#123456" }));
  assert.ok(colours.has("#123456"), `an explicit colour wins (${[...colours].join(",")})`);
});

check("the table's heat ramp follows the theme", () => {
  const spec = {
    width: 40,
    columns: [{ label: "v", type: "heat" }],
    rows: [[1], [9]],
  };
  const dark = coloursOf(renderTableRows(spec));
  const light = coloursOf(renderTableRows({ ...spec, theme: "light" }));
  assert.ok(dark.size >= 2 && light.size >= 2, "the ramp paints both ends");
  assert.notDeepEqual([...dark].sort(), [...light].sort(), "the ramp follows the theme");
});

console.log(`\n${checks}/${checks} checks passed`);
