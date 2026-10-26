import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { renderHeatmapRows, normalizeGrid, HEAT_HIGH, HEAT_LOW } from "../src/heatmap.js";
import { renderGaugeRows } from "../src/gauge.js";
import { CHART_TYPES, chartTypes, renderChart, renderChartRows } from "../src/chart.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));

const specs = {
  pie: { type: "pie", width: 40, slices: [["a", 60], ["b", 40]] },
  donut: { type: "donut", width: 40, slices: [["a", 60], ["b", 40]] },
  bar: { type: "bar", width: 40, height: 6, labels: ["a", "b"], values: [3, 5] },
  column: { type: "column", width: 40, height: 6, labels: ["a", "b"], values: [3, 5] },
  hbar: { type: "hbar", width: 40, labels: ["a", "b"], values: [3, 5] },
  line: { type: "line", width: 40, height: 6, labels: ["a", "b", "c"], values: [3, 5, 4] },
  area: { type: "area", width: 40, height: 6, labels: ["a", "b", "c"], values: [3, 5, 4] },
  sparkline: { type: "sparkline", width: 40, values: [3, 5, 4] },
  scatter: { type: "scatter", width: 40, height: 6, points: [[0, 3], [1, 5], [2, 4]] },
  histogram: { type: "histogram", width: 40, height: 6, values: [1, 2, 2, 3, 4, 5, 5, 9] },
  candle: {
    type: "candle",
    width: 40,
    height: 6,
    candles: [{ label: "a", open: 10, high: 14, low: 8, close: 12 }, { label: "b", open: 12, high: 13, low: 9, close: 10 }],
  },
  candlestick: {
    type: "candlestick",
    width: 40,
    height: 6,
    values: [[10, 14, 8, 12], [12, 13, 9, 10]],
  },
  ohlc: { type: "ohlc", width: 40, height: 6, values: [[10, 14, 8, 12]] },
  waterfall: { type: "waterfall", width: 44, height: 8, labels: ["Start", "New", "Churn"], values: [120, 45, -30] },
  radar: { type: "radar", width: 40, height: 16, labels: ["Speed", "Cost", "Risk"], values: [3, 5, 4] },
  treemap: {
    type: "treemap",
    width: 46,
    height: 8,
    items: [
      { label: "API", value: 40 },
      { label: "Web", value: 25 },
      { label: "ETL", value: 15 },
    ],
  },
  sankey: {
    type: "sankey",
    width: 46,
    height: 10,
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    links: [
      { from: "a", to: "b", value: 6 },
      { from: "b", to: "c", value: 4 },
    ],
  },
  kanban: {
    type: "kanban",
    width: 46,
    height: 10,
    columns: [
      { title: "Todo", cards: [{ title: "Ship it" }] },
      { title: "Doing", cards: [{ title: "Review" }] },
    ],
  },
  gantt: {
    type: "gantt",
    width: 56,
    height: 10,
    today: 5,
    tasks: [{ label: "Plan", start: 0, end: 3 }, { label: "Build", start: 3, end: 8 }, { label: "Launch", at: 9, milestone: true }],
  },
  table: {
    type: "table",
    width: 46,
    columns: [{ label: "Account" }, { label: "ARR", type: "number" }],
    rows: [["Globex", 4200], ["Initech", 3100]],
  },
  heatmap: { type: "heatmap", width: 40, cellWidth: 2, headers: ["x", "y"], rows: [{ label: "r", values: [1, 2] }] },
  gauge: { type: "gauge", width: 40, label: "Coverage", value: 62, max: 100 },
  progress: { type: "progress", width: 40, label: "Done", value: 0.4, max: 1 },
};

check("every registered type renders rows inside the width", () => {
  for (const type of chartTypes()) {
    assert.ok(typeof CHART_TYPES[type] === "function", `${type} has a renderer`);
    const rows = renderChartRows(specs[type]);
    assert.ok(rows.length > 0, `${type} rendered nothing`);
    for (const row of rows) {
      assert.ok(cols(runsText(row.runs)) <= specs[type].width, `${type}: "${runsText(row.runs)}"`);
    }
    assert.ok(renderChart(specs[type]).length > 0, `${type} has plain text`);
  }
});

check("a type is guessed from the data when the fence leaves it out", () => {
  assert.ok(renderChart({ width: 40, slices: [["a", 1], ["b", 2]] }).includes("a"), "slices are a pie");
  assert.ok(renderChartRows({ width: 40, values: [1, 2, 3] }).length > 1, "values are a bar chart");
  assert.ok(renderChartRows({ width: 40, rows: [{ label: "r", values: [1, 2] }] }).length > 1, "rows are a heat map");
  assert.match(renderChart({ width: 40, type: "sunburst" }), /unknown chart type/);
});

check("a heat map gives one cell per value and colours the ramp", () => {
  const spec = {
    type: "heatmap",
    width: 44,
    cellWidth: 3,
    headers: ["9am", "12pm", "3pm"],
    rows: [{ label: "Mon", values: [1, 5, 9] }, { label: "Tue", values: [3, 6, 8] }],
    valueLabels: false,
    scale: false,
  };
  const rows = renderChartRows(spec);
  const cells = rows.flatMap((row) => row.runs).filter((run) => run.kind === "cell" && run.color);
  assert.equal(cells.length, 6, "six values, six cells");
  assert.equal(cols(cells[0].text), 3, "cellWidth is respected");
  const colours = new Set(cells.map((cell) => cell.color));
  assert.ok(colours.size >= 4, `the ramp varies with the value (${colours.size} colours)`);
  const first = cells[0].color;
  assert.equal(first.toLowerCase(), HEAT_LOW.toLowerCase(), "the smallest value is the low colour");
  const dataRows = rows.slice(1); // header, then the data rows
  for (const row of rows.filter((row) => row.runs.some((run) => run.kind === "cell"))) {
    for (const run of row.runs.filter((entry) => entry.kind === "cell")) {
      assert.ok(run.color, "every painted cell carries its colour");
    }
  }
  assert.equal(dataRows.length, 2, "one row per grid row");

  const grid = normalizeGrid(spec);
  assert.equal(grid.rows.length, 2);
  assert.deepEqual(grid.columns, ["9am", "12pm", "3pm"]);
});

check("a heat map writes numbers when the cell is wide enough", () => {
  const wide = renderChartRows({ type: "heatmap", width: 44, cellWidth: 4, rows: [{ label: "r", values: [12, 98] }] });
  const labels = wide.flatMap((row) => row.runs).filter((run) => run.kind === "label");
  assert.equal(labels.length, 2, "both values are written");
  assert.equal(labels[1].text.trim(), "98");
  assert.ok(labels[1].color, "a labelled cell still carries its colour");

  const narrow = renderChartRows({ type: "heatmap", width: 20, cellWidth: 1, rows: [{ label: "r", values: [1240, 980] }] });
  assert.equal(narrow.flatMap((row) => row.runs).filter((run) => run.kind === "label").length, 0);
});

check("a gauge fills its bar in proportion and leaves a track", () => {
  const rows = renderChartRows({ type: "gauge", width: 40, label: "Coverage", value: 50, max: 100 });
  const runs = rows[0].runs;
  const filled = runs.filter((run) => run.kind === "fill" && run.slice === 0).reduce((sum, run) => sum + cols(run.text), 0);
  const track = runs.filter((run) => run.kind === "track").reduce((sum, run) => sum + cols(run.text), 0);
  assert.ok(filled > 0 && track > 0, `filled ${filled}, track ${track}`);
  assert.ok(Math.abs(filled - track) <= 1, "half the bar is filled at 50%");
  assert.match(runsText(runs), /Coverage/);
  assert.match(runsText(runs), /50\.0%/);
});

check("a gauge draws the target where it belongs", () => {
  const ahead = renderChartRows({ type: "gauge", width: 40, label: "x", value: 30, max: 100, target: 80 });
  const marks = ahead[0].runs.filter((run) => run.kind === "target");
  assert.equal(marks.length, 1, "a target beyond the value is a marker on the track");
  assert.match(runsText(ahead[0].runs), /target 80/);

  const passed = renderChartRows({ type: "gauge", width: 40, label: "x", value: 90, max: 100, target: 40 });
  const over = passed[0].runs.filter((run) => run.kind === "line");
  assert.equal(over.length, 1, "a target the bar passed is drawn over the fill");
  assert.equal(passed[0].runs.filter((run) => run.kind === "target").length, 0);
});

check("a gauge row never exceeds its width", () => {
  for (const value of [0, 1, 37, 62, 99, 100, 140]) {
    for (const width of [24, 48, 100]) {
      const row = runsText(renderGaugeRows({ type: "gauge", width, label: "A longish label", value, max: 100, target: 75 })[0].runs);
      assert.ok(cols(row) <= width, `"${row}" is ${cols(row)} of ${width}`);
    }
  }
});

check("the guess reads a table, a grid, a series and nothing at all", () => {
  assert.match(renderChart({ width: 40, columns: [{ label: "a" }], rows: [["x", 1]] }), /no type, read as table/);
  assert.match(renderChart({ width: 40, values: [[1, 2], [3, 4]] }), /no type, read as heatmap/);
  assert.match(renderChart({ width: 40, series: [{ values: [1, 2] }] }), /no type, read as bar/);
  assert.equal(renderChartRows({ width: 40 })[0].runs[0].text, "no chart data");
});

check("height is the whole block, not the plot", () => {
  for (const height of [1, 2, 3]) {
    const rows = renderChartRows({ type: "pie", width: 40, height, slices: [["a", 6], ["b", 4]] });
    assert.ok(rows.length <= height, `height ${height} gave ${rows.length} rows`);
  }
  const trimmed = textRows(renderChartRows({ type: "pie", width: 40, height: 2, slices: [["a", 6], ["b", 4]] }));
  assert.match(trimmed[trimmed.length - 1], /rows hidden at height 2/, trimmed.join(" | "));
  // A family that already fits inside the budget is left alone.
  const gauge = renderChartRows({ type: "gauge", width: 40, height: 10, value: 50, max: 100 });
  assert.equal(gauge.length, 1, "the gauge fits its own block");
});

check("a numeric string draws as its number and is not reported", () => {
  // Every family reads a value with Number(), so "12" draws at 12. The footer
  // must not call it bad, and the picture must be the number's picture.
  const fromStrings = renderChart({ type: "bar", width: 40, values: ["12", "13"] });
  const fromNumbers = renderChart({ type: "bar", width: 40, values: [12, 13] });
  assert.equal(fromStrings, fromNumbers, "a numeric string draws exactly like its number");
  assert.ok(!fromStrings.includes("non-numeric"), "and nothing is reported about it");
});

check("a null and an empty string are still missing values", () => {
  // Number(null) and Number("") are 0, but neither is a number the caller wrote.
  for (const missing of [null, ""]) {
    const rows = textRows(renderChartRows({ type: "bar", width: 40, values: [1, missing, 3] }));
    const note = rows.find((row) => row.includes("non-numeric"));
    assert.ok(note && note.includes("1 non-numeric value"), `${JSON.stringify(missing)}: ${rows.join(" | ")}`);
  }
});

check("the footer says whether a bad value is drawn as 0 or dropped", () => {
  // A bar reads the bad value as zero and draws it; a pie has no slice for it.
  const bar = renderChart({ type: "bar", width: 40, values: [1, "n/a", 3] });
  assert.match(bar, /1 non-numeric value treated as 0/);

  const pie = renderChart({ type: "pie", width: 40, slices: [["a", "n/a"], ["b", 25]] });
  assert.match(pie, /1 non-numeric value dropped/);
  assert.ok(!pie.includes("treated as 0"), `a dropped value is not drawn as zero:\n${pie}`);
});

check("a chart note and a family note share the height budget", () => {
  // The reported repro: the family drew into the whole height, the notes were
  // added on top, and the guard hid the family's last rows. A note is a row of
  // the block `height` measures, so the family must be sized after the notes.
  const candles = [
    { open: 10, high: 12, low: 9, close: 11 },
    { open: "x", high: 13, low: 10, close: 12 },
  ];
  const lone = textRows(renderChartRows({ type: "candle", width: 40, height: 8, candles }));
  assert.match(lone.join("\n"), /1 candle skipped/, "the family note is the visible row");
  assert.doesNotMatch(lone.join("\n"), /row hidden at/, "the guard has nothing to hide");

  // Both kinds of note at once, which is where the budget was overspent.
  const both = textRows(
    renderChartRows({ type: "candle", width: 40, height: 8, percent: true, candles }),
  );
  const text = both.join("\n");
  assert.equal(both.length, 8, `the block is exactly the height (${both.length} rows)`);
  assert.match(text, /1 candle skipped/, `the family note survives:\n${text}`);
  assert.match(text, /percent is now showPercent/, `the chart note is there:\n${text}`);
  assert.doesNotMatch(text, /row hidden at/, `nothing was hidden (${text})`);
});

check("a missing value is drawn as 0 and never called dropped", () => {
  // `Number(null)` and `Number("")` are 0, so every family reads the value as 0
  // and draws it. The footer must say what the chart did, not what it did not.
  for (const missing of [null, ""]) {
    const histogram = renderChart({ type: "histogram", width: 44, height: 8, values: [1, 2, missing, 4] });
    assert.match(histogram, /1 non-numeric value treated as 0/, `histogram ${JSON.stringify(missing)}`);
    assert.doesNotMatch(histogram, /dropped/, `histogram ${JSON.stringify(missing)}`);

    const waterfall = renderChart({
      type: "waterfall",
      width: 44,
      height: 8,
      labels: ["Start", "Null", "Churn"],
      values: [120, missing, -30],
    });
    assert.match(waterfall, /1 non-numeric value treated as 0/, `waterfall ${JSON.stringify(missing)}`);
    assert.doesNotMatch(waterfall, /dropped/, `waterfall ${JSON.stringify(missing)}`);

    // A candle and an ohlc draw the 0 price and stretch the axis to it, so the
    // same value is drawn here too; calling it dropped was the lie.
    for (const type of ["candle", "ohlc"]) {
      const price = renderChart({
        type,
        width: 40,
        height: 8,
        candles: [
          { open: 10, high: 12, low: 9, close: 11 },
          { open: missing, high: 13, low: 10, close: 12 },
        ],
      });
      assert.doesNotMatch(price, /dropped/, `${type} ${JSON.stringify(missing)}`);
    }
  }

  // Both groups in one spec: the missing value keeps its own verb and the value
  // no number comes out of takes the family's. A family that draws its zeros
  // says one phrase for both.
  const flat = (text) => text.replace(/\s+/g, " ");
  assert.match(
    flat(renderChart({ type: "pie", width: 44, slices: [["a", null], ["b", "x"], ["c", 2]] })),
    /1 non-numeric value treated as 0 and 1 non-numeric value dropped/,
  );
  const mixedBar = flat(renderChart({ type: "bar", width: 44, values: [1, null, "x", 3] }));
  assert.match(mixedBar, /2 non-numeric values treated as 0/, mixedBar);
  assert.doesNotMatch(mixedBar, /dropped/, `a zero-filling bar drops nothing (${mixedBar})`);
});

check("a loss a family reports itself is not counted twice", () => {
  // These families name what they could not draw in their own units. Counting
  // the same rows again at chart level reported one loss as two.
  const candles = [
    { open: 10, high: 12, low: 9, close: 11 },
    { open: "x", high: 13, low: 10, close: 12 },
  ];
  for (const type of ["candle", "candlestick", "ohlc"]) {
    const text = renderChart({ type, width: 40, candles });
    assert.doesNotMatch(text, /non-numeric/, `${type} counts the loss again:\n${text}`);
    const notes = text.match(/1 candle skipped/g) ?? [];
    assert.equal(notes.length, 1, `${type} reports its own loss once:\n${text}`);
  }

  const tree = renderChart({
    type: "treemap",
    width: 46,
    items: [{ label: "API", value: "n/a" }, { label: "Web", value: 25 }],
  });
  assert.doesNotMatch(tree, /non-numeric/, `treemap counts the loss again:\n${tree}`);
  assert.match(tree, /1 value omitted/, "the treemap still names what it lost");

  const heat = renderChart({ type: "heatmap", width: 40, cellWidth: 2, rows: [{ label: "r", values: [1, "x"] }] });
  assert.doesNotMatch(heat, /non-numeric/, `heatmap counts the loss again:\n${heat}`);
});

console.log(`\n${checks}/${checks} checks passed`);
