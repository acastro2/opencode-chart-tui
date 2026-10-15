import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { renderLineRows } from "../src/line.js";
import { glyphFor, modeShape } from "../src/mosaic.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];

const allGlyphs = new Set();
for (const mode of ["quadrant", "sextant", "octant"]) {
  const shape = modeShape(mode);
  for (let mask = 1; mask < 2 ** (shape.columns * shape.rows); mask++) allGlyphs.add(glyphFor(mask, mode));
  allGlyphs.add("█");
}

const rising = { type: "line", width: 40, height: 9, labels: ["a", "b", "c", "d", "e"], values: [10, 30, 50, 70, 90] };
const area = { ...rising, type: "area" };
const wavy = { type: "line", width: 44, height: 10, labels: ["1", "2", "3", "4", "5", "6"], values: [50, 80, 30, 60, 90, 40] };
const spark = { type: "sparkline", width: 40, values: [1, 3, 2, 8, 5, 5, 9, 2] };
const scatter = { type: "scatter", width: 40, height: 8, points: [[0, 10], [1, 40], [2, 20], [3, 70], [4, 50]] };

/** The topmost plot row that holds a drawn cell in a column, or -1. */
const topRowOf = (rows, column) =>
  rows.findIndex((row) => {
    const cell = cellsOf(row)[column];
    return cell && cell !== " " && !"[│┤┼─".includes(cell);
  });

check("no line chart row is wider than the chart", () => {
  for (const spec of [rising, area, wavy, spark, scatter]) {
    for (const row of textRows(renderLineRows(spec))) {
      assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
    }
  }
});

check("a rising line is drawn rising", () => {
  const rows = textRows(renderLineRows(rising));
  // The plot starts after the gutter, and the first data column is the first
  // cell after it.
  const gutter = cols(rows[0]) - cols(rows[0].replace(/^[^│┤]+[│┤]/, ""));
  const tops = [];
  for (let x = gutter; x < gutter + 30; x += 6) {
    const row = topRowOf(rows, x);
    if (row >= 0) tops.push(row);
  }
  assert.ok(tops.length >= 4, `found ${tops.length} drawn columns`);
  for (let index = 1; index < tops.length; index++) {
    assert.ok(tops[index] <= tops[index - 1], `row ${tops[index]} should not sit below ${tops[index - 1]}`);
  }
  assert.ok(tops[tops.length - 1] < tops[0], "the end of the line is higher than the start");
});

check("the line is drawn at sub-cell resolution", () => {
  const rows = textRows(renderLineRows(wavy));
  const drawn = new Set();
  for (const row of rows) {
    for (const cell of cellsOf(row)) {
      if (cell === " " || /[0-9a-zA-Z│┤┼─.]/.test(cell)) continue;
      drawn.add(cell);
    }
  }
  assert.ok(drawn.size >= 3, `expected several distinct patterns, saw ${drawn.size}`);
  for (const glyph of drawn) assert.ok(allGlyphs.has(glyph), `"${glyph}" is not a block pattern`);
});

check("an area chart fills from the line down to one common floor", () => {
  // The last row is the category labels, so the plot is everything above it.
  const rows = textRows(renderLineRows(area)).slice(0, -1);
  const filledRows = (x) => rows.map((row, y) => ({ y, cell: cellsOf(row)[x] })).filter(({ cell }) => cell && cell !== " " && cell !== "│" && cell !== "┤" && cell !== "─").map(({ y }) => y);
  let floor = -1;
  for (let x = 8; x < 30; x++) {
    const drawn = filledRows(x);
    if (drawn.length === 0) continue;
    const bottom = Math.max(...drawn);
    if (floor < 0) floor = bottom;
    assert.equal(bottom, floor, `column ${x} stops at row ${bottom}, the floor is ${floor}`);
    // Every row between the top of the fill and the floor is filled.
    for (let y = Math.min(...drawn); y <= bottom; y++) {
      const cell = cellsOf(rows[y])[x];
      assert.ok(cell && cell !== " " && cell !== "│" && cell !== "┤", `column ${x} row ${y} is a gap in the fill`);
    }
  }
});

check("a sparkline has one block per value", () => {
  const [row] = textRows(renderLineRows(spark));
  const blocks = cellsOf(row).filter((cell) => "▁▂▃▄▅▆▇█".includes(cell));
  assert.equal(blocks.length, spark.values.length);
  assert.equal(blocks[blocks.length - 1], "▂", "the last block follows the last value");
  assert.ok(blocks.includes("█"), "the largest value reaches the top block");
});

check("a scatter marks its points and nothing else", () => {
  const rows = textRows(renderLineRows(scatter));
  let marked = 0;
  for (const row of rows) {
    for (const cell of cellsOf(row)) {
      if (cell === " " || /[0-9a-zA-Z│┤┼─.]/.test(cell)) continue;
      marked += 1;
    }
  }
  // Five points, at most one cell each, plus the marker spilling into a
  // neighbouring cell, and points may share a cell when they are close.
  assert.ok(marked >= 5, `every point is visible, marked ${marked}`);
  assert.ok(marked <= 7, `points stay compact, marked ${marked} cells for 5 points`);
});

check("x labels stay under the data and never collide", () => {
  const rows = textRows(renderLineRows(wavy));
  const last = rows[rows.length - 1];
  assert.match(last, /1/);
  for (let index = 1; index < last.length - 1; index++) {
    if (last[index] === " " || last[index - 1] === " ") continue;
    assert.ok(!/^\d$/.test(last[index]) || !/^\d$/.test(last[index - 1]), `labels touch at ${index}`);
  }
  assert.ok(cols(last) <= wavy.width);
});

check("a stacked area puts the series in order from the floor up", () => {
  const spec = {
    type: "area",
    width: 46,
    height: 9,
    stacked: true,
    labels: ["Q1", "Q2", "Q3", "Q4"],
    series: [{ name: "Base", values: [20, 30, 25, 40] }, { name: "Add-on", values: [10, 15, 30, 20] }],
  };
  const rows = renderLineRows(spec);
  const plot = rows.filter((row) => row.runs.some((run) => run.kind === "fill"));
  assert.ok(plot.length > 3, `the bands are drawn (${plot.length} rows)`);

  // Read one column from the floor up: series 0 may be followed by series 1,
  // never the other way round.
  let checked = 0;
  for (let x = 6; x < 40; x++) {
    const slices = [];
    for (const row of plot) {
      let cursor = 0;
      for (const run of row.runs) {
        const length = cols(run.text);
        if (run.kind === "fill" && run.slice >= 0 && x >= cursor && x < cursor + length) slices.push(run.slice);
        cursor += length;
      }
    }
    if (slices.length < 2) continue;
    checked += 1;
    for (let index = 1; index < slices.length; index++) {
      assert.ok(slices[index] >= slices[index - 1], `column ${x} is out of order: ${slices.join(",")}`);
    }
  }
  assert.ok(checked >= 5, `several columns carry both bands (${checked})`);
});

check("a 100% stacked area sums to its own axis", () => {
  const spec = {
    type: "area",
    width: 44,
    height: 8,
    stacked: true,
    normalized: true,
    labels: ["a", "b", "c"],
    series: [{ name: "x", values: [3, 1, 2] }, { name: "y", values: [1, 3, 2] }],
  };
  const rows = renderLineRows(spec);
  const text = rows.map((row) => runsText(row.runs)).join("\n");
  assert.match(text, /100/, "the axis reaches 100");
  assert.ok(rows.some((row) => row.runs.some((run) => run.kind === "fill" && run.slice === 1)), "both bands are drawn");
});


check("a line chart with no values says so", () => {
  const rows = textRows(renderLineRows({ type: "line", width: 30, values: [] }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

console.log(`\n${checks}/${checks} checks passed`);
