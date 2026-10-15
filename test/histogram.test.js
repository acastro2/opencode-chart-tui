import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
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

check("an empty histogram says so", () => {
  const rows = textRows(renderHistogramRows({ type: "histogram", width: 30, values: [] }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

console.log(`\n${checks}/${checks} checks passed`);
