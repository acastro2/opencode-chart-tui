import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { CHART_TYPES, renderChart } from "../src/chart.js";
import { renderOhlcRows } from "../src/ohlc.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const candles = [
  { label: "Mon", open: 10, high: 14, low: 8, close: 12 },
  { label: "Tue", open: 12, high: 13, low: 9, close: 10 },
  { label: "Wed", open: 10, high: 12, low: 7, close: 11 },
];

check("ohlc is its own renderer, not a candlestick alias", () => {
  assert.notEqual(CHART_TYPES.ohlc, CHART_TYPES.candle);
  assert.equal(CHART_TYPES.ohlc, renderOhlcRows);
});

check("no ohlc row is wider than the chart", () => {
  for (const width of [16, 24, 40, 56, 100]) {
    const rows = renderOhlcRows({ width, height: 10, candles });
    for (const row of textRows(rows)) {
      assert.ok(cols(row) <= width, `"${row}" is ${cols(row)} of ${width}`);
    }
  }
});

check("a price series does not include zero unless asked", () => {
  const prices = [
    { label: "A", open: 95, high: 120, low: 92, close: 118 },
    { label: "B", open: 118, high: 124, low: 110, close: 112 },
  ];
  const normal = textRows(renderOhlcRows({ width: 40, height: 10, candles: prices })).join("\n");
  assert.ok(!/\b0\b/.test(normal), "zero appeared on the axis");
  const zero = textRows(renderOhlcRows({ width: 40, height: 10, candles: prices, zero: true })).join("\n");
  assert.ok(/\b0\b/.test(zero), "zero was requested but did not appear");
});

check("height is the total rows and plotHeight overrides the plot", () => {
  const total = renderOhlcRows({ width: 40, height: 10, title: "ACME", candles });
  assert.equal(total.length, 10);
  const plot = renderOhlcRows({ width: 40, height: 10, plotHeight: 5, title: "ACME", candles });
  assert.equal(plot.length, 8);
});

check("a label sits under its own candle", () => {
  const one = [{ label: "X", open: 10, high: 14, low: 8, close: 12 }];
  const rows = textRows(renderOhlcRows({ width: 40, height: 8, candles: one, legend: false }));
  const labelRow = rows[rows.length - 1];
  const labelAt = labelRow.indexOf("X");
  assert.ok(labelAt >= 0, "the label is missing");
  // The label row starts with the axis gutter, so its leading spaces are the
  // plot's first column. Ignore the axis mark to the left of that.
  const plotStart = labelRow.length - labelRow.trimStart().length;
  // The wick or one of its ticks is the period's centre.
  let markAt = -1;
  for (const row of rows) {
    const hit = [...row].findIndex((char, index) => index >= plotStart && "│┤├┼".includes(char));
    if (hit >= 0) {
      markAt = hit;
      break;
    }
  }
  assert.ok(markAt >= 0, "the period has no mark");
  assert.ok(Math.abs(labelAt - markAt) <= 1, `label at ${labelAt}, mark at ${markAt}`);
});

check("ohlc draws open and close ticks, never a filled body", () => {
  const rows = textRows(
    renderOhlcRows({
      width: 40,
      height: 8,
      legend: false,
      candles: [{ label: "X", open: 10, high: 14, low: 8, close: 12 }],
    }),
  );
  // The label is centred on its period, so its index is the stem's column.
  const stem = [...rows[rows.length - 1]].indexOf("X");
  assert.ok(stem > 0, "the label is missing");
  const at = (row) => [...rows[row]][stem];
  const openRow = rows.findIndex((_, index) => at(index) === "┤");
  const closeRow = rows.findIndex((_, index) => at(index) === "├");

  assert.ok(openRow >= 0, "the open tick is missing");
  assert.ok(closeRow >= 0, "the close tick is missing");
  assert.ok(
    closeRow < openRow,
    `close at ${closeRow} is not above open at ${openRow}`,
  );
  // The arm says which side the price is on: open left, close right.
  assert.equal([...rows[openRow]][stem - 1], "─", "the open tick has no left arm");
  assert.equal([...rows[closeRow]][stem + 1], "─", "the close tick has no right arm");
  assert.notEqual([...rows[openRow]][stem + 1], "─", "the open tick points the wrong way");
  // A stem is a contiguous run of line and tick glyphs, never a solid body.
  const marked = rows
    .map((row, index) => ("│┤├┼".includes([...row][stem] ?? "") ? index : -1))
    .filter((index) => index >= 0);
  assert.ok(marked.length > 0, "the period has no stem");
  assert.equal(
    marked.length,
    marked[marked.length - 1] - marked[0] + 1,
    "the stem has a gap",
  );
  for (const row of rows) {
    assert.ok(
      ![...row].some((char) => "█▓▒░".includes(char)),
      `a filled body appeared: "${row}"`,
    );
  }
});

check("the legend can be turned off and skipped input is reported", () => {
  const rows = textRows(
    renderOhlcRows({
      width: 40,
      height: 9,
      candles: [{ label: "A", open: 10, high: 14, low: 8, close: 12 }, { label: "bad", open: "x" }],
      legend: false,
    }),
  );
  assert.ok(!rows.some((row) => row.includes("● up")), "the legend is still there");
  assert.ok(rows.some((row) => /1 candle skipped/.test(row)), "the dropped row is not reported");
});

check("every label appears in order", () => {
  const rows = textRows(renderOhlcRows({ width: 56, height: 10, candles }));
  const labelRow = rows.find((row) => row.includes("Mon") && row.includes("Tue") && row.includes("Wed"));
  assert.ok(labelRow, "not all labels are on one row");
  const positions = ["Mon", "Tue", "Wed"].map((label) => labelRow.indexOf(label));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(positions[1] - positions[0] > 2, "labels are crowded together");
});

check("empty data says so instead of drawing an empty axis", () => {
  const rows = textRows(renderOhlcRows({ width: 40, height: 8, values: [] }));
  assert.ok(rows.some((row) => row.includes("no data")));
});

/** `count` periods, labelled a, b, c... so no label is a prefix of another. */
const periods = (count) =>
  Array.from({ length: count }, (_, index) => ({
    label: String.fromCharCode(97 + index),
    open: 10 + index,
    high: 14 + index,
    low: 6 + index,
    close: 9 + index,
  }));

check("periods that do not fit are counted, not clipped in silence", () => {
  const all = periods(20);
  const spec = { type: "ohlc", width: 24, height: 8, legend: false, candles: all };
  const rows = textRows(renderOhlcRows(spec));
  const note = rows.find((row) => /periods? hidden/.test(row));
  assert.ok(note, `the periods cut off the right edge are not reported:\n${rows.join("\n")}`);

  const hidden = Number(note.match(/(\d+)/)[1]);
  const labelRow = rows.find((row) => row.includes("a"));
  assert.ok(labelRow, "the first period is drawn");
  const shown = all.filter((candle) => labelRow.includes(candle.label));
  assert.equal(shown.length + hidden, all.length, `${shown.length} labels drawn, ${hidden} reported hidden`);
  assert.deepEqual(
    shown.map((candle) => candle.label),
    all.slice(0, shown.length).map((candle) => candle.label),
    "the first periods are the ones kept",
  );
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
});

check("one hidden period reads in the singular", () => {
  const notes = [];
  for (let count = 2; count <= 14; count += 1) {
    const rows = textRows(renderOhlcRows({ type: "ohlc", width: 24, height: 8, legend: false, candles: periods(count) }));
    const note = rows.find((row) => /periods? hidden/.test(row));
    if (note) notes.push(note);
  }
  assert.ok(notes.includes("1 period hidden"), `saw ${JSON.stringify(notes)}`);
  assert.ok(notes.includes("2 periods hidden"), `saw ${JSON.stringify(notes)}`);
});

check("the notes survive the fence's height budget", () => {
  const lossy = {
    type: "ohlc",
    width: 40,
    height: 8,
    candles: [{ open: 10, high: 12, low: 9, close: 11 }, { open: 11, high: 13, low: 10 }],
  };
  const lines = renderChart(lossy).split("\n");
  assert.ok(lines.some((line) => /1 candle skipped/.test(line)), `the note was replaced:\n${lines.join("\n")}`);
  assert.equal(lines.length, 8, "the notes fit inside height");

  const crowded = renderChart({ type: "ohlc", width: 24, height: 8, candles: periods(20) }).split("\n");
  assert.ok(crowded.some((line) => /periods? hidden/.test(line)), `the note was replaced:\n${crowded.join("\n")}`);
  assert.equal(crowded.length, 8, "the notes fit inside height");
});

console.log(`\n${checks}/${checks} checks passed`);
