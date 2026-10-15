import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { CANDLE_DOWN, CANDLE_UP, normalizeCandles, renderCandleRows } from "../src/candle.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];

const flat = { open: 10, high: 14, low: 8, close: 12 };
const wide = { open: 8, high: 30, low: 4, close: 26 };
const doji = { open: 12, high: 16, low: 8, close: 12 };

/** The rows a period draws in: which plot rows carry a canvas cell. */
const drawnRowsOf = (rows, column) =>
  rows.flatMap((row, y) => {
    const cell = cellsOf(row)[column];
    return cell && cell !== " " && !"[│┤┼─]".includes(cell) ? [y] : [];
  });

check("a candle chart reads both shapes and fixes a bad high or low", () => {
  const objects = normalizeCandles({ candles: [{ label: "Jan", ...flat }] });
  assert.equal(objects.length, 1);
  assert.equal(objects[0].label, "Jan");
  assert.equal(objects[0].high, 14);
  assert.equal(objects[0].low, 8);

  const arrays = normalizeCandles({ values: [[10, 14, 8, 12]], labels: ["Feb"] });
  assert.deepEqual(
    { open: arrays[0].open, high: arrays[0].high, low: arrays[0].low, close: arrays[0].close },
    { open: 10, high: 14, low: 8, close: 12 },
  );
  assert.equal(arrays[0].label, "Feb");

  // A caller that swapped the extremes still gets a candle with the right top
  // and bottom, and a row that cannot be read is dropped instead of drawn.
  const swapped = normalizeCandles({ candles: [{ open: 10, high: 4, low: 30, close: 12 }, { open: "x" }] });
  assert.equal(swapped.length, 1);
  assert.equal(swapped[0].high, 30);
  assert.equal(swapped[0].low, 4);
  assert.equal(swapped[0].label, "1", "a missing label falls back to the position");
});

check("no candle row is wider than the chart", () => {
  const spec = { type: "candle", width: 44, height: 9, candles: [{ label: "Jan", ...flat }, { label: "Feb", ...wide }] };
  for (const row of textRows(renderCandleRows(spec))) {
    assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
  }
});

/** A drawn canvas cell: not a box character, a letter, a digit or a marker. */
const isCanvas = (cell) => Boolean(cell) && cell !== " " && !"│┤┼─[]●".includes(cell) && !/[0-9a-zA-Z]/.test(cell);

/** The plot columns that carry a drawn cell, grouped into periods. */
const groupsOf = (rows) => {
  const columns = new Set();
  for (const [y, row] of rows.entries()) {
    for (const [x, cell] of cellsOf(row).entries()) {
      if (isCanvas(cell)) columns.add(x);
    }
  }
  const sorted = [...columns].sort((a, b) => a - b);
  const groups = [];
  for (const x of sorted) {
    const last = groups[groups.length - 1];
    if (last && x - last[last.length - 1] <= 1) last.push(x);
    else groups.push([x]);
  }
  return groups;
};

check("a taller range covers more rows", () => {
  const spec = { type: "candle", width: 44, height: 12, candles: [{ label: "a", ...flat }, { label: "b", ...wide }] };
  const rows = textRows(renderCandleRows(spec));
  const groups = groupsOf(rows);
  assert.equal(groups.length, 2, `two periods, found ${groups.length} groups of columns: ${JSON.stringify(groups)}`);
  const rowsOf = (group) => rows.filter((row) => group.some((x) => cellsOf(row)[x] && cellsOf(row)[x] !== " ")).length;
  const short = rowsOf(groups[0]);
  const tall = rowsOf(groups[1]);
  assert.ok(short > 0, "the short candle draws");
  assert.ok(tall > short, `the wide-range candle covers more rows (${tall} vs ${short})`);
});

check("an up period and a down period take different colours", () => {
  const spec = {
    type: "candle",
    width: 40,
    height: 9,
    candles: [{ label: "up", open: 10, high: 14, low: 8, close: 13 }, { label: "down", open: 13, high: 14, low: 6, close: 7 }],
  };
  const rows = renderCandleRows(spec);
  const colours = new Set(
    rows.flatMap((row) => row.runs).filter((run) => run.kind === "fill" && run.color).map((run) => run.color),
  );
  assert.deepEqual([...colours].sort(), [CANDLE_DOWN, CANDLE_UP].sort(), `saw ${[...colours].join(",")}`);
  assert.notEqual(CANDLE_UP, CANDLE_DOWN);
});

check("the body spans open to close", () => {
  const body = { open: 10, high: 20, low: 2, close: 18 };
  const thin = { open: 10, high: 20, low: 2, close: 11 };
  const spec = { type: "candle", width: 44, height: 12, candles: [{ label: "a", ...body }, { label: "b", ...thin }] };
  const rows = textRows(renderCandleRows(spec));
  const groups = groupsOf(rows);
  assert.equal(groups.length, 2, `two periods, found ${groups.length}`);

  // A taller body fills more cells inside its own period.
  const cellsOfGroup = (group) =>
    rows.reduce((sum, row) => sum + group.filter((x) => isCanvas(cellsOf(row)[x])).length, 0);
  const wide = cellsOfGroup(groups[0]);
  const narrow = cellsOfGroup(groups[1]);
  assert.ok(wide > narrow, `a taller body covers more cells (${wide} vs ${narrow})`);
});

check("a doji still draws", () => {
  const rows = textRows(renderCandleRows({ type: "candle", width: 30, height: 9, candles: [{ label: "flat", ...doji }] }));
  const drawn = rows.some((row) => cellsOf(row).some((cell) => cell !== " " && !"[│┤┼─0-9]".includes(cell)));
  assert.ok(drawn, "an open equal to the close is a wick, not nothing");
});

check("the legend names both directions in their own colours", () => {
  const rows = renderCandleRows({ type: "candle", width: 40, height: 8, candles: [{ label: "a", ...flat }, { label: "b", ...wide }] });
  const legend = rows[rows.length - 1].runs;
  const marks = legend.filter((run) => run.kind === "legend-mark");
  assert.equal(marks.length, 2);
  assert.deepEqual(marks.map((run) => run.color).sort(), [CANDLE_DOWN, CANDLE_UP].sort());
  const text = runsText(legend);
  assert.match(text, /up/);
  assert.match(text, /down/);
});

check("an empty candle chart says so", () => {
  const rows = textRows(renderCandleRows({ type: "candle", width: 30, candles: [] }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

console.log(`\n${checks}/${checks} checks passed`);
