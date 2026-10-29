import assert from "node:assert/strict";

import { cols, runsText } from "../src/core.js";
import { renderDotRows } from "../src/dot.js";
import { styleOf } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
/** The column of the dot in a data row, or -1 when it draws none. */
const dotAt = (text) => text.indexOf("●");

check("a dot sits at the value's fraction of the plot", () => {
  for (const width of [16, 30, 40, 60]) {
    const text = textRows(
      renderDotRows({ width, labels: ["zero", "half", "max"], values: [0, 50, 100] }),
    );
    const start = dotAt(text[0]);
    const half = dotAt(text[1]);
    const end = dotAt(text[2]);
    const middle = start + (end - start) / 2;
    assert.ok(start >= 0 && half >= 0 && end >= 0, `all three dots are drawn at width ${width}`);
    assert.equal(end, width - 1, `the largest value sits on the last column at width ${width}`);
    assert.ok(Math.abs(half - middle) <= 1, `half the maximum is the middle, within a cell (${half} vs ${middle})`);
  }
});

check("sort ranks by value and keeps every label on its own dot", () => {
  const sorted = textRows(
    renderDotRows({ width: 40, labels: ["small", "big", "mid"], values: [10, 90, 50], sort: true }),
  );
  assert.match(sorted[0], /big/, "the largest value is first");
  assert.match(sorted[1], /mid/, "the middle value is second");
  assert.match(sorted[2], /small/, "the smallest value is last");
  const dots = sorted.slice(0, 3).map(dotAt);
  assert.ok(dots[0] > dots[1] && dots[1] > dots[2], `the dots descend with the values (${dots})`);

  const given = textRows(renderDotRows({ width: 40, labels: ["small", "big", "mid"], values: [10, 90, 50] }));
  assert.match(given[0], /small/, "without sort the fence order is kept");
  assert.match(given[1], /big/);
});

check("the axis and the dot rows share one left offset", () => {
  const rows = renderDotRows({ width: 40, labels: ["a", "bb", "ccc"], values: [0, 50, 100] });
  const text = textRows(rows);
  const axis = text[text.length - 1];
  const zero = dotAt(text[0]);
  const max = dotAt(text[2]);

  // Every name cell is the same width, and that width is where the plot starts.
  for (const row of rows.slice(0, 3)) {
    const name = row.runs[0];
    assert.equal(name.kind, "axis", "the name is axis furniture");
    assert.equal(cols(name.text), zero, "the name cell ends where the plot starts");
  }
  assert.equal(axis.indexOf("0"), zero, "the zero tick starts under the zero dot");
  assert.equal(axis.indexOf("100") + 3 - 1, max, "the last tick ends under the largest dot");
  const ticks = axis.trim().split(/\s+/);
  assert.ok(ticks.length >= 3 && ticks.length <= 5, `the axis carries 3 to 5 ticks (${ticks.length})`);
  assert.ok(cols(axis) <= 40, "the tick row fits the chart");

  // A range whose first step is too coarse for three marks asks for a finer one.
  const decimals = textRows(renderDotRows({ width: 24, labels: ["build", "test"], values: [9.2, 6.1] }));
  const fine = decimals[decimals.length - 1].trim().split(/\s+/);
  assert.ok(fine.length >= 3, `a decimal scale still gets three or more ticks (${fine})`);
});

check("a zero value puts the dot on the axis start", () => {
  const rows = textRows(renderDotRows({ width: 40, labels: ["zero", "ten"], values: [0, 10] }));
  const start = dotAt(rows[0]);
  assert.ok(start > 0, "the dot sits after the name column");
  assert.equal(rows[rows.length - 1].indexOf("0"), start, "the zero tick starts under the zero dot");
  assert.equal(dotAt(rows[1]), 39, "the largest value ends the plot");

  const negative = renderDotRows({ width: 40, labels: ["below", "above"], values: [-5, 10] });
  const negativeText = textRows(negative);
  assert.equal(dotAt(negativeText[0]), cols(negative[0].runs[0].text), "a value below zero stays on the plot's first column");
  assert.equal(dotAt(negativeText[0]), negativeText[negativeText.length - 1].indexOf("0"), "it sits on the zero tick");
});

check("an empty spec says no data", () => {
  for (const spec of [{}, { width: 40 }, { width: 40, labels: [], values: [] }]) {
    const text = textRows(renderDotRows(spec));
    assert.equal(text.length, 1, "one row, not a blank chart");
    assert.match(text[0], /^ {2}no data/, `the row says why it is empty (${JSON.stringify(text[0])})`);
  }
});

check("every row fits at 16 and at 60", () => {
  const cases = [
    { labels: ["alpha", "beta", "gamma"], values: [100, 50, 0] },
    { labels: ["a very long category name", "b"], values: [7, 3], valueLabels: true },
    { labels: ["スループット", "負荷"], values: [40, 80], sort: true, valueLabels: true },
    { labels: ["x"], values: [1234567], title: "Largest" },
    { labels: ["a", "b", "c", "d", "e"], values: [1, "x", null, 4, 5] },
  ];
  for (const width of [16, 60]) {
    for (const spec of cases) {
      for (const row of renderDotRows({ ...spec, width })) {
        const text = runsText(row.runs);
        assert.ok(cols(text) <= width, `a ${width}-cell row fits (${JSON.stringify(text)})`);
        assert.equal(row.width, width, "the row declares the chart's width");
        assert.ok(!text.includes("NaN") && !text.includes("undefined"), "no placeholder text leaks into the row");
      }
    }
  }
});

check("value labels are off by default and sit right of the plot when asked", () => {
  const off = textRows(renderDotRows({ width: 40, labels: ["a"], values: [25] }))[0];
  assert.ok(!off.includes("25"), `the value is not printed by default (${JSON.stringify(off)})`);

  const on = textRows(renderDotRows({ width: 40, labels: ["a"], values: [25], valueLabels: true }))[0];
  assert.ok(on.endsWith("25"), `the value is printed on the right (${JSON.stringify(on)})`);
  assert.equal(on.trimEnd().length, 40, "the chart still ends at its width");

  // A value too wide to leave the plot its minimum room is dropped, not squeezed in.
  const tight = textRows(renderDotRows({ width: 16, labels: ["alpha"], values: [123456789], valueLabels: true }));
  assert.ok(!tight[0].includes("123456789"), "the value column gives way to the plot");
  assert.ok(cols(tight[0]) <= 16, "the row still fits");
});

check("each dot is a fill with its row's slice", () => {
  const rows = renderDotRows({ width: 40, labels: ["a", "b", "c"], values: [30, 20, 10] });
  const dots = rows.slice(0, 3).map((row) => row.runs.find((run) => run.text === "●"));
  dots.forEach((dot, index) => {
    assert.equal(dot.kind, "fill", "the dot is a mark, not furniture");
    assert.equal(dot.slice, index, "the dot takes its row's palette entry");
  });
  const fg = dots.map((dot) => styleOf(dot).fg);
  assert.equal(new Set(fg).size, 3, "three rows get three colours");
});

check("height pays for the title and the tick row before the dots", () => {
  const spec = {
    width: 40,
    height: 6,
    title: "Rank",
    labels: ["a", "b", "c", "d", "e", "f", "g", "h"],
    values: [8, 7, 6, 5, 4, 3, 2, 1],
  };
  const text = textRows(renderDotRows(spec));
  assert.equal(text.length, 6, "the block is exactly as tall as the fence asked");
  assert.equal(text[0], "Rank", "the title comes first");
  assert.ok(dotAt(text[text.length - 1]) < 0, "the last row is the tick row, not a dot");
  assert.equal(text.filter((row) => row.includes("●")).length, 4, "four dots get the four plot rows");
});

check("the same spec draws the same rows and leaves its input alone", () => {
  const labels = ["a", "b", "c"];
  const values = [3, 1, 2];
  const spec = { width: 48, labels, values, sort: true };
  assert.deepEqual(renderDotRows(spec), renderDotRows(spec), "two renders agree");
  assert.deepEqual(labels, ["a", "b", "c"], "the labels are not reordered in place");
  assert.deepEqual(values, [3, 1, 2], "the values are not reordered in place");
});

check("a blank value is a zero, the way the dot policy says", () => {
  const text = textRows(renderDotRows({ width: 40, labels: ["gone", "bad", "ok"], values: [null, "x", 10] }));
  assert.equal(dotAt(text[0]), dotAt(text[1]), "a blank and an unreadable value both land on zero");
  assert.ok(dotAt(text[2]) > dotAt(text[0]), "a real value still moves right");
  assert.ok(!text.join(" ").includes("NaN"), "an unreadable value never reaches a row");
});

console.log(`\n${checks}/${checks} checks passed`);
