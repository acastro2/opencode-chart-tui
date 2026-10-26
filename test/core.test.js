import assert from "node:assert/strict";
import {
  blankGrid,
  cellsToRuns,
  cols,
  drawBox,
  formatNumber,
  legendLines,
  legendRowRuns,
  makeSampler,
  mixHex,
  normalizeEntries,
  normalizeSeries,
  paintCell,
  padTo,
  runsText,
  stampText,
  tallyFromGrid,
  truncate,
} from "../src/core.js";
import { buildAxis, categoryRow, niceMax } from "../src/axis.js";
import { clipWidth, measureWidth } from "../src/layout.js";
import { glyphFor, modeShape } from "../src/mosaic.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

check("numbers stay honest when the zeros are not decimals", () => {
  // The regression: a trailing-zero strip that ate the zero of 120.
  assert.equal(formatNumber(120), "120");
  assert.equal(formatNumber(150), "150");
  assert.equal(formatNumber(1000), "1k");
  assert.equal(formatNumber(1234), "1.23k");
  assert.equal(formatNumber(2500000), "2.5M");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(0.25), "0.25");
  assert.equal(formatNumber(-1500), "-1.5k");
});

check("width is measured in cells, not UTF-16 units", () => {
  // A sextant glyph is one cell and two units.
  const glyph = "\u{1FB0B}";
  assert.equal(glyph.length, 2);
  assert.equal(cols(glyph), 1);
  assert.equal(cols(`${glyph}${glyph}ab`), 4);
  assert.equal(truncate(`${glyph}${glyph}abcd`, 4), `${glyph}${glyph}a…`);
  assert.equal(cols(truncate("abcdef", 3)), 3);
  assert.equal(cols(padTo(glyph, 3)), 3);
});

check("a box that reports no width still measures a finite chart", () => {
  // The bug: Yoga's Undefined measure mode arrives as NaN, `Math.min(NaN, 160)`
  // is NaN, and every row was then drawn at NaN width, so nothing showed.
  assert.equal(measureWidth(NaN), 160, "no width from the box falls back to the cap");
  assert.equal(measureWidth(undefined), 160);
  assert.equal(measureWidth(Infinity), 160, "an infinite box is capped, not passed on");
  for (const available of [NaN, undefined, Infinity, -5, 0, 1, 15, 16, 17, 99, 160, 161, 480]) {
    const width = measureWidth(available);
    assert.ok(Number.isInteger(width), `${String(available)} gave ${width}, not a whole number of cells`);
    assert.ok(width >= 16, `${String(available)} gave ${width}, below the floor`);
    assert.ok(width <= 160, `${String(available)} gave ${width}, above the cap`);
  }
  assert.equal(measureWidth(80), 80, "a real box is used as it is");
  assert.equal(measureWidth(161), 160, "a box wider than the cap is capped");
});

check("the cap and a pinned width survive a box with no width", () => {
  assert.equal(measureWidth(480, { cap: 110 }), 110, "a grid family keeps its ceiling");
  assert.equal(measureWidth(NaN, { cap: 110 }), 110, "and it applies when the box is NaN");
  assert.equal(measureWidth(80, { pinned: 40 }), 40, "the fence's own width wins over the box");
  assert.equal(measureWidth(80, { pinned: 400 }), 80, "but never past the box");
  assert.equal(measureWidth(NaN, { pinned: 400 }), 160, "or past the cap");
  assert.equal(measureWidth(80, { pinned: 0 }), 80, "width 0 is not a width");
  assert.equal(measureWidth(80, { pinned: 8 }), 16, "a pinned width below the floor is the floor");
  assert.equal(measureWidth(80, { pinned: "40" }), 40, "a numeric string is a number");
});

check("a row is clipped to the box it measured itself into", () => {
  // Radar floors its own width at 20, so in a 16-cell box it wrote four cells
  // past the block it had measured.
  assert.equal(clipWidth(20, 16), 16, "a wider row stops at the box");
  assert.equal(clipWidth(20, 40), 20, "a narrower row is untouched");
  assert.equal(clipWidth(20, NaN), 20, "a box with no width clips nothing");
  assert.equal(clipWidth(20, Infinity), 20);
  assert.equal(clipWidth(NaN, 40), 40, "a row with no width uses the box");
  assert.equal(clipWidth(NaN, NaN), 160, "and two missing widths are still a number");
  assert.equal(clipWidth(5, 100), 5, "a short row keeps its own width");
  for (let box = 1; box <= 60; box++) {
    for (const row of [16, 20, 48, 160]) assert.ok(clipWidth(row, box) <= box, `row ${row} in a ${box}-cell box`);
  }
});

check("a chart with values and no series still has one named series", () => {
  const single = normalizeSeries({ values: [3, 4] });
  assert.equal(single.series.length, 1);
  assert.deepEqual(single.series[0].values, [3, 4]);
  assert.deepEqual(single.labels, ["1", "2"]);

  const padded = normalizeSeries({ labels: ["a", "b", "c"], series: [{ name: "x", values: [1] }] });
  assert.deepEqual(padded.series[0].values, [1, 0, 0], "short series are padded, not dropped");
  assert.deepEqual(padded.labels, ["a", "b", "c"]);

  const named = normalizeSeries({ labels: ["a"], series: [{ name: "Closed", values: [5] }] });
  assert.equal(named.series[0].name, "Closed");
  assert.equal(normalizeSeries({ slices: [["a", 1]] }).series.length, 0, "slices are not series");
});

check("entries drop empty values and keep order", () => {
  assert.deepEqual(normalizeEntries([["a", 2], ["b", 0], ["c", -1], ["d", 3]]), [
    { label: "a", value: 2 },
    { label: "d", value: 3 },
  ]);
  assert.deepEqual(normalizeEntries([{ label: "x", value: 1 }]), [{ label: "x", value: 1 }]);
});

check("legends align their values and never exceed the width", () => {
  const entries = normalizeEntries([["Closed won", 89], ["In flight", 34], ["At risk", 12]]);
  for (const width of [24, 40, 80]) {
    for (const line of legendLines(entries, { width, glyphs: ["█", "▓", "▒"] })) {
      assert.equal(cols(line), width, `"${line}" at width ${width}`);
    }
    for (const row of legendRowRuns(entries, { width })) {
      assert.ok(cols(runsText(row.runs)) <= width);
    }
  }
  const lines = legendLines(entries, { width: 40, glyphs: ["█", "▓", "▒"] });
  assert.ok(lines.every((line) => line.includes("%")), "every legend line carries a percentage");
});

check("the sampler fills a cell from its sub-cells", () => {
  for (const mode of ["quadrant", "sextant", "octant"]) {
    const sampler = makeSampler(mode);
    assert.equal(sampler.subCells, sampler.shape.columns * sampler.shape.rows);
    assert.equal(sampler.solidMask, 2 ** sampler.subCells - 1);
    assert.equal(sampler.glyph(sampler.solidMask, "X"), "X", "a full cell uses the series glyph");

    // A classifier that fills the left half of the cell must produce a mask of
    // the left sub-columns only.
    const { mask, tally } = sampler.sample(0, 0, (x) => (x < 0 ? 0 : -1));
    const left = Array.from({ length: sampler.shape.rows }, (_, row) => 1 << (row * sampler.shape.columns)).reduce(
      (sum, bit) => sum | bit,
      0,
    );
    assert.equal(mask, left);
    assert.equal(tally.get(0), sampler.shape.rows);
  }
  assert.equal(makeSampler(false).mosaic, "quadrant", "false is the universal-font fallback");
});

check("a cell crossed by a boundary carries both series", () => {
  const sampler = makeSampler("octant");
  const series = ["a", "b"];
  // Two sub-cell rows of series 1 at the top, the rest series 0.
  const grid = (x, y) => (y < 2 ? 1 : 0);
  const { mask, tally, masks } = tallyFromGrid(grid, 0, 0, sampler);
  const cell = paintCell({ sampler, mask, tally, masks, glyphs: ["█", "▓"] });
  assert.equal(cell.slice, 0, "the majority series owns the cell");
  assert.equal(cell.other, 1, "the other series is named, for the background colour");
  assert.equal(cell.kind, "edge");
  assert.notEqual(cell.char, "█", "an edge cell is a partial pattern, never a full block");

  // One series alone is a plain fill.
  const only = tallyFromGrid(() => 0, 0, 0, sampler);
  const solid = paintCell({ sampler, mask: only.mask, tally: only.tally, masks: only.masks, glyphs: ["█", "▓"] });
  assert.equal(solid.kind, "fill");
  assert.equal(solid.char, "█");
  assert.equal(solid.other, undefined);

  assert.equal(typeof series, "object");
});

check("the axis tops out on a round number and shapes both ends", () => {
  assert.equal(niceMax(87), 100);
  assert.equal(niceMax(230), 250);
  assert.equal(niceMax(810), 1000);
  assert.equal(niceMax(0.4), 0.5);

  for (const [min, max] of [[0, 7], [0, 87], [0, 146], [0, 1234], [-40, 60], [-5, -1], [-200, -3]]) {
    const axis = buildAxis({ min, max, plotRows: 8, ticks: 4 });
    assert.ok(axis.top >= max && axis.bottom <= min, `${axis.bottom}..${axis.top} covers ${min}..${max}`);
    assert.ok(axis.bottom <= 0 && axis.top >= 0, "zero is always on the axis");
    const rows = axis.ticks.map((tick) => tick.row);
    assert.equal(new Set(rows).size, rows.length, "two ticks cannot share a row");
    assert.ok(Math.max(...rows) < axis.plotRows && Math.min(...rows) >= 0);
    assert.equal(axis.rowOf(0), axis.zeroRow, "zero has a row of its own");
    assert.equal(axis.rowOf(axis.top), 0, "the top of the axis is the first row");
    assert.equal(axis.rowOf(axis.bottom), axis.plotRows - 1, "the bottom of the axis is the last row");
    assert.ok(axis.gutter >= 2);
  }

  // A chart that only goes down still reads: zero is not glued to the top.
  const negative = buildAxis({ min: -200, max: 0, plotRows: 8 });
  assert.equal(negative.zeroRow, 0);
  assert.ok(negative.bottom < 0);
});

check("category labels thin out instead of colliding", () => {
  const labels = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const wide = categoryRow(labels, { groupWidth: 4, gap: 1, width: 30 });
  assert.ok(cols(wide) <= 30, `category row is ${cols(wide)} cells`);
  assert.ok(wide.includes("Jul") && wide.includes("Dec"), "wide slots keep every label");

  const narrow = categoryRow(labels, { groupWidth: 1, gap: 0, width: 6 });
  assert.ok(cols(narrow) <= 6);
  assert.ok(!narrow.includes("Aug"), "single columns drop alternates");

  const kept = [...wide].join("");
  assert.ok(!kept.includes("JuA"), "labels never touch");
  assert.ok(wide.includes("Dec"), "the last label survives when it fits");
});

check("an axis can leave zero out of a narrow range", () => {
  // Prices or scores a few units apart collapse into one or two rows when zero
  // is forced in, so a caller can ask for the range without it.
  const tight = buildAxis({ min: 180, max: 190, plotRows: 8, ticks: 4, zero: false });
  assert.ok(tight.bottom >= 180 && tight.top <= 190, `the range stays on the data (${tight.bottom}..${tight.top})`);
  assert.equal(tight.zeroRow, -1, "and there is no zero row to draw");
  const withZero = buildAxis({ min: 180, max: 190, plotRows: 8, ticks: 4 });
  assert.equal(withZero.bottom, 0, "the default still reaches zero");
});

check("colours blend between the ends of a ramp", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixHex("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#123456", "#123456", 0.7), "#123456");
});

check("numbers keep their magnitude when the unit has to change", () => {
  // Every rounding step, plus the bump that follows a mantissa rounding to 1000.
  assert.equal(formatNumber(0.0012), "0.0012");
  assert.equal(formatNumber(0.009), "0.009");
  assert.equal(formatNumber(10.05), "10.1");
  assert.equal(formatNumber(12345), "12.3k");
  assert.equal(formatNumber(120000), "120k");
  assert.equal(formatNumber(999999), "1M");
  assert.equal(formatNumber(999.9), "1000");
  assert.equal(formatNumber(1e15), "1P");
  assert.equal(formatNumber(1e18), "1000P", "nothing past peta, so the mantissa grows instead");
  assert.equal(formatNumber("abc"), "?");
  assert.equal(formatNumber(undefined), "?");
  assert.equal(formatNumber(null), "0");
});

check("entries accept both shapes and drop what cannot be drawn", () => {
  assert.deepEqual(normalizeEntries(), []);
  assert.deepEqual(normalizeEntries(null), []);
  assert.deepEqual(normalizeEntries([["only-label"], [null, 3], { value: 2 }]), [
    { label: "", value: 3 },
    { label: "", value: 2 },
  ]);
  assert.deepEqual(normalizeEntries([["a", "2"]]), [{ label: "a", value: 2 }], "numeric strings are numbers");
  assert.deepEqual(normalizeEntries([["x", NaN], ["y", Infinity], ["z", "abc"]]), []);
});

check("series beat values and pad to the longest input", () => {
  const precedence = normalizeSeries({ values: [9, 9], series: [{ name: "s", values: [1] }], labels: ["a", "b"] });
  assert.deepEqual(precedence.series, [{ name: "s", values: [1, 0] }], "series win over values");
  assert.deepEqual(precedence.labels, ["a", "b"]);

  const arrays = normalizeSeries({ name: "n", series: [[1, 2], [3]] });
  assert.deepEqual(arrays.series, [
    { name: "n", values: [1, 2] },
    { name: "n", values: [3, 0] },
  ]);

  const unnamed = normalizeSeries({ series: [{ values: [1] }, { values: [2] }] });
  assert.deepEqual(unnamed.series.map((item) => item.name), ["series 1", "series 2"]);
  assert.equal(normalizeSeries({ name: "total", series: [{ values: [1] }] }).series[0].name, "total");
  assert.equal(normalizeSeries({ values: [1] }, "n").series[0].name, "n");

  assert.deepEqual(normalizeSeries({ values: ["x", 2] }).series[0].values, [0, 2], "a bad point becomes zero");
  assert.deepEqual(normalizeSeries({ labels: "ab", series: [{ values: [1, 2] }] }).labels, ["1", "2"]);
  assert.deepEqual(normalizeSeries({ labels: [null], series: [{ values: [1] }] }).labels, ["1"]);
  assert.deepEqual(
    normalizeSeries({ series: [{ values: [] }, { values: [1] }] }).series.map((item) => item.name),
    ["series 2"],
    "an empty series is dropped and its raw index kept",
  );
});

check("text is stamped clipped, and a wide glyph owns two cells", () => {
  const grid = blankGrid(5, 1);
  assert.equal(stampText(grid, 0, 0, "漢x"), 3, "a wide glyph counts two cells");
  assert.equal(grid[0][0].char, "漢");
  assert.equal(grid[0][1].char, "", "the continuation cell holds no character");
  assert.equal(grid[0][1].cont, true);
  assert.equal(grid[0][2].char, "x");

  const clipped = blankGrid(3, 1);
  assert.equal(stampText(clipped, 0, 0, "abcdef"), 3, "the rest of the string is dropped");
  assert.equal(clipped[0].map((cell) => cell.char).join(""), "abc");
  assert.equal(stampText(clipped, 2, 0, "漢"), 0, "a wide glyph that does not fit is not half-written");
  assert.equal(stampText(clipped, 0, 9, "x"), 0, "a row that does not exist is not written");
  assert.equal(stampText(clipped, 0, 0, ""), 0);

  const shifted = blankGrid(4, 1);
  assert.equal(stampText(shifted, -2, 0, "ab"), 2, "a negative column clamps to the left edge");
  assert.equal(shifted[0].map((cell) => cell.char).join(""), "ab  ");

  const template = { slice: 2, kind: "label" };
  const styled = blankGrid(3, 1);
  stampText(styled, 0, 0, "ab", template);
  assert.deepEqual(styled[0][0], { slice: 2, kind: "label", char: "a" });
  assert.notEqual(styled[0][0], styled[0][1], "each cell gets its own object");
  assert.deepEqual(template, { slice: 2, kind: "label" }, "the template is not mutated");
});

check("a combining mark lands on the glyph before it", () => {
  const afterChar = blankGrid(4, 1);
  stampText(afterChar, 0, 0, "e");
  assert.equal(stampText(afterChar, 1, 0, "\u0301"), 0, "a mark writes no cell of its own");
  assert.equal(afterChar[0][0].char, "e\u0301");

  // The continuation cell of a wide glyph is stepped over, so the mark reaches
  // the base character rather than attaching to an empty cell.
  const afterWide = blankGrid(4, 1);
  stampText(afterWide, 0, 0, "漢");
  assert.equal(stampText(afterWide, 2, 0, "\u0301"), 0);
  assert.equal(afterWide[0][0].char, "漢\u0301");
  assert.equal(afterWide[0][1].char, "", "the continuation cell is untouched");

  assert.equal(stampText(blankGrid(2, 1), 0, 0, "\u0301"), 0, "a mark with no base writes nothing");
});

check("a box draws its corners and collapses to a line or a column", () => {
  const frame = blankGrid(6, 4);
  drawBox(frame, 0, 0, 5, 3);
  assert.deepEqual(frame.map((row) => row.map((cell) => cell.char).join("")), [
    "╭────╮",
    "│    │",
    "│    │",
    "╰────╯",
  ]);
  assert.equal(frame[1][3].kind, "outside", "the inside of the box stays empty");

  const custom = blankGrid(4, 2);
  drawBox(custom, 0, 0, 3, 1, { glyph: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "-", v: "|" } });
  assert.deepEqual(custom.map((row) => row.map((cell) => cell.char).join("")), ["┌--┐", "└--┘"]);

  const line = blankGrid(4, 1);
  drawBox(line, 0, 0, 3, 0);
  assert.equal(line[0].map((cell) => cell.char).join(""), "╭──╮", "a box with no height is one row");

  const column = blankGrid(3, 4);
  drawBox(column, 1, 0, 1, 3);
  assert.deepEqual([0, 1, 2, 3].map((y) => column[y][1].char), ["╮", "│", "│", "╯"]);

  const inverted = blankGrid(3, 2);
  drawBox(inverted, 2, 1, 1, 0);
  assert.equal(inverted.flat().every((cell) => cell.char === " "), true, "an inverted box writes nothing");

  const styled = blankGrid(2, 2);
  drawBox(styled, 0, 0, 1, 1, { slice: 3, kind: "edge" });
  assert.equal(styled[0][0].slice, 3);
  assert.equal(styled[1][1].kind, "edge");
});

check("cells merge into runs only while they agree", () => {
  const merged = cellsToRuns([
    { char: "a", slice: 0, kind: "fill", other: 1, color: "#111111", background: "#000000" },
    { char: "b", slice: 0, kind: "fill", other: 1, color: "#111111", background: "#000000" },
    { char: "c", slice: 0, kind: "fill", other: 2, color: "#111111", background: "#000000" },
    { char: "d", slice: 0, kind: "fill", other: 2, color: "#222222", background: "#000000" },
    { char: "e", slice: 0, kind: "fill", other: 2, color: "#222222", background: "#000000" },
  ]);
  assert.deepEqual(merged.map((run) => run.text), ["ab", "c", "de"]);
  assert.equal(merged[0].other, 1);
  assert.equal(merged[0].color, "#111111");
  assert.equal(merged[0].background, "#000000");
  assert.equal(merged[2].color, "#222222", "a different colour starts a new run");

  const split = cellsToRuns([
    { char: "x", slice: 0, kind: "fill" },
    { char: "y", slice: 1, kind: "fill" },
    { char: "z", slice: 1, kind: "edge" },
  ]);
  assert.deepEqual(split.map((run) => run.text), ["x", "y", "z"]);
  assert.equal(split[0].other, -1, "a cell with no second series compares as -1");
  assert.equal("color" in split[0], false, "a cell with no colour carries no colour field");

  const padded = cellsToRuns([
    { char: "a", slice: 0, kind: "fill" },
    { char: " ", slice: -1, kind: "outside" },
    { char: "b", slice: 0, kind: "fill" },
    { char: " ", slice: -1, kind: "outside" },
  ]);
  assert.deepEqual(padded.map((run) => run.text), ["a", " ", "b"], "an interior blank stays, a trailing one goes");

  const colouredBlank = cellsToRuns([
    { char: "a", slice: 0, kind: "fill" },
    { char: " ", slice: 0, kind: "fill", color: "#fff" },
  ]);
  assert.deepEqual(colouredBlank.map((run) => run.text), ["a"], "a coloured blank is still dropped");
  assert.deepEqual(cellsToRuns([]), []);
});

check("the sampler owns its shape, its sub-cells, and its fallback", () => {
  const sampler = makeSampler();
  assert.equal(sampler.mosaic, "sextant");
  assert.equal(sampler.minimum, 1);
  assert.equal(makeSampler(null).mosaic, "sextant", "a missing mode is the default");
  assert.equal(makeSampler(false).minimum, 2, "quadrant needs two sub-cells before it draws");
  assert.equal(sampler.glyph(0), " ", "an empty mask has no glyph");

  const full = sampler.sample(0, 0, () => true);
  assert.equal(full.mask, sampler.solidMask);
  assert.deepEqual([...full.tally.keys()], [0], "true means series 0");

  const named = sampler.sample(0, 0, () => 2);
  assert.deepEqual([...named.tally.keys()], [2], "an index is kept as given");
  assert.equal(named.tally.get(2), sampler.subCells);

  for (const outside of [false, null, undefined, -1]) {
    assert.equal(sampler.sample(0, 0, () => outside).mask, 0, `${String(outside)} is outside the shape`);
  }

  // A caller may destructure the methods; binding means `this` never matters.
  const { sample, glyph } = sampler;
  assert.equal(sample(0, 0, () => true).mask, sampler.solidMask);
  assert.equal(glyph(sampler.solidMask, "Q"), "Q");
});

check("a misspelt mosaic mode falls back instead of throwing", () => {
  // The sampler is the path a fence reaches: "octants" threw out of the measure
  // provider, which is outside the plugin's try/catch, so the frame died. A typo
  // must draw the default grid and must not move a mode that was named right.
  const fallback = makeSampler("octants");
  assert.equal(fallback.mosaic, "sextant", "the default is the fallback");
  assert.equal(fallback.minimum, 1);
  assert.equal(fallback.shape.rows, 3);
  assert.equal(fallback.glyph(1), makeSampler().glyph(1), "and it draws the default grid");

  for (const mode of ["quadrant", "sextant", "octant"]) {
    const named = makeSampler(mode);
    assert.equal(named.mosaic, mode, `${mode} keeps its own name`);
    assert.deepEqual(named.shape, modeShape(mode), `${mode} keeps its own shape`);
    for (let mask = 0; mask <= named.solidMask; mask++) {
      assert.equal(named.glyph(mask), glyphFor(mask, mode), `${mode}: mask ${mask} draws its own glyph`);
    }
  }

  assert.equal(makeSampler("OCTANT").mosaic, "sextant", "a name is exact, not case-folded");
  assert.equal(makeSampler(true).mosaic, "sextant", "true is not a mode name");
});

console.log(`\n${checks}/${checks} checks passed`);
