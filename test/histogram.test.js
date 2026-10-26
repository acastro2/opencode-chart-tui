import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { renderChartRows } from "../src/chart.js";
import { bin, binCount, binLabels, renderHistogramRows } from "../src/histogram.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];

check("bins cover the samples and count every one", () => {
  const values = [3, 7, 12, 12, 19, 24, 31, 44, 51, 68];
  const { bins, samples, min, max } = bin(values, 5);
  assert.equal(samples, values.length);
  assert.equal(bins.length, 5);
  assert.equal(
    bins.reduce((sum, item) => sum + item.count, 0),
    values.length,
    "every value lands in exactly one bin",
  );
  assert.ok(Math.abs(bins[0].from - min) < 1e-9, "the first bin starts at the minimum");
  assert.ok(Math.abs(bins[bins.length - 1].to - max) < 1e-9, "the last bin ends at the maximum");
  // The largest value is in the last bin, not dropped off the end of the range.
  assert.ok(bins[bins.length - 1].count >= 1, "the top value is counted");
  for (let index = 1; index < bins.length; index++) {
    assert.equal(bins[index].from, bins[index - 1].to, "bins share an edge");
  }
});

check("a repeated value does not divide by zero", () => {
  const { bins, width, samples } = bin([5, 5, 5, 5], 3);
  assert.equal(samples, 4);
  assert.ok(width > 0, `bin width ${width}`);
  assert.equal(
    bins.reduce((sum, item) => sum + item.count, 0),
    4,
  );
});

check("the bin count follows the square-root rule and honours a request", () => {
  assert.equal(binCount(100), 10);
  assert.equal(binCount(1000), 30, "capped so the bars stay readable");
  assert.equal(binCount(10, 4), 4);
  assert.equal(binCount(10, 0), 4, "a zero request falls back to the rule");
  assert.equal(binCount(1), 1);
});

check("bin edges read as ranges", () => {
  const { bins } = bin([0, 100], 4);
  const labels = binLabels(bins);
  assert.equal(labels.length, 4);
  assert.equal(labels[0], "0–25");
  assert.equal(labels[3], "75–100");
});

check("a histogram draws one bar per bin inside its width", () => {
  const values = Array.from({ length: 120 }, (_, index) => (index * 7919) % 500);
  const spec = { type: "histogram", width: 46, height: 8, values, bins: 12 };
  const rows = renderHistogramRows(spec);
  const text = textRows(rows);
  for (const row of text) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);

  // A bar is a group of contiguous columns that carry fill blocks.
  const columns = new Set();
  for (const [y, row] of rows.entries()) {
    let cursor = 0;
    for (const run of row.runs) {
      const length = cols(run.text);
      if ((run.kind === "fill" || run.kind === "label") && run.slice >= 0) {
        for (let x = cursor; x < cursor + length; x++) columns.add(`${x}:${y}`);
      }
      cursor += length;
    }
  }
  const xs = [...new Set([...columns].map((key) => Number(key.split(":")[0])))].sort((a, b) => a - b);
  const groups = [];
  for (const x of xs) {
    const last = groups[groups.length - 1];
    if (last && x - last[last.length - 1] <= 1) last.push(x);
    else groups.push([x]);
  }
  assert.equal(groups.length, 12, `one bar per bin, found ${groups.length}`);
});

check("the note reports the samples and the bin width", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8];
  const note = textRows(renderHistogramRows({ type: "histogram", width: 40, values, bins: 4 })).pop();
  assert.match(note, /8 values/);
  assert.match(note, /4 bins of 1\.75/);
  assert.equal(textRows(renderHistogramRows({ type: "histogram", width: 40, values, bins: 4, note: false })).length >= 2, true);
});

check("bin labels are thinned, never cut to one letter", () => {
  const values = Array.from({ length: 200 }, (_, index) => 500 + index * 3);
  const rows = textRows(renderHistogramRows({ type: "histogram", width: 46, height: 6, values, bins: 20 }));
  const labelRow = rows[rows.length - 2]; // the note is the last row
  const tokens = labelRow.split(/\s+/).filter(Boolean);
  assert.ok(tokens.length >= 2, `some labels survive: "${labelRow}"`);
  for (const token of tokens) {
    assert.ok(token.length >= 2, `"${token}" is a whole label, not a cut fragment`);
  }
});

check("bin ranges replace the left edges when the whole row fits", () => {
  const values = Array.from({ length: 120 }, (_, index) => (index * 7919) % 500);
  const spec = { type: "histogram", width: 56, height: 8, values, bins: 6 };
  const rows = textRows(renderHistogramRows(spec));
  const labelRow = rows[rows.findIndex((row) => row.includes("values,")) - 1];
  for (const label of binLabels(bin(values, 6).bins)) {
    assert.ok(labelRow.includes(label), `"${label}" is shown: "${labelRow}"`);
  }
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
});

check("a narrow histogram falls back to left edges and still fits", () => {
  const values = Array.from({ length: 120 }, (_, index) => (index * 7919) % 500);
  const spec = { type: "histogram", width: 16, height: 8, values, bins: 6 };
  const rows = textRows(renderHistogramRows(spec));
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
  const labelRow = rows[rows.findIndex((row) => row.includes("values,")) - 1];
  assert.ok(labelRow.trim().length > 0, `at least one label survives: "${labelRow}"`);
  assert.ok(!labelRow.includes("–"), `the ranges do not fit, so the edges stay: "${labelRow}"`);
});

check("a histogram reserves the hidden-bin row inside its height", () => {
  // 60 bins cannot fit 40 columns, so the bar layout has to hide most of them
  // and say so. That note is a row: the histogram has to budget it before it
  // hands the plot height over, or the block is one row too tall.
  const values = Array.from({ length: 120 }, (_, index) => (index * 7919) % 100);
  const spec = { type: "histogram", width: 40, height: 12, bins: 60, values };
  const rows = textRows(renderHistogramRows(spec));
  assert.equal(rows.length, 12, `the block is exactly ${spec.height} rows (${rows.length})`);
  assert.match(rows[rows.length - 2], /categories hidden/, "the hidden bins are named before the footer");
  assert.match(rows[rows.length - 1], /values,/, "the histogram footer is still the last row");
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
});

check("a titled histogram keeps title, plot, note and footer inside height", () => {
  const values = Array.from({ length: 120 }, (_, index) => (index * 7919) % 100);
  const spec = { type: "histogram", width: 40, height: 12, bins: 60, title: "Sizes", values };
  const rows = textRows(renderHistogramRows(spec));
  assert.equal(rows.length, 12, `the block is exactly ${spec.height} rows (${rows.length})`);
  assert.equal(rows[0], "Sizes");
  assert.match(rows[rows.length - 2], /categories hidden/);
});

check("the generic height guard never has to replace the histogram's note", () => {
  // The repro through the real entry point: at height 12 the guard used to trim
  // the hidden-category note and print "1 row hidden at height 12" instead.
  const values = Array.from({ length: 120 }, (_, index) => (index * 7919) % 100);
  const spec = { type: "histogram", width: 40, height: 12, bins: 60, values };
  const rows = renderChartRows(spec);
  const text = textRows(rows).join("\n");
  assert.equal(rows.length, 12, `the block is exactly ${spec.height} rows (${rows.length})`);
  assert.match(text, /categories hidden/, "the hidden-category note is the visible row");
  assert.doesNotMatch(text, /row hidden at height/, "the generic guard did not fire");
});

check("an empty histogram says so", () => {
  const rows = textRows(renderHistogramRows({ type: "histogram", width: 30, values: [] }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

console.log(`\n${checks}/${checks} checks passed`);
