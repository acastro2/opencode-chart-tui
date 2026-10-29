import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { normalizeBoxes, renderBoxRows } from "../src/box.js";
import { PALETTES, styleOf, THEMES } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];
const boxGlyphs = new Set(["█", "│"]);
const markGlyphs = new Set(["├", "┤", "─", "█", "│", "●"]);
const glyphCount = (row, glyph) => cellsOf(row).filter((cell) => cell === glyph).length;
const boxCells = (row) => cellsOf(row).filter((cell) => boxGlyphs.has(cell)).length;
const markColumns = (row) => cellsOf(row).flatMap((cell, index) => (markGlyphs.has(cell) ? [index] : []));

/** A right-skewed sample: the median sits between the quartiles, not on them. */
const skewed = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 7, 8, 10];
const skewedSpec = { type: "box", width: 60, labels: ["skewed"], values: [skewed] };

/** Two samples: one narrow, one four times as wide. */
const widthsSpec = {
  type: "box",
  width: 80,
  labels: ["narrow", "wide"],
  values: [
    [10, 11, 12, 13, 14],
    [6, 8, 10, 12, 14, 16, 18],
  ],
};

/**
 * A deterministic sample, so a property test needs no fixture file. The Lehmer
 * step keeps every product inside 2^53, so the sequence is exact and repeating
 * it is what makes the check meaningful.
 */
function generated(seed, size) {
  let state = seed;
  const next = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  return Array.from({ length: size }, () => Math.round(next() * 1000) / 10);
}

check("a right-skewed sample puts its median between the quartiles", () => {
  const [box] = normalizeBoxes(skewedSpec);
  assert.ok(box.q1 < box.median, `Q1 ${box.q1} is below the median ${box.median}`);
  assert.ok(box.median < box.q3, `the median ${box.median} is below Q3 ${box.q3}`);

  // And the drawing agrees: the median notch sits inside the box, not on an edge.
  const row = textRows(renderBoxRows(skewedSpec))[0];
  const medianAt = cellsOf(row).indexOf("│");
  const fills = cellsOf(row).flatMap((cell, index) => (cell === "█" ? [index] : []));
  assert.ok(medianAt > 0 && fills.length > 0, "the box and its median are drawn");
  assert.ok(Math.min(...fills) < medianAt, `the median at ${medianAt} is right of the box start`);
  assert.ok(medianAt < Math.max(...fills), `the median at ${medianAt} is left of the box end`);
});

check("a wider sample draws a wider box", () => {
  const [narrowRow, wideRow] = textRows(renderBoxRows(widthsSpec));
  const narrow = boxCells(narrowRow);
  const wide = boxCells(wideRow);
  assert.ok(narrow > 0 && wide > 0, "both boxes are drawn");
  assert.ok(wide > narrow, `the wider sample drew ${wide} box cells, the narrow one ${narrow}`);
  assert.ok(wide >= narrow * 2, `four times the spread should be at least twice as wide: ${wide} vs ${narrow}`);
});

check("a whisker never passes the data and a point past 1.5 IQR is an outlier", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const samples = generated(seed, 3 + (seed % 17));
    const [box] = normalizeBoxes({ type: "box", values: [samples] });
    assert.ok(box, `seed ${seed} has samples to draw`);
    assert.ok(box.whiskerLow >= box.min, `seed ${seed}: the low whisker is at or above the smallest sample`);
    assert.ok(box.whiskerHigh <= box.max, `seed ${seed}: the high whisker is at or below the largest sample`);
    assert.ok(
      box.median >= box.whiskerLow && box.median <= box.whiskerHigh,
      `seed ${seed}: the median is inside the whiskers`,
    );

    const reach = 1.5 * (box.q3 - box.q1);
    const expected = box.samples.filter((value) => value < box.q1 - reach || value > box.q3 + reach);
    assert.deepEqual(box.outliers, expected, `seed ${seed}: the outliers are the samples past the fences`);
  }

  // A drawn tail: one dot, and none on a sample whose points all sit inside the fences.
  const spread = Array.from({ length: 20 }, (_, index) => index + 1);
  const tail = { type: "box", width: 80, labels: ["tail"], values: [[...spread, 200]] };
  const [outlierBox] = normalizeBoxes(tail);
  assert.deepEqual(outlierBox.outliers, [200]);
  assert.equal(glyphCount(textRows(renderBoxRows(tail))[0], "●"), 1, "the far point is marked once");
  assert.equal(glyphCount(textRows(renderBoxRows({ ...tail, values: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]] }))[0], "●"), 0);
});

check("the labels and the axis share one left offset", () => {
  const spec = {
    type: "box",
    width: 60,
    labels: ["a", "long name"],
    values: [
      [1, 2, 3, 4, 5],
      [4, 5, 6, 7, 8, 9],
    ],
  };
  const rows = textRows(renderBoxRows(spec));
  const axis = rows[rows.length - 1];
  const axisStart = axis.search(/\S/);
  assert.ok(axisStart > 0, "the axis starts after the gutter");

  // Right-aligned: every label ends in the same column, so the gutter is a column.
  const ends = [
    rows[0].indexOf("a") + cols("a") - 1,
    rows[1].indexOf("long name") + cols("long name") - 1,
  ];
  assert.equal(new Set(ends).size, 1, `the labels end at ${ends.join(" and ")}`);
  assert.equal(axisStart, ends[0] + 2, `the axis starts one blank column after the labels (${axisStart} vs ${ends[0]})`);

  // Nothing is drawn left of the plot, so the axis column is the plot's column.
  for (const row of rows.slice(0, -1)) {
    const first = row.search(/[├┤─█│●]/);
    assert.ok(first >= axisStart, `"${row}" draws at ${first}, left of the plot at ${axisStart}`);
  }
});

check("the axis row carries three to five round ticks in order", () => {
  const spec = { type: "box", width: 48, labels: ["a"], values: [Array.from({ length: 20 }, (_, i) => i + 1)] };
  const rows = textRows(renderBoxRows(spec));
  const tokens = rows[rows.length - 1].trim().split(/\s+/);
  assert.ok(tokens.length >= 3 && tokens.length <= 5, `saw ${tokens.length} ticks: ${tokens.join(" ")}`);
  for (const token of tokens) assert.match(token, /^-?\d+(\.\d+)?$/, `"${token}" is a number`);
  const values = tokens.map(Number);
  assert.deepEqual(values, [...values].sort((a, b) => a - b), `the ticks read left to right: ${values.join(" ")}`);
});

check("an empty chart says no data and one value still draws a box", () => {
  const empty = renderBoxRows({ type: "box", width: 40, values: [] });
  assert.equal(empty.length, 1);
  assert.equal(runsText(empty[0].runs), "  no data");
  assert.deepEqual(empty[0].runs.map((run) => run.kind), ["legend"]);

  const unreadable = renderBoxRows({ type: "box", width: 40, labels: ["x"], values: [[null, "x", ""]] });
  assert.match(runsText(unreadable[0].runs), /no data/);

  const single = textRows(renderBoxRows({ type: "box", width: 40, labels: ["one"], values: [[5]] }));
  assert.ok(single[0].includes("█"), `a single value draws a block: "${single[0]}"`);
});

check("blanks and unreadable samples are not samples", () => {
  const [box] = normalizeBoxes({ type: "box", values: [[1, null, "x", 2, ""]] });
  assert.deepEqual(box.samples, [1, 2]);
  const [alone] = normalizeBoxes({ type: "box", labels: ["only"], values: [[7]] });
  assert.deepEqual([alone.min, alone.max, alone.median], [7, 7, 7]);
  assert.equal(normalizeBoxes({ type: "box", values: [[null, undefined]] }).length, 0);
});

check("one row per label, then the axis", () => {
  const labels = ["alpha", "beta", "gamma"];
  const rows = textRows(
    renderBoxRows({
      type: "box",
      width: 50,
      labels,
      values: [
        [1, 2, 3, 4, 5],
        [4, 5, 6, 7, 8],
        [2, 4, 6, 8, 10],
      ],
    }),
  );
  assert.equal(rows.length, labels.length + 1, `three labels plus one axis, saw ${rows.length} rows`);
  for (const [index, label] of labels.entries()) {
    assert.ok(rows[index].includes(label), `row ${index} names ${label}`);
  }
  assert.match(rows[rows.length - 1].trim(), /^[\d.\-]+(\s+[\d.\-]+)*$/, "the last row is the axis");
});

check("the box is the series colour and the median cuts it out", () => {
  const rows = renderBoxRows(widthsSpec);
  const runs = rows.flatMap((row) => row.runs);
  const known = new Set(["fill", "axis", "line", "target", "legend", "title", "outside"]);
  for (const run of runs) assert.ok(known.has(run.kind), `"${run.kind}" is not a run kind`);

  const fills = runs.filter((run) => run.kind === "fill" && run.slice >= 0);
  assert.ok(fills.length >= 2, "each box is a fill run");
  for (const run of fills) {
    const style = styleOf(run, PALETTES.dark, THEMES.dark);
    assert.ok(PALETTES.dark.includes(style.fg), `the box takes a palette colour, got ${style.fg}`);
  }

  const medians = runs.filter((run) => run.kind === "line" && run.slice >= 0);
  assert.ok(medians.length >= 2, "each median is a line run");
  for (const run of medians) {
    const style = styleOf(run, PALETTES.dark, THEMES.dark);
    assert.ok(PALETTES.dark.includes(style.bg), `the median sits on the box colour, got ${style.bg}`);
    assert.equal(style.fg, THEMES.dark.background, "the median is cut out of the box");
  }
});

check("a box sits inside its whisker caps", () => {
  const [narrowRow, wideRow] = textRows(renderBoxRows(widthsSpec));
  for (const row of [narrowRow, wideRow]) {
    const cells = cellsOf(row);
    const low = cells.indexOf("├");
    const high = cells.indexOf("┤");
    const fills = cells.flatMap((cell, index) => (boxGlyphs.has(cell) ? [index] : []));
    assert.ok(low >= 0 && high > low, `both caps are drawn: "${row}"`);
    assert.ok(fills.length > 0, "the box is drawn");
    assert.ok(low < Math.min(...fills), "the low whisker is left of the box");
    assert.ok(Math.max(...fills) < high, "the high whisker is right of the box");
  }
});

check("every row fits the width at 16, 40 and 80", () => {
  for (const width of [16, 40, 80]) {
    const spec = {
      type: "box",
      width,
      labels: ["short", "a much longer label", "mid"],
      values: [
        [1, 2, 3, 4, 5],
        [10, 20, 30, 40, 50, 60, 70],
        [3, 4, 5, 6],
      ],
    };
    const rows = renderBoxRows(spec);
    assert.ok(rows.length > 0, `width ${width} draws`);
    for (const row of rows) {
      assert.ok(
        Number.isInteger(row.width) && row.width > 0 && row.width <= width,
        `width ${width}: row declares ${row.width}`,
      );
      assert.ok(cols(runsText(row.runs)) <= row.width, `width ${width}: "${runsText(row.runs)}" is too wide`);
    }
  }
});

check("two renders of one spec are identical", () => {
  for (const spec of [skewedSpec, widthsSpec, { ...widthsSpec, height: 4, title: "same" }]) {
    assert.deepEqual(renderBoxRows(spec), renderBoxRows(spec));
  }
});

check("height is the total block, and hidden boxes are reported", () => {
  const labels = Array.from({ length: 6 }, (_, index) => `s${index}`);
  const values = labels.map((_, index) => [index, index + 1, index + 2, index + 3]);
  const spec = { type: "box", width: 40, height: 5, labels, values };
  const rows = renderBoxRows(spec);
  assert.ok(rows.length <= 5, `height 5 drew ${rows.length} rows`);
  assert.ok(textRows(rows).some((row) => /boxes? hidden/.test(row)), "the footer names the boxes it left out");
});

console.log(`\n${checks}/${checks} checks passed`);
