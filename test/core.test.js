import assert from "node:assert/strict";
import {
  cols,
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
  tallyFromGrid,
  truncate,
} from "../src/core.js";
import { buildAxis, categoryRow, niceMax } from "../src/axis.js";

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

console.log(`\n${checks}/${checks} checks passed`);
