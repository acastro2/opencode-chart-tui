import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { renderChart } from "../src/chart.js";
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

/** Whether a run draws a band: axis, gutter and names are furniture, not data. */
const isBandRun = (run) => (run.kind === "fill" || run.kind === "edge") && run.slice >= 0;

/**
 * The series each painted cell belongs to, by column, in display order top to
 * bottom. A column appears once, with one entry per painted row in that column.
 */
const columnBands = (rows) => {
  const columns = new Map();
  for (const row of rows) {
    let cursor = 0;
    for (const run of row.runs) {
      const length = cols(run.text);
      if (isBandRun(run)) {
        for (let offset = 0; offset < length; offset++) {
          const column = cursor + offset;
          if (!columns.has(column)) columns.set(column, []);
          columns.get(column).push(run.slice);
        }
      }
      cursor += length;
    }
  }
  return columns;
};

const stackedRepro = {
  type: "area",
  width: 40,
  height: 10,
  stacked: true,
  labels: ["A", "B", "C"],
  series: [{ name: "Base", values: [3, 4, 3] }, { name: "Add", values: [2, 1, 2] }],
};

check("every column of a two-series stacked area carries both bands down to zero", () => {
  const rows = renderLineRows(stackedRepro);
  const columns = columnBands(rows);
  assert.ok(columns.size >= 30, `the bands cover the plot (${columns.size} columns)`);
  for (const [column, slices] of columns) {
    const seen = new Set(slices);
    assert.ok(seen.has(0) && seen.has(1), `column ${column} carries ${[...seen].join(",")} only`);
  }

  // The bottom band is pinned to the zero row: its cells leave the axis line no
  // room there, and they are all series 0.
  const zeroRow = rows.findIndex((row) => /^0┤/.test(runsText(row.runs)));
  assert.ok(zeroRow >= 0, "the axis labels the zero row");
  const floor = columnBands([rows[zeroRow]]);
  assert.ok(floor.size >= 30, `band 0 sits on the zero row (${floor.size} cells)`);
  for (const [column, slices] of floor) {
    assert.deepEqual([...new Set(slices)], [0], `the zero row at column ${column} belongs to ${[...new Set(slices)]}`);
  }
});

check("reading a column top to bottom, the stacked series index never goes up", () => {
  const rows = renderLineRows(stackedRepro);
  let checked = 0;
  for (const [column, slices] of columnBands(rows)) {
    if (!slices.includes(0) || !slices.includes(1)) continue;
    checked += 1;
    for (let index = 1; index < slices.length; index++) {
      assert.ok(slices[index] <= slices[index - 1], `column ${column} goes up: ${slices.join(",")}`);
    }
  }
  assert.ok(checked >= 30, `several columns carry both bands (${checked})`);
});

check("a single-series stacked area draws a filled area, not just its name", () => {
  const spec = {
    type: "area",
    width: 40,
    height: 8,
    stacked: true,
    labels: ["A", "B", "C"],
    series: [{ name: "Only", values: [3, 4, 3] }],
  };
  const rows = renderLineRows(spec);
  const columns = columnBands(rows);
  const painted = [...columns.values()].reduce((sum, slices) => sum + slices.length, 0);
  assert.ok(painted >= 60, `the area is filled (${painted} painted cells)`);
  for (const [column, slices] of columns) {
    assert.deepEqual([...new Set(slices)], [0], `column ${column} belongs to ${[...new Set(slices)]}`);
  }
  assert.ok(
    rows.some((row) => row.runs.some((run) => run.kind === "legend" && run.text.includes("Only"))),
    "the series name is still drawn",
  );
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
  assert.ok(rows.some((row) => row.runs.some((run) => run.kind === "fill" && run.slice === 0)), "band 0 is drawn");
  assert.ok(rows.some((row) => row.runs.some((run) => run.kind === "fill" && run.slice === 1)), "band 1 is drawn");
});


check("a line chart with no values says so", () => {
  const rows = textRows(renderLineRows({ type: "line", width: 30, values: [] }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

/** Each row as one string per cell, so a label can be compared cell by cell. */
const cellGrid = (rows) =>
  rows.map((row) => {
    const cells = [];
    for (const run of row.runs) for (const grapheme of run.text) cells.push(grapheme);
    return cells;
  });

check("a 50-value sparkline fits a 16-cell row and keeps its spikes", () => {
  const values = Array.from({ length: 50 }, (_, index) => Math.sin(index / 3) * 10 + 20);
  values[12] = -40;
  values[37] = 80;
  values[49] = -40;
  const spec = { type: "sparkline", width: 16, values };
  const [row] = textRows(renderLineRows(spec));
  assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
  const blocks = cellsOf(row).filter((cell) => "▁▂▃▄▅▆▇█".includes(cell));
  assert.ok(blocks.length > 1 && blocks.length < values.length, `the trace is downsampled to ${blocks.length} blocks`);
  assert.equal(blocks[blocks.length - 1], "▁", "the last block is the last value");
  assert.ok(blocks.includes("█"), "the high spike survives the squeeze");
});

check("an end label never covers a drawn cell", () => {
  // A named line now has its own right gutter, so the label cannot reach the
  // plot by construction; prove the names sit past every data run on their row.
  const named = {
    type: "line",
    width: 40,
    height: 9,
    labels: ["a", "b", "c", "d"],
    series: [
      { name: "one", values: [10, 20, 5, 30] },
      { name: "two", values: [30, 10, 25, 12] },
    ],
  };
  let names = 0;
  for (const row of renderLineRows(named)) {
    let column = 0;
    let dataEnd = 0;
    for (const run of row.runs) {
      if (run.kind === "fill" || run.kind === "edge" || run.kind === "spoke") dataEnd = Math.max(dataEnd, column + cols(run.text));
      column += cols(run.text);
    }
    column = 0;
    for (const run of row.runs) {
      if (run.kind === "legend" && run.slice >= 0) {
        names += 1;
        assert.ok(column >= dataEnd, `the name at ${column} overlaps data that ends at ${dataEnd}`);
        assert.ok(column + cols(run.text) <= named.width, "the name stayed inside the row");
      }
      column += cols(run.text);
    }
  }
  assert.ok(names >= 2, `both names are drawn (${names})`);

  // The scatter keeps the old numeric end label: no name gutter, and its last
  // point sits at column 0, so there is room after it. Geometry is unchanged by
  // the gutter, so the plain render is a fair comparison.
  const spec = { type: "scatter", width: 30, height: 8, series: [{ name: "s", values: [10, 30] }], points: [[0, 30], [0, 40]] };
  const plain = cellGrid(renderLineRows({ ...spec, valueLabels: false }));
  const labelled = cellGrid(renderLineRows(spec));
  let changed = 0;
  for (const [y, row] of labelled.entries()) {
    for (const [x, cell] of row.entries()) {
      // cellsToRuns drops the trailing blank run, so a missing cell is blank.
      const before = plain[y][x] ?? " ";
      if (cell === before) continue;
      changed += 1;
      assert.equal(before, " ", `a label took a drawn cell at ${x},${y}`);
      assert.ok(x < Math.max(16, spec.width), "a label stayed inside the row");
    }
  }
  assert.ok(changed > 0, "the scatter draws its end label");
});

check("the last x label is drawn at 40, 58 and 100 cells", () => {
  for (const width of [40, 58, 100]) {
    for (const type of ["line", "area"]) {
      const rows = textRows(
        renderLineRows({ type, width, height: 8, labels: ["Jan", "Feb", "Mar", "Apr", "May"], values: [10, 30, 25, 50, 45] }),
      );
      const last = rows[rows.length - 1];
      assert.match(last, /May/, `${type} at ${width} shows its last label`);
      assert.ok(cols(last) <= width, `${type} at ${width}: "${last}" is ${cols(last)}`);
    }
  }
});

check("wide labels and dense scatter stay inside the width", () => {
  const wideArea = { type: "area", width: 36, height: 7, labels: ["一月", "三月", "五月"], values: [10, 30, 20] };
  const areaRows = textRows(renderLineRows(wideArea));
  for (const row of areaRows) assert.ok(cols(row) <= wideArea.width, `"${row}" is ${cols(row)} of ${wideArea.width}`);
  assert.match(areaRows[areaRows.length - 1], /五月/, "a wide last label is kept");

  const dense = {
    type: "scatter",
    width: 40,
    height: 8,
    points: Array.from({ length: 30 }, (_, index) => [index, index % 7]),
  };
  const rows = textRows(renderLineRows(dense));
  for (const row of rows) assert.ok(cols(row) <= dense.width, `"${row}" is ${cols(row)} of ${dense.width}`);
  const tokens = rows[rows.length - 1].trim().split(/ +/).map(Number);
  assert.ok(tokens.length > 1 && tokens.length < dense.points.length, `the labels are thinned to ${tokens.length}`);
  for (const [index, token] of tokens.entries()) {
    assert.ok(token >= 0 && token < dense.points.length, `${token} names a point`);
    if (index > 0) assert.ok(token > tokens[index - 1], "the labels stay in order");
  }
});

/** The cells of a row that carry data: a block, not axis furniture and not text. */
const isMark = (cell) => Boolean(cell) && cell !== " " && !"[│┤┼─]".includes(cell) && !/[0-9a-zA-Z]/.test(cell);

/** The left gutter width, read from the axis mark at the end of it. */
const gutterOf = (row) => cols(row) - cols(row.replace(/^[^│┤]+[│┤]/, ""));

check("a named line puts its name at the right end at 24, 56 and 100 cells", () => {
  for (const width of [24, 56, 100]) {
    const spec = {
      type: "line",
      width,
      height: 9,
      labels: ["Jan", "Feb", "Mar", "Apr", "May"],
      series: [{ name: "Revenue", values: [10, 30, 50, 70, 90] }],
    };
    const rows = renderLineRows(spec);
    const texts = rows.map((row) => runsText(row.runs));
    for (const row of texts) assert.ok(cols(row) <= width, `"${row}" is ${cols(row)} of ${width}`);

    const gutter = Math.min("Revenue".length + 1, Math.floor(width * 0.3));
    const nameRow = rows.findIndex((row) =>
      row.runs.some((run) => run.kind === "legend" && run.text.includes("Revenue")),
    );
    assert.ok(nameRow >= 0, `width ${width}: the series name is drawn`);

    const line = [...texts[nameRow]];
    const at = line.indexOf("R");
    assert.equal(line.slice(at, at + "Revenue".length).join(""), "Revenue", `width ${width}: the whole name is drawn`);
    assert.ok(at >= width - gutter, `width ${width}: the name starts in the right gutter (${at} of ${width - gutter})`);
    assert.ok(at + "Revenue".length <= width, `width ${width}: the name ends inside the chart`);

    // The label is drawn beside the last point, and the last point still has
    // its mark in the last plot column. The plot ends where the gutter begins.
    const plotEnd = width - gutter;
    assert.ok(plotEnd - 1 >= gutterOf(texts[0]), "the plot keeps room for the data");
    assert.ok(isMark(line[plotEnd - 1]), `width ${width}: the last value is still drawn at ${plotEnd - 1} ("${line[plotEnd - 1]}")`);
  }
});

check("named series stack their end labels instead of overwriting", () => {
  const spec = {
    type: "line",
    width: 48,
    height: 9,
    labels: ["a", "b", "c", "d"],
    series: [
      { name: "Base", values: [10, 20, 15, 30] },
      { name: "Add", values: [12, 18, 16, 28] },
    ],
  };
  const rows = renderLineRows(spec);
  for (const row of rows) assert.ok(cols(runsText(row.runs)) <= spec.width, `"${runsText(row.runs)}" overflows`);

  const labels = [];
  for (const [y, row] of rows.entries()) {
    for (const run of row.runs) if (run.kind === "legend" && run.slice >= 0) labels.push({ y, text: run.text, at: null });
  }
  assert.equal(labels.length, 2, `both names are drawn (${labels.map((label) => label.text).join(",")})`);
  assert.notEqual(labels[0].y, labels[1].y, "the names do not share a row");
  for (const [index, row] of rows.entries()) {
    let column = 0;
    let dataEnd = 0;
    for (const run of row.runs) {
      if (run.kind === "fill" || run.kind === "edge" || run.kind === "spoke") dataEnd = Math.max(dataEnd, column + cols(run.text));
      column += cols(run.text);
    }
    column = 0;
    for (const run of row.runs) {
      if (run.kind === "legend" && run.slice >= 0) assert.ok(column >= dataEnd, `row ${index}: the name starts at ${column}, the data ends at ${dataEnd}`);
      column += cols(run.text);
    }
  }
});

check("a stacked area names each band at its own top, not on a band below", () => {
  const spec = {
    type: "area",
    stacked: true,
    width: 40,
    height: 9,
    labels: ["Jan", "Feb"],
    series: [
      { name: "Base", values: [40, 40] },
      { name: "Add", values: [5, 5] },
    ],
  };
  const rows = renderLineRows(spec);
  for (const row of rows) assert.ok(cols(runsText(row.runs)) <= spec.width, `"${runsText(row.runs)}" overflows`);

  const found = new Map();
  for (const [y, row] of rows.entries()) {
    for (const run of row.runs) if (run.kind === "legend" && run.slice >= 0) found.set(run.text, y);
  }
  assert.ok(found.has("Base") && found.has("Add"), `both names are drawn (${[...found.keys()].join(",")})`);
  // Add ends on top of Base: its label must sit above, not down at its own raw
  // value, which is inside the Base band.
  assert.ok(found.get("Add") < found.get("Base"), `Add is at row ${found.get("Add")}, Base at ${found.get("Base")}`);
});

check("an unnamed series gets no invented end label", () => {
  for (const row of textRows(renderLineRows(rising))) assert.ok(!row.includes("value"), `"${row}" invents a name`);
});

/** The number of cells in a set of rows that carry a block, not axis furniture or text. */
const marksIn = (rows) => rows.reduce((sum, row) => sum + cellsOf(row).filter((cell) => isMark(cell)).length, 0);

/** The rightmost column any row draws a mark in, or -1. */
const lastDataColumn = (rows) => {
  let last = -1;
  for (const row of rows) {
    const cells = cellsOf(row);
    for (let x = 0; x < cells.length; x++) if (isMark(cells[x])) last = Math.max(last, x);
  }
  return last;
};

check("a two-series sparkline names each row and keeps both traces", () => {
  const spec = {
    type: "sparkline",
    width: 40,
    series: [{ name: "Base", values: [20, 30, 25, 40] }, { name: "Add-on", values: [10, 15, 30, 20] }],
  };
  const rows = textRows(renderLineRows(spec));
  assert.equal(rows.length, 4, `two traces and their legend (${rows.length} rows)`);
  assert.ok(rows[0].startsWith("Base "), `the first row names its series: "${rows[0]}"`);
  // The name gives way to the trace: five cells and a gap, never more.
  assert.ok(rows[1].startsWith("Add-… "), `the second name is cut to five cells: "${rows[1]}"`);
  for (const row of rows.slice(0, 2)) {
    assert.match(row, /[▁▂▃▄▅▆▇█]/, "the trace is drawn");
    assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
  }
  assert.ok(rows[0].includes("40"), "the last value is printed after the trace");
});

check("a sparkline that asks for zero starts its blocks at the floor", () => {
  const values = [5, 10, 7];
  const firstBlock = (row) => cellsOf(row).find((cell) => "▁▂▃▄▅▆▇█".includes(cell));
  const without = firstBlock(textRows(renderLineRows({ type: "sparkline", width: 32, values }))[0]);
  const withZero = firstBlock(textRows(renderLineRows({ type: "sparkline", width: 32, values, zero: true }))[0]);
  assert.equal(without, "▁", "the smallest value is the floor when zero is not asked for");
  assert.notEqual(withZero, "▁", `asking for zero lifts the floor off the smallest block (${withZero})`);
});

check("a big scatter marks more than a small one and stays inside the width", () => {
  const points = [[0, 0], [10, 100]];
  const small = textRows(renderLineRows({ type: "scatter", width: 40, height: 8, points }));
  const big = textRows(renderLineRows({ type: "scatter", width: 40, height: 8, points, big: true }));
  assert.ok(marksIn(small) >= 2, `both points are marked (${marksIn(small)})`);
  assert.ok(marksIn(big) >= marksIn(small), `big never marks less (${marksIn(big)} vs ${marksIn(small)})`);
  for (const row of [...small, ...big]) assert.ok(cols(row) <= 40, `"${row}" overflows`);
});

check("a scatter that turns zero off keeps its floor on the data", () => {
  const rows = textRows(
    renderLineRows({ type: "scatter", width: 40, height: 8, zero: false, points: [[0, 10], [1, 40]] }),
  );
  assert.ok(!rows.some((row) => /(^|\s)0┤/.test(row)), "no row is labelled zero");
  assert.ok(marksIn(rows) >= 2, `both points are drawn (${marksIn(rows)})`);
});

check("a scatter with values but no points puts one point per value", () => {
  const spec = { type: "scatter", width: 40, height: 8, values: [10, 30, 20] };
  const rows = textRows(renderLineRows(spec));
  assert.ok(marksIn(rows) >= 3, `every value is a point (${marksIn(rows)})`);
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
});

check("a top-level name earns the right gutter too", () => {
  const spec = {
    type: "line",
    width: 40,
    height: 9,
    labels: ["a", "b", "c", "d", "e"],
    name: "Total",
    values: [10, 30, 50, 70, 90],
  };
  const texts = renderLineRows(spec).map((row) => runsText(row.runs));
  for (const row of texts) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
  const line = [...(texts.find((text) => text.includes("Total")) ?? "")];
  const at = line.indexOf("T");
  assert.ok(at >= 0, "the name is drawn");
  assert.equal(at, spec.width - "Total".length, "the name is flush with the chart's right edge");
  const gutter = Math.min("Total".length + 1, Math.floor(spec.width * 0.3));
  assert.ok(at >= spec.width - gutter, `it sits in the reserved gutter (${at} of ${spec.width - gutter})`);
});

check("nobody named a series, so no gutter is reserved", () => {
  const specs = [
    { type: "line", width: 40, height: 9, labels: ["a", "b", "c", "d"], name: "   ", values: [1, 2, 3, 4] },
    { type: "line", width: 40, height: 9, labels: ["a", "b", "c"], series: [[1, 2, 3], [4, 5, 6]] },
  ];
  for (const spec of specs) {
    const rows = renderLineRows(spec);
    for (const row of rows) {
      assert.ok(cols(runsText(row.runs)) <= spec.width, `"${runsText(row.runs)}" overflows`);
      assert.ok(
        !row.runs.some((run) => run.kind === "legend" && run.slice >= 0),
        "a blank or array series reserves no name gutter",
      );
    }
    assert.equal(rows.length, spec.height, "the chart takes the height it was given");
  }
});

check("a name with no free row is dropped and counted, never overwritten", () => {
  const build = (count) => ({
    type: "line",
    width: 40,
    height: 10,
    labels: ["a", "b"],
    series: Array.from({ length: count }, (_, index) => ({ name: `s${index}`, values: [index + 1, index + 1] })),
  });
  // The dropped-name note is a row of the block, so it takes one plot row: five
  // names fit four rows when there is no note to pay for and three when there
  // is, and one more name loses its row. `hidden` is whatever the note says; the
  // invariant is that every name is either drawn or counted.
  for (const [count, expected] of [[5, 2], [6, 3]]) {
    const rows = renderLineRows(build(count));
    const texts = rows.map((row) => runsText(row.runs));
    for (const row of texts) assert.ok(cols(row) <= 40, `"${row}" overflows`);
    const drawn = rows.filter((row) => row.runs.some((run) => run.kind === "legend" && run.slice >= 0)).length;
    const note = texts.find((text) => text.includes("dropped"));
    assert.ok(note, `count ${count}: a dropped name is reported`);
    const hidden = Number(note.match(/(\d+) end label/)[1]);
    assert.equal(hidden, expected, `count ${count}: ${expected} names have no row left`);
    assert.equal(drawn + hidden, count, `every name is either drawn or counted (${drawn} + ${hidden})`);
    assert.equal(note, `  ${hidden} end label${hidden === 1 ? "" : "s"} dropped: no room`);
  }
});

check("a name that collides moves down a row before it moves up", () => {
  const spec = {
    type: "line",
    width: 48,
    height: 9,
    labels: ["a", "b"],
    series: [{ name: "A", values: [1, 10] }, { name: "B", values: [5, 10] }],
  };
  const at = [];
  for (const [y, row] of renderLineRows(spec).entries()) {
    for (const run of row.runs) if (run.kind === "legend" && run.slice >= 0) at.push({ y, text: run.text });
  }
  assert.equal(at.length, 2, `both names are drawn (${at.map((label) => label.text).join(",")})`);
  assert.deepEqual(at.map((label) => label.y), [0, 1], "the second name takes the row below");
});

check("a name at the bottom moves up when the row below is taken", () => {
  const spec = {
    type: "line",
    width: 48,
    height: 9,
    labels: ["a", "b"],
    series: [{ name: "A", values: [9, 7, 0] }, { name: "B", values: [8, 6, 0] }],
  };
  const rows = renderLineRows(spec);
  const at = [];
  for (const [y, row] of rows.entries()) {
    for (const run of row.runs) if (run.kind === "legend" && run.slice >= 0) at.push({ y, text: run.text });
  }
  assert.equal(at.length, 2, `both names are drawn (${at.map((label) => label.text).join(",")})`);
  const rowOfName = new Map(at.map((label) => [label.text, label.y]));
  // B wants the same bottom row as A, finds it taken, and moves up.
  assert.ok(rowOfName.get("B") < rowOfName.get("A"), `B went up (${rowOfName.get("B")} above ${rowOfName.get("A")})`);
});

check("valueLabels:false gives the plot the gutter back", () => {
  const named = {
    type: "line",
    width: 40,
    height: 9,
    labels: ["Jan", "Feb", "Mar", "Apr", "May"],
    series: [{ name: "Revenue", values: [10, 30, 50, 70, 90] }],
  };
  const gutter = Math.min("Revenue".length + 1, Math.floor(named.width * 0.3));
  const withGutter = lastDataColumn(textRows(renderLineRows(named)));
  const withoutGutter = lastDataColumn(textRows(renderLineRows({ ...named, valueLabels: false })));
  assert.ok(
    withoutGutter > withGutter,
    `the plot ends later without the name gutter (${withoutGutter} > ${withGutter})`,
  );
  assert.ok(withoutGutter >= named.width - gutter, "the data reaches the space the names had taken");
  assert.ok(
    !renderLineRows({ ...named, valueLabels: false }).some((row) =>
      row.runs.some((run) => run.kind === "legend" && run.slice >= 0),
    ),
    "no end-label gutter is reserved",
  );
});

check("a title is a row of its own and the frame still fits", () => {
  const spec = { type: "line", width: 40, height: 9, title: "Sales", labels: ["a", "b", "c", "d"], values: [10, 30, 25, 40] };
  const rows = renderLineRows(spec);
  assert.equal(runsText(rows[0].runs), "Sales", "the title carries the fence's text");
  assert.ok(rows[0].runs.every((run) => run.kind === "title"), "the title has its own kind");
  for (const row of rows) assert.ok(cols(runsText(row.runs)) <= spec.width, `"${runsText(row.runs)}" overflows`);
  assert.equal(rows.length, spec.height, "the title is part of the height, not extra");
});

check("a 100% chart with an empty column writes zero, not NaN", () => {
  const spec = {
    type: "line",
    width: 40,
    height: 9,
    normalized: true,
    labels: ["a", "b"],
    series: [{ name: "x", values: [3, 0] }, { name: "y", values: [0, 0] }],
  };
  const text = renderLineRows(spec)
    .map((row) => runsText(row.runs))
    .join("\n");
  assert.ok(!text.includes("NaN"), "no NaN reaches the chart");
  assert.match(text, /100/, "a column with a total is a whole");
});

check("legend:false spends its rows on the plot instead", () => {
  const base = {
    type: "line",
    width: 48,
    height: 12,
    labels: ["a", "b", "c"],
    series: [{ name: "one", values: [1, 2, 3] }, { name: "two", values: [3, 2, 1] }],
  };
  const withLegend = renderLineRows(base);
  const without = renderLineRows({ ...base, legend: false });
  assert.ok(
    withLegend.some((row) => row.runs.some((run) => run.kind === "legend-mark")),
    "the legend is drawn by default",
  );
  assert.ok(
    !without.some((row) => row.runs.some((run) => run.kind === "legend-mark")),
    "legend:false draws no legend",
  );
  assert.equal(withLegend.length, base.height, "the chart keeps the height it was given");
  assert.equal(without.length, base.height, "the plot takes the legend's rows");
});

check("a series with no name loses only its end label", () => {
  const spec = {
    type: "line",
    width: 40,
    height: 9,
    labels: ["a", "b"],
    series: [{ name: "", values: [1, 2] }, { name: "b", values: [2, 1] }],
  };
  const rows = renderLineRows(spec);
  const notes = rows.map((row) => runsText(row.runs)).filter((text) => text.includes("dropped"));
  assert.equal(notes.length, 1, `the unnamed series is counted (${notes.join("|")})`);
  assert.match(notes[0], /1 end label dropped/, "one name had nothing to draw");
  const named = rows.filter((row) => row.runs.some((run) => run.kind === "legend" && run.slice === 1));
  assert.equal(named.length, 1, "the series that has a name keeps its label");
});

check("a scatter draws no end label for a series with no mark", () => {
  const spec = {
    type: "scatter",
    width: 40,
    height: 8,
    series: [{ name: "a", values: [1, 2] }, { name: "b", values: [3, 4] }],
    points: [[0, 10], [1, 20]],
  };
  const rows = renderLineRows(spec);
  for (const row of rows) assert.ok(cols(runsText(row.runs)) <= spec.width, `"${runsText(row.runs)}" overflows`);
  // Every point belongs to series 0, so series 1 owns no cell to put a label beside.
  assert.ok(
    !rows.some((row) => row.runs.some((run) => run.kind === "fill" && run.slice === 1 && /\d/.test(run.text))),
    "no end label is invented for a series with no mark",
  );
});

check("a point that cannot be drawn is counted, not dropped in silence", () => {
  // Schema says points are [x, y] number pairs. An object used to vanish into
  // "no data", and ["Jan", 5] became x=0 through `Number(...) || 0`.
  const objects = textRows(renderLineRows({ type: "scatter", width: 40, height: 8, points: [{ x: 1, y: 2 }] }));
  assert.ok(objects.some((row) => /1 point skipped/.test(row)), `an object point is not reported:\n${objects.join("\n")}`);

  const labelled = textRows(renderLineRows({ type: "scatter", width: 40, height: 8, points: [["Jan", 5], [2, 4]] }));
  assert.ok(labelled.some((row) => /1 point skipped/.test(row)), `a labelled pair is not reported:\n${labelled.join("\n")}`);
  const marked = labelled.some((row) =>
    [...row].some((char) => /[\u2580-\u259f\u{1FB00}-\u{1FBFF}\u{1CC00}-\u{1CEBF}]/u.test(char)),
  );
  assert.ok(marked, "the valid point is still drawn");
});

check("an end-label note is paid for out of the height", () => {
  // The unnamed series loses its end label, and the note says so. The plot used
  // to be budgeted for the whole height and the note appended after it, so the
  // block was one row over and the guard hid a row. The note is a row of the
  // block now: the plot is one row shorter and the note is the last row.
  const spec = {
    type: "line",
    width: 40,
    height: 10,
    labels: ["a", "b"],
    legend: false,
    series: [{ name: "", values: [1, 2] }, { name: "b", values: [2, 1] }],
  };
  const rows = renderChart(spec).split("\n");
  assert.equal(rows.length, 10, `the block is ${rows.length} rows, not the height`);
  assert.equal(rows.at(-1), "  1 end label dropped: no room");
  assert.doesNotMatch(rows.join("\n"), /rows? hidden/);
});

console.log(`\n${checks}/${checks} checks passed`);
