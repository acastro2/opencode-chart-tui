// The theme: every colour the library draws with comes from here, so a chart
// looks right on a dark terminal and on a light one.

import assert from "node:assert/strict";
import { renderCandleRows } from "../src/candle.js";
import { contrastOn } from "../src/core.js";
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
  assert.equal(styleOf({ text: "plain", kind: "outside" }, palette, theme).fg, theme.foreground);

  const fallback = styleOf({ text: "x", kind: "edge", slice: 0 }, palette, theme);
  assert.equal(fallback.bg, theme.background, "a two-colour cell with no second series falls back to the theme");
});

// The kinds below are the whole run-kind contract: one handler each, and a
// result a test can read. Dark and light are checked apart, because a colour
// taken from the wrong theme is the bug this file exists for.
const KINDS = [
  "edge",
  "line",
  "label",
  "cell",
  "fill",
  "series",
  "legend-mark",
  "spoke",
  "legend",
  "title",
  "axis",
  "grid",
  "track",
  "target",
  "outside",
];
const PLAIN_PALETTE = ["#111111", "#222222", "#333333"];

check("every run kind has a handler with the documented style", () => {
  const dark = THEMES.dark;
  const series = PLAIN_PALETTE[2];
  // Slice 2 is the third colour, so a handler that reads the slice shows it.
  const expected = {
    edge: { text: "x", fg: series, bg: dark.background },
    line: { text: "x", fg: dark.background, bg: series },
    label: { text: "x", fg: contrastOn(series), bg: series },
    cell: { text: "x", bg: series },
    fill: { text: "x", fg: series },
    series: { text: "x", fg: series },
    "legend-mark": { text: "x", fg: series },
    spoke: { text: "x", fg: series },
    legend: { text: "x", fg: series },
    title: { text: "x", fg: series, bold: true },
    axis: { text: "x", fg: dark.muted },
    grid: { text: "x", fg: dark.muted },
    track: { text: "x", fg: dark.muted },
    target: { text: "x", fg: dark.muted },
    outside: { text: "x", fg: dark.foreground },
  };
  assert.deepEqual(Object.keys(expected).sort(), [...KINDS].sort(), "a kind was added or dropped without a test");
  for (const kind of KINDS) {
    assert.deepEqual(styleOf({ text: "x", kind, slice: 2 }, PLAIN_PALETTE, dark), expected[kind], `${kind} on dark`);
  }
});

check("every run kind follows the light theme", () => {
  const light = THEMES.light;
  const series = PALETTES.light[2];
  const expected = {
    edge: { text: "x", fg: series, bg: light.background },
    line: { text: "x", fg: light.background, bg: series },
    label: { text: "x", fg: contrastOn(series), bg: series },
    cell: { text: "x", bg: series },
    fill: { text: "x", fg: series },
    series: { text: "x", fg: series },
    "legend-mark": { text: "x", fg: series },
    spoke: { text: "x", fg: series },
    legend: { text: "x", fg: series },
    title: { text: "x", fg: series, bold: true },
    axis: { text: "x", fg: light.muted },
    grid: { text: "x", fg: light.muted },
    track: { text: "x", fg: light.muted },
    target: { text: "x", fg: light.muted },
    outside: { text: "x", fg: light.foreground },
  };
  for (const kind of KINDS) {
    const style = styleOf({ text: "x", kind, slice: 2 }, PALETTES.light, light);
    assert.deepEqual(style, expected[kind], `${kind} on light`);
    const onDark = styleOf({ text: "x", kind, slice: 2 }, PLAIN_PALETTE, THEMES.dark);
    assert.notDeepEqual(style, onDark, `${kind} reads the theme, not a hardcoded colour`);
  }
});

check("an unknown or inherited kind is plain text", () => {
  const plain = { text: "x", fg: THEMES.dark.foreground };
  const unknown = ["outside", "nonsense", "", undefined, null, "constructor", "toString", "hasOwnProperty", "__proto__"];
  for (const kind of unknown) {
    assert.deepEqual(styleOf({ text: "x", kind }, PLAIN_PALETTE, THEMES.dark), plain, `${String(kind)} is plain`);
  }
});

check("an explicit colour beats the palette, and only where a kind has one", () => {
  const dark = THEMES.dark;
  const own = "#abcdef";
  const coloured = (kind) => styleOf({ text: "x", kind, slice: 0, color: own }, PLAIN_PALETTE, dark);

  assert.equal(coloured("fill").fg, own);
  assert.equal(coloured("edge").fg, own, "an edge's glyph takes the colour");
  assert.equal(coloured("edge").bg, dark.background, "the colour does not leak into the bed");
  assert.equal(coloured("line").bg, own, "a line takes the colour as its bed");
  assert.equal(coloured("label").bg, own, "a label's block is the colour");
  assert.equal(coloured("label").fg, contrastOn(own), "and the glyph contrasts with it");
  assert.equal(coloured("cell").bg, own);
  assert.equal(coloured("title").fg, own);

  // Furniture and plain text carry no colour of their own, on purpose.
  for (const kind of ["axis", "grid", "track", "target"]) {
    assert.equal(coloured(kind).fg, dark.muted, `${kind} stays muted`);
  }
  assert.equal(coloured("outside").fg, dark.foreground);
});

check("an explicit background beats `other` and the theme", () => {
  const dark = THEMES.dark;
  const edge = styleOf({ text: "x", kind: "edge", slice: 0, other: 1, background: "#ffffff" }, PLAIN_PALETTE, dark);
  assert.equal(edge.bg, "#ffffff", "an explicit background wins over the other series");
  assert.equal(edge.fg, PLAIN_PALETTE[0]);
});

check("`other` picks the bed of an edge and is ignored by a label", () => {
  const dark = THEMES.dark;
  const bed = (extra) => styleOf({ text: "x", kind: "edge", slice: 0, ...extra }, PLAIN_PALETTE, dark).bg;
  assert.equal(bed({ other: 1 }), PLAIN_PALETTE[1]);
  assert.equal(bed({ other: 4 }), PLAIN_PALETTE[1], "an out-of-range other wraps the palette");
  assert.equal(bed({ other: -1 }), dark.background, "a negative other is no series");
  assert.equal(bed({}), dark.background, "no other is no series");

  // A label sits outside a mark, so `other` must not paint a block behind it.
  const label = styleOf({ text: "x", kind: "label", slice: 1, other: 2 }, PLAIN_PALETTE, dark);
  assert.equal(label.bg, PLAIN_PALETTE[1], "a label's block is its own series, not the other one");
});

check("a slice out of range wraps the palette, a negative one has no colour", () => {
  const dark = THEMES.dark;
  const palette = PLAIN_PALETTE;
  const fg = (slice) => styleOf({ text: "x", kind: "fill", slice }, palette, dark).fg;
  assert.equal(fg(3), palette[0], "3 wraps to the first colour");
  assert.equal(fg(5), palette[2]);
  assert.equal(fg(100), palette[100 % 3]);
  assert.equal(fg(-1), dark.muted, "-1 is no series colour");
  assert.equal(fg(1.5), dark.muted, "a fractional slice is not a series");
  assert.equal(styleOf({ text: "x", kind: "cell", slice: -1 }, palette, dark).bg, dark.muted);
  assert.equal(
    styleOf({ text: "x", kind: "title", slice: -1 }, palette, dark).fg,
    undefined,
    "a title with no colour leaves fg unset",
  );
});

check("an empty palette falls back to the dark one", () => {
  assert.equal(styleOf({ text: "x", kind: "fill", slice: 2 }, [], THEMES.dark).fg, PALETTES.dark[2]);
  assert.equal(styleOf({ text: "x", kind: "fill", slice: 2 }, PALETTES.light, THEMES.light).fg, PALETTES.light[2]);
});

check("a label contrasts against the block it sits on", () => {
  const dark = THEMES.dark;
  const own = styleOf({ text: "1", kind: "label", slice: 0 }, PLAIN_PALETTE, dark);
  assert.equal(own.bg, PLAIN_PALETTE[0], "no background: the label takes its series colour");
  assert.equal(own.fg, contrastOn(PLAIN_PALETTE[0]), "and contrasts with it");

  const outside = styleOf({ text: "1", kind: "label", slice: 0, background: "#ffffff" }, PLAIN_PALETTE, dark);
  assert.equal(outside.bg, "#ffffff", "a background puts the label outside the mark");
  assert.equal(outside.fg, contrastOn("#ffffff"), "and contrasts with that, not the series");

  const noSeries = styleOf({ text: "1", kind: "label" }, PLAIN_PALETTE, dark);
  assert.equal(noSeries.bg, dark.muted, "a label with no series sits on the muted tone");
  assert.equal(noSeries.fg, contrastOn(dark.muted));
});

check("a cell has no fg key and a title keeps one even when it is unset", () => {
  const dark = THEMES.dark;
  const cell = styleOf({ text: " ", kind: "cell", slice: 0 }, PLAIN_PALETTE, dark);
  assert.deepEqual(Object.keys(cell).sort(), ["bg", "text"], "a cell is a colour with nothing in it");
  const title = styleOf({ text: "T", kind: "title" }, PLAIN_PALETTE, dark);
  assert.deepEqual(Object.keys(title).sort(), ["bold", "fg", "text"]);
  assert.ok(Object.hasOwn(title, "fg"), "the key stays present, so the result shape does not depend on the data");
  assert.equal(title.fg, undefined);
});

check("the run's text passes through untouched", () => {
  const dark = THEMES.dark;
  assert.equal(styleOf({ kind: "fill", slice: 0 }, PLAIN_PALETTE, dark).text, "", "no text is empty, not undefined");
  assert.equal(styleOf({ text: "🌑", kind: "fill", slice: 0 }, PLAIN_PALETTE, dark).text, "🌑", "an astral glyph is kept");
});

check("styleOf with no palette or theme uses the dark ones", () => {
  assert.deepEqual(styleOf({ text: "x", kind: "fill", slice: 4 }), { text: "x", fg: PALETTES.dark[4] });
  assert.deepEqual(styleOf({ text: "x", kind: "axis" }), { text: "x", fg: THEMES.dark.muted });
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
