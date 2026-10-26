import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { CANDLE_DOWN, CANDLE_UP, normalizeCandles, renderCandleRows } from "../src/candle.js";
import { renderChart } from "../src/chart.js";

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

  // A null row is not a candle either.
  assert.equal(normalizeCandles({ candles: [null, undefined] }).length, 0);
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

  // No row list at all is the same chart, not a crash.
  const bare = textRows(renderCandleRows({ type: "candle", width: 30 }));
  assert.deepEqual(bare, rows);
});

/** The display column where a label starts, measured in cells, not code units. */
const columnOf = (row, text) => {
  const at = row.indexOf(text);
  return at < 0 ? -1 : cols(row.slice(0, at));
};

check("each label sits under its own candle", () => {
  const spec = {
    type: "candle",
    width: 44,
    height: 10,
    labels: ["Jan", "Feb", "Mar", "Apr", "May"],
    values: [[100, 118, 96, 112], [112, 120, 105, 108], [108, 115, 100, 114], [114, 125, 110, 120], [120, 130, 115, 128]],
  };
  const rows = textRows(renderCandleRows(spec));
  const labelRow = rows[rows.length - 2];
  const groups = groupsOf(rows.slice(0, -2));
  assert.equal(groups.length, spec.labels.length, `one group per candle, found ${groups.length}`);
  for (const [index, label] of spec.labels.entries()) {
    const at = labelRow.indexOf(label);
    assert.ok(at >= 0, `${label} is drawn`);
    const group = groups[index];
    const markCentre = (group[0] + group[group.length - 1]) / 2;
    const labelCentre = at + (cols(label) - 1) / 2;
    assert.ok(Math.abs(labelCentre - markCentre) <= 1, `${label} sits at ${labelCentre}, its candle at ${markCentre}`);
  }
});

check("a price series is read against its own range", () => {
  const spec = {
    type: "candle",
    width: 44,
    height: 9,
    labels: ["a", "b", "c"],
    values: [[100, 118, 96, 112], [112, 120, 105, 108], [108, 115, 100, 114]],
  };
  const ticks = (rows) =>
    rows
      .map((row) => row.match(/^\s*(-?[\d.]+)[┤┼]/))
      .filter(Boolean)
      .map((match) => Number(match[1]));
  const own = ticks(textRows(renderCandleRows(spec)));
  assert.ok(own.length >= 2, `the axis is drawn (${own.join(",")})`);
  assert.ok(Math.min(...own) >= 90, `the axis starts near the prices, saw ${Math.min(...own)}`);
  assert.ok(!own.includes(0), "zero is not on the axis by default");
  const zeroed = ticks(textRows(renderCandleRows({ ...spec, zero: true })));
  assert.ok(zeroed.includes(0), "zero: true still draws the zero line");
});

check("wide labels stay inside the chart and under their candle", () => {
  const spec = {
    type: "candle",
    width: 40,
    height: 9,
    labels: ["一月", "二月", "三月", "四月"],
    values: [[100, 118, 96, 112], [112, 120, 105, 108], [108, 115, 100, 114], [114, 125, 110, 120]],
  };
  const rows = textRows(renderCandleRows(spec));
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
  const labelRow = rows[rows.length - 2];
  const groups = groupsOf(rows.slice(0, -2));
  let drawn = 0;
  for (const [index, label] of spec.labels.entries()) {
    const at = columnOf(labelRow, label);
    if (at < 0) continue;
    drawn += 1;
    const group = groups[index];
    const markCentre = (group[0] + group[group.length - 1]) / 2;
    const labelCentre = at + (cols(label) - 1) / 2;
    assert.ok(Math.abs(labelCentre - markCentre) <= 1, `${label} sits at ${labelCentre}, its candle at ${markCentre}`);
  }
  assert.ok(drawn >= 2, `the labels that fit are drawn (${drawn})`);
});

check("an up and down colour can be set by hand", () => {
  const spec = {
    type: "candle",
    width: 40,
    height: 9,
    up: "#00ff00",
    down: "#ff0000",
    candles: [{ label: "up", open: 10, high: 14, low: 8, close: 13 }, { label: "down", open: 13, high: 14, low: 6, close: 7 }],
  };
  const rows = renderCandleRows(spec);
  const colours = new Set(
    rows.flatMap((row) => row.runs).filter((run) => run.kind === "fill" && run.color).map((run) => run.color),
  );
  assert.deepEqual([...colours].sort(), ["#00ff00", "#ff0000"], `saw ${[...colours].join(",")}`);
});

check("a title takes a row and the legend can be turned off", () => {
  const spec = {
    type: "candle",
    height: 10,
    title: "Prices",
    legend: false,
    candles: [{ label: "a", ...flat }, { label: "b", ...wide }],
  };
  const rows = textRows(renderCandleRows(spec));
  assert.equal(rows[0], "Prices");
  assert.equal(rows.length, 10, "the height budget counts the title");
  assert.ok(!rows.join("\n").includes("down"), "the legend is off");
  for (const row of rows) assert.ok(cols(row) <= 48, `"${row}" fits the default width`);
});

check("a crowded narrow chart still draws inside the width", () => {
  const spec = {
    type: "candle",
    width: 16,
    height: 8,
    candles: Array.from({ length: 20 }, (_, index) => ({
      label: `p${index}`,
      open: 10 + index,
      high: 14 + index,
      low: 6 + index,
      close: 9 + index,
    })),
  };
  const rows = textRows(renderCandleRows(spec));
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
  const drawn = groupsOf(rows.slice(0, -1)).reduce((sum, group) => sum + group.length, 0);
  assert.ok(drawn >= 4, `the periods that fit still draw (${drawn} columns)`);
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

check("a candle row that cannot be read is reported, not dropped in silence", () => {
  const good = { label: "ok", open: 10, high: 12, low: 9, close: 11 };
  const broken = { label: "bad", open: 11, high: 13, low: 10 };
  const rows = textRows(renderCandleRows({ type: "candle", width: 40, height: 8, candles: [good, broken] }));
  assert.ok(rows.some((row) => /1 candle skipped/.test(row)), `the dropped row is not reported:\n${rows.join("\n")}`);

  const two = textRows(renderCandleRows({ type: "candle", width: 40, height: 8, candles: [good, broken, { ...broken }] }));
  assert.ok(two.some((row) => /2 candles skipped/.test(row)), `the plural is wrong:\n${two.join("\n")}`);

  // Every row bad is still a counted loss, not a bare "no data".
  const none = textRows(renderCandleRows({ type: "candle", width: 40, height: 8, candles: [broken] }));
  assert.ok(none.some((row) => /no data/.test(row)), "the empty chart still says no data");
  assert.ok(none.some((row) => /1 candle skipped/.test(row)), `the loss is silent:\n${none.join("\n")}`);
});

check("a null or empty price counts as missing, not as zero", () => {
  // `Number(null)` is 0. Treating that as a price drew a candle at zero and
  // stretched the axis to it, with no note anywhere.
  const good = { label: "ok", open: 10, high: 12, low: 9, close: 11 };
  for (const missing of [null, "", undefined]) {
    const rows = textRows(
      renderCandleRows({
        type: "candle", width: 40, height: 8,
        candles: [good, { label: "bad", open: 11, high: 13, low: 10, close: missing }],
      }),
    );
    assert.ok(rows.some((row) => /1 candle skipped/.test(row)), `a blank close is not reported:\n${rows.join("\n")}`);
    assert.ok(!rows.some((row) => row.includes(" 0┤")), `the axis was stretched to zero:\n${rows.join("\n")}`);
  }
});

check("periods that do not fit are counted, not clipped in silence", () => {
  const all = periods(20);
  const spec = { type: "candle", width: 24, height: 8, legend: false, candles: all };
  const rows = textRows(renderCandleRows(spec));
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
    const rows = textRows(renderCandleRows({ type: "candle", width: 24, height: 8, legend: false, candles: periods(count) }));
    const note = rows.find((row) => /periods? hidden/.test(row));
    if (note) notes.push(note);
  }
  assert.ok(notes.includes("1 period hidden"), `saw ${JSON.stringify(notes)}`);
  assert.ok(notes.includes("2 periods hidden"), `saw ${JSON.stringify(notes)}`);
});

check("the notes survive the fence's height budget", () => {
  const lossy = {
    type: "candle",
    width: 40,
    height: 8,
    candles: [{ open: 10, high: 12, low: 9, close: 11 }, { open: 11, high: 13, low: 10 }],
  };
  const lines = renderChart(lossy).split("\n");
  assert.ok(lines.some((line) => /1 candle skipped/.test(line)), `the note was replaced:\n${lines.join("\n")}`);
  assert.equal(lines.length, 8, "the notes fit inside height");

  const crowded = renderChart({ type: "candle", width: 24, height: 8, candles: periods(20) }).split("\n");
  assert.ok(crowded.some((line) => /periods? hidden/.test(line)), `the note was replaced:\n${crowded.join("\n")}`);
  assert.equal(crowded.length, 8, "the notes fit inside height");
});

console.log(`\n${checks}/${checks} checks passed`);
