import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { buildAxis } from "../src/axis.js";
import { renderComboRows } from "../src/combo.js";
import { THEMES, styleOf } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));

/** Every cell one line series paints, with its row and column. */
const lineCells = (grid, slice) =>
  grid.flatMap((line, row) =>
    line.flatMap((cell, column) =>
      cell?.kind === "fill" && cell.slice === slice ? [{ ...cell, row, column }] : [],
    ),
  );

/** One entry per printed cell, with the run's kind and series. */
const gridOf = (rows) =>
  rows.map((row) => {
    const cells = [];
    for (const run of row.runs) {
      for (const char of [...run.text]) cells.push({ char, kind: run.kind, slice: run.slice });
    }
    return cells;
  });

const cellsOf = (rows) => gridOf(rows).flat();

const barAndLine = {
  type: "combo",
  width: 48,
  plotHeight: 9,
  legend: false,
  labels: ["A", "B", "C"],
  series: [
    { name: "Volume", type: "bar", values: [10, 20, 10] },
    { name: "Trend", type: "line", values: [30, 10, 30] },
  ],
};

/** The top row of one series' bar cells, or -1 when it draws none. */
const barTop = (grid, slice) =>
  grid.findIndex((line) => line.some((cell) => cell.kind === "fill" && cell.slice === slice));

/** Every column a marker stands on, in reading order. */
const pointColumns = (grid) =>
  grid.flatMap((line) => line.map((cell, column) => (cell.char === "●" ? column : -1)).filter((column) => column >= 0));

/** Every column one bar series draws in, left to right. */
const barColumns = (grid, slice) => [
  ...new Set(
    grid.flatMap((line) =>
      line.map((cell, column) => (cell.kind === "fill" && cell.slice === slice ? column : -1)).filter((column) => column >= 0),
    ),
  ),
].sort((a, b) => a - b);

check("a bar at twice the value draws a taller column", () => {
  const spec = {
    type: "combo",
    width: 40,
    plotHeight: 9,
    legend: false,
    labels: ["Q1"],
    series: [
      { name: "Target", type: "bar", values: [80] },
      { name: "Half", type: "bar", values: [40] },
      { name: "Trend", type: "line", values: [60] },
    ],
  };
  const grid = gridOf(renderComboRows(spec));
  const tall = barTop(grid, 0);
  const short = barTop(grid, 1);
  assert.ok(tall >= 0 && short >= 0, `both bars are drawn (${tall}, ${short})`);
  assert.ok(tall < short, `80 starts above 40 (row ${tall} vs ${short})`);
});

check("a line point sits on its value's row, and the line runs from it", () => {
  const rows = renderComboRows(barAndLine);
  const grid = gridOf(rows);
  const axis = buildAxis({ min: 0, max: 30, plotRows: 9 });
  // One bar column per label, and the line's point shares it. Read the group
  // columns off the bars themselves rather than assuming a spacing.
  const columns = [
    ...new Set(
      grid.flatMap((line) =>
        line
          .map((cell, column) => (cell.kind === "fill" && cell.slice === 0 ? column : -1))
          .filter((column) => column >= 0),
      ),
    ),
  ].sort((a, b) => a - b);
  const groups = [];
  for (const column of columns) {
    const last = groups.at(-1);
    if (last && column - last.end === 1) last.end = column;
    else groups.push({ start: column, end: column });
  }
  assert.equal(groups.length, 3, `one group per label (${groups.length})`);
  const values = [30, 10, 30];
  for (const [index, value] of values.entries()) {
    const row = axis.rowOf(value);
    const group = groups[index];
    const cell = grid[row]?.slice(group.start, group.end + 1).find((item) => item?.char === "●");
    assert.ok(cell, `point ${index} is missing on row ${row}`);
    assert.equal(cell.kind, "series", `point ${index} carries the line's series`);
    assert.equal(cell.slice, 1, "the point carries the line's series");
  }
  // The line is drawn at sub-cell resolution: it falls to the middle point and
  // rises back, so its own cells reach both value rows.
  const line = lineCells(grid, 1);
  const lineRows = new Set(line.map((cell) => cell.row));
  assert.ok(line.length > 0, "the line is drawn between the points");
  assert.ok(lineRows.has(axis.rowOf(30)), `the line starts at 30: ${[...lineRows]}`);
  // The low point sits behind the bar, so its marker is the only cell on that
  // row; the drawn line is allowed to stop one row above it.
  assert.ok(Math.max(...lineRows) >= axis.rowOf(10) - 1, `the line falls toward 10: ${[...lineRows]}`);
  assert.ok(!line.some((cell) => "─╱╲".includes(cell.char)), "the line is not the old one-cell staircase");
});

check("a bar's top cell is the row its value maps to", () => {
  const spec = {
    type: "combo",
    width: 40,
    plotHeight: 10,
    legend: false,
    labels: ["A", "B", "C"],
    series: [
      { name: "Bars", type: "bar", values: [42, 30, 18] },
      { name: "Line", type: "line", values: [50, 45, 10] },
    ],
  };
  const grid = gridOf(renderComboRows(spec));
  const axis = buildAxis({ min: 0, max: 50, plotRows: 10 });
  const isBar = (cell) => cell?.kind === "fill" && "█▀▄▌▐▁▂▃▄▅▆▇".includes(cell.char);
  const columns = [
    ...new Set(
      grid.flatMap((line) =>
        line.map((cell, column) => (isBar(cell) ? column : -1)).filter((column) => column >= 0),
      ),
    ),
  ].sort((a, b) => a - b);
  const groups = [];
  for (const column of columns) {
    const last = groups.at(-1);
    if (last && column - last.end === 1) last.end = column;
    else groups.push({ start: column, end: column });
  }
  assert.equal(groups.length, 3, `one bar per label (${groups.length})`);
  for (const [index, value] of [42, 30, 18].entries()) {
    const group = groups[index];
    const top = grid.findIndex((line) => line.slice(group.start, group.end + 1).some(isBar));
    assert.equal(top, axis.rowOf(value), `bar ${index} tops on row ${axis.rowOf(value)} (drawn ${top})`);
    const above = grid[axis.rowOf(value) - 1]?.slice(group.start, group.end + 1).some(isBar);
    assert.ok(!above, `bar ${index} starts no higher than its value`);
  }
});

check("bars and the line share one frame", () => {
  const cells = cellsOf(renderComboRows(barAndLine));
  assert.ok(cells.some((cell) => cell.kind === "fill"), "a bar is drawn");
  assert.ok(lineCells(gridOf(renderComboRows(barAndLine)), 1).length > 0, "the line is drawn");
});

check("one ● stands on every data column, for every line series", () => {
  const one = {
    type: "combo",
    width: 48,
    legend: false,
    labels: ["A", "B", "C"],
    series: [
      { name: "Volume", type: "bar", values: [10, 20, 10] },
      { name: "Trend", type: "line", values: [30, 10, 30] },
    ],
  };
  const grid = gridOf(renderComboRows(one));
  const points = grid.flat().filter((cell) => cell.char === "●");
  assert.equal(points.length, 3, "one marker for each of the three data columns");
  assert.ok(points.every((cell) => cell.kind === "series"), "the marker is a series mark, not a line cell");
  assert.ok(points.every((cell) => cell.slice === 1), "the marker carries the line's series, not the bar's");
  assert.ok(
    points.every((cell) => styleOf(cell, THEMES.dark.palette, THEMES.dark).fg === THEMES.dark.palette[1]),
    "the marker glyph is the line's series colour",
  );
  // A bar is three cells wide, so the marker sits on the middle cell of the
  // group: every marker column belongs to one bar group, and every group has one.
  const bar = barColumns(grid, 0);
  const groups = [];
  for (const column of bar) {
    const last = groups.at(-1);
    if (last && column - last.end === 1) last.end = column;
    else groups.push({ start: column, end: column });
  }
  assert.equal(groups.length, 3, "three bar groups, one per label");
  assert.deepEqual(
    [...new Set(pointColumns(grid))].sort((a, b) => a - b),
    groups.map((group) => Math.floor((group.start + group.end) / 2)),
    "a marker on the middle cell of every bar group",
  );

  // A second line series gets its own marker on every column too, and keeps its
  // own series colour: the values are far apart so the two never share a cell.
  const two = { ...one, series: [...one.series, { name: "Stretch", type: "line", values: [20, 25, 15] }] };
  const both = cellsOf(renderComboRows(two)).filter((cell) => cell.char === "●");
  assert.equal(both.length, 6, "two line series means two markers per column");
  assert.equal(both.filter((cell) => cell.slice === 1).length, 3, "the first line keeps its three");
  assert.equal(both.filter((cell) => cell.slice === 2).length, 3, "the second line keeps its three");
});

check("the line is unbroken between the markers, and moves in both directions", () => {
  const grid = gridOf(renderComboRows(barAndLine));
  const line = lineCells(grid, 1);
  assert.ok(line.length > 0, "a line is drawn");
  assert.ok(line.every((cell) => cell.slice === 1), "every line cell carries the line's series");

  const columns = [...new Set(pointColumns(grid))].sort((a, b) => a - b);
  assert.equal(columns.length, 3);
  for (let index = 1; index < columns.length; index++) {
    assert.ok(columns[index] - columns[index - 1] > 1, `columns ${columns.join(",")} leave a gap between markers`);
  }

  // Every column in the gaps between bar groups carries a line cell: the
  // sub-cell path has no hole, which was the whole point of leaving the
  // one-cell staircase behind. Inside a group the line is behind the bar, so
  // only its centre marker is visible.
  const drawn = new Set(line.map((cell) => cell.column));
  const bars = [...new Set(barColumns(grid, 0))].sort((a, b) => a - b);
  const groups = [];
  for (const column of bars) {
    const last = groups.at(-1);
    if (last && column - last.end === 1) last.end = column;
    else groups.push({ start: column, end: column });
  }
  for (let index = 1; index < groups.length; index++) {
    for (let column = groups[index - 1].end + 1; column < groups[index].start; column++) {
      assert.ok(drawn.has(column), `column ${column} in the gap is on the line`);
    }
  }

  // 30 -> 10 -> 30: the line reaches a row below the start and back above it.
  const rows = line.map((cell) => cell.row);
  assert.ok(Math.max(...rows) > Math.min(...rows), "the line changes row");
});

check("a marker on a bar's top cell keeps the point, and only that cell", () => {
  const series = (line) => [
    { name: "Volume", type: "bar", values: [50] },
    { name: "Trend", type: "line", values: [line] },
  ];
  const spec = { type: "combo", width: 40, legend: false, labels: ["Q1"] };
  const withPoint = gridOf(renderComboRows({ ...spec, series: series(50) }));
  const withoutPoint = gridOf(renderComboRows({ ...spec, series: series(10) }));
  const drawn = barColumns(withPoint, 0);
  // The group's middle cell: a bar is three cells wide and the point sits there.
  const column = Math.floor((drawn[0] + drawn.at(-1)) / 2);
  // The bar's own top cell: a partial block on the row its value maps to.
  const top = buildAxis({ min: 0, max: 50, plotRows: 9 }).rowOf(50);

  assert.equal(withPoint[top][column].char, "●", "the point owns the bar's top cell");
  assert.equal(withPoint[top][column].kind, "series", "the marker is not counted as bar");
  assert.equal(withoutPoint[top][column].kind, "fill", "the same cell is the bar's top when no point lands there");
  assert.ok(
    withPoint.slice(top + 1, 9).every((line) => line[column].kind === "fill"),
    "every cell under the marker is still the bar, so its height still reads",
  );
});

check("the legend names every series, and legend:false drops it", () => {
  const rows = renderComboRows({ ...barAndLine, legend: true });
  const marks = rows.filter((row) => row.runs.some((run) => run.kind === "legend-mark"));
  assert.equal(marks.length, 2, `one legend row per series (${marks.length})`);
  assert.equal(marks[0].runs[0].text.trim(), "●", "the marker is a filled circle");
  const text = marks.map((row) => runsText(row.runs)).join("\n");
  assert.ok(text.includes("Volume") && text.includes("Trend"), `both names are listed: ${text}`);
  assert.ok(!text.includes("Ghost"), "nothing the fence did not give is listed");

  const bare = renderComboRows(barAndLine);
  assert.equal(
    bare.flatMap((row) => row.runs).filter((run) => run.kind === "legend-mark").length,
    0,
    "legend:false prints no legend",
  );
});

check("a one-sided mix says no data with a reason", () => {
  const onlyBars = {
    type: "combo",
    width: 40,
    labels: ["A"],
    series: [{ name: "v", type: "bar", values: [5] }],
  };
  const onlyLines = { ...onlyBars, series: [{ name: "v", type: "line", values: [5] }] };
  const bars = textRows(renderComboRows(onlyBars)).join("\n");
  assert.match(bars, /no data/);
  assert.match(bars, /line series/, "a bar-only mix names the line it needs");
  const lines = textRows(renderComboRows(onlyLines)).join("\n");
  assert.match(lines, /no data/);
  assert.match(lines, /bar series/, "a line-only mix names the bar it needs");
  const none = textRows(renderComboRows({ type: "combo", width: 30 })).join("\n");
  assert.match(none, /no data/);
});

check("every row fits at 24 and 80, and the render is deterministic", () => {
  const spec = {
    type: "combo",
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    series: [
      { name: "Won", type: "bar", values: [12, 18, 9, 24, 20, 30] },
      { name: "Plan", type: "line", values: [15, 20, 15, 25, 25, 32] },
    ],
  };
  for (const width of [24, 80]) {
    const rows = renderComboRows({ ...spec, width });
    for (const row of rows) {
      const text = runsText(row.runs);
      assert.ok(cols(text) <= width, `width ${width}: "${text}" is ${cols(text)} cells`);
      assert.equal(row.width, width);
    }
    assert.deepEqual(renderComboRows({ ...spec, width }), rows, `width ${width} is deterministic`);
  }
});

check("the axis gutter aligns the plot across bar and line rows", () => {
  const rows = renderComboRows(barAndLine);
  const axis = buildAxis({ min: 0, max: 30, plotRows: 9 });
  for (let row = 0; row < 9; row++) {
    const gutter = rows[row].runs[0].text;
    assert.equal(cols(gutter), axis.gutter, `plot row ${row} keeps the gutter width`);
    const mark = [...gutter].at(-1);
    assert.ok(["┤", "│", "┼"].includes(mark), `row ${row} ends its gutter with an axis mark ("${mark}")`);
  }
  const columns = gridOf(rows).flatMap((line) =>
    line
      .map((cell, column) => (cell?.kind === "fill" ? column : -1))
      .filter((column) => column >= 0),
  );
  assert.ok(columns.length > 0, "marks are drawn");
  assert.ok(columns.every((column) => column >= axis.gutter), "no mark lands inside the gutter");
  assert.equal(Math.min(...columns), axis.gutter, "bar and line both start at the first plot column");
});

check("height is the whole block, title and legend included", () => {
  const rows = renderComboRows({
    type: "combo",
    width: 48,
    height: 12,
    title: "Actual vs trend",
    labels: ["A", "B", "C"],
    series: [
      { name: "Volume", type: "bar", values: [10, 20, 10] },
      { name: "Trend", type: "line", values: [30, 10, 30] },
    ],
  });
  assert.equal(rows.length, 12, `the block is exactly 12 rows (${rows.length})`);
  assert.equal(runsText(rows[0].runs), "Actual vs trend");
  // Chrome is the title, the label row and two legend rows, so the plot is 8.
  const legend = rows.slice(-2);
  assert.equal(legend.filter((row) => row.runs.some((run) => run.kind === "legend-mark")).length, 2);
});

check("a level line is one row of one sub-cell glyph", () => {
  const spec = {
    type: "combo",
    width: 40,
    plotHeight: 8,
    legend: false,
    labels: ["A", "B", "C"],
    series: [
      { name: "Bar", type: "bar", values: [5, 5, 5] },
      { name: "Flat", type: "line", values: [10, 10, 10] },
    ],
  };
  const cells = lineCells(gridOf(renderComboRows(spec)), 1);
  assert.ok(cells.length >= 3, `the whole run is drawn (${cells.length})`);
  assert.equal(new Set(cells.map((cell) => cell.row)).size, 1, "a level line stays on one row");
  assert.equal(new Set(cells.map((cell) => cell.char)).size, 1, "a level line uses one glyph");
});

check("unreadable values become zero under the combo policy", () => {
  const spec = {
    type: "combo",
    width: 40,
    plotHeight: 6,
    legend: false,
    labels: ["A", "B", "C"],
    series: [
      { name: "Bar", type: "bar", values: [null, "x", 4] },
      { name: "Line", type: "line", values: [1, undefined, 2] },
    ],
  };
  const rows = renderComboRows(spec);
  const text = textRows(rows).join("\n");
  assert.ok(!/NaN|Infinity|undefined/.test(text), `the frame stays readable:\n${text}`);
  assert.ok(rows.some((row) => row.runs.some((run) => run.kind === "fill")), "the readable value is drawn");
});

check("unreadable series are dropped, not guessed", () => {
  // A non-object, a missing type, an unknown type and empty values are all
  // absent data, not a bar with a default.
  const spec = {
    width: 40, labels: ["a"],
    series: [null, 5, [], { type: "area", values: [1] }, { type: "bar" }, { type: "line", values: [] }],
  };
  const text = textRows(renderComboRows(spec)).join("\n");
  assert.match(text, /no data/, `the junk was drawn:\n${text}`);
});

check("a series with no name still gets one", () => {
  const spec = {
    width: 40, labels: ["a", "b"],
    series: [{ type: "bar", values: [1, 2] }, { type: "line", values: [2, 1] }],
  };
  const text = textRows(renderComboRows(spec)).join("\n");
  assert.match(text, /series 1/, `the default name is missing:\n${text}`);
  assert.match(text, /series 2/, `the second default name is missing:\n${text}`);
});

check("a type in capitals is read as the same type", () => {
  const upper = renderComboRows({
    width: 40, labels: ["a", "b"],
    series: [{ type: "BAR", values: [1, 2] }, { type: "LINE", values: [2, 1] }],
  });
  const lower = renderComboRows({
    width: 40, labels: ["a", "b"],
    series: [{ type: "bar", values: [1, 2] }, { type: "line", values: [2, 1] }],
  });
  assert.deepEqual(textRows(upper), textRows(lower));
});

console.log(`\n${checks}/${checks} checks passed`);
