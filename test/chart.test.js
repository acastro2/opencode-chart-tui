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

console.log(`\n${checks}/${checks} checks passed`);
