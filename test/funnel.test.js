import assert from "node:assert/strict";

import { cols, runsText } from "../src/core.js";
import { renderFunnelRows } from "../src/funnel.js";
import { styleOf, THEMES } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const fillCells = (row) => row.runs.filter((run) => run.kind === "fill").reduce((sum, run) => sum + cols(run.text), 0);
const percentOf = (text) => (text.match(/(\d+)%/) ?? [])[1];
const fillStart = (row) => {
  let offset = 0;
  for (const run of row.runs) {
    if (run.kind === "fill") return offset;
    offset += cols(run.text);
  }
  return -1;
};

/** A stage's rows: every drawn stage occupies the same number of rows. */
function bands(rows, stageCount) {
  const per = Math.floor(rows.length / stageCount);
  assert.ok(per >= 1, `${rows.length} rows cannot hold ${stageCount} stages`);
  return Array.from({ length: stageCount }, (_, index) => rows.slice(index * per, (index + 1) * per));
}

/** The texts of each stage's first row, which is the row that carries the numbers. */
const headTexts = (rows, stageCount) => bands(rows, stageCount).map((band) => runsText(band[0].runs));

check("a stage twice the value draws about twice the bar", () => {
  const rows = renderFunnelRows({ width: 40, labels: ["A", "B", "C"], values: [250, 500, 125] });
  const [first, second, third] = bands(rows, 3).map((band) => fillCells(band[0]));
  assert.ok(Math.abs(second - first * 2) <= 2, `500 draws twice 250: ${first} vs ${second}`);
  assert.ok(Math.abs(first - third * 2) <= 2, `250 draws twice 125: ${first} vs ${third}`);
});

check("the conversion is the share of the first stage", () => {
  const rows = renderFunnelRows({ width: 48, labels: ["Visit", "Signup", "Buy"], values: [1000, 500, 100] });
  assert.deepEqual(headTexts(rows, 3).map(percentOf), ["100", "50", "10"]);
});

check("a stage larger than the one before it draws and reports over 100%", () => {
  const rows = renderFunnelRows({ width: 48, labels: ["A", "B"], values: [100, 250] });
  assert.deepEqual(headTexts(rows, 2).map(percentOf), ["100", "250"]);
  const [first, second] = bands(rows, 2).map((band) => fillCells(band[0]));
  assert.ok(second > first, "the larger stage draws a longer bar");
});

check("every row of a stage paints the same bar, so the sides are vertical", () => {
  const rows = renderFunnelRows({ width: 58, labels: ["A", "B", "C"], values: [1000, 500, 100], height: 10 });
  for (const band of bands(rows, 3)) {
    const widths = band.map(fillCells);
    const starts = band.map(fillStart);
    assert.ok(widths.every((value) => value === widths[0]), `same bar width each row: ${widths}`);
    assert.ok(starts.every((value) => value === starts[0]), `same bar start each row: ${starts}`);
  }
});

check("a four-stage funnel at height 12 gives each stage at least two rows", () => {
  const rows = renderFunnelRows({
    width: 58,
    title: "Signup funnel",
    height: 12,
    labels: ["Visitors", "Signups", "Trials", "Paid"],
    values: [1000, 420, 180, 64],
  });
  assert.equal(runsText(rows[0].runs), "Signup funnel", "the title stays on its own row");
  const plot = rows.slice(1);
  assert.ok(plot.length <= 12, `the chart stays inside its height: ${plot.length}`);
  const perStage = plot.length / 4;
  assert.ok(perStage >= 2, `at least two rows per stage: ${perStage}`);
  assert.ok(Number.isInteger(perStage), `equal rows per stage: ${perStage}`);
  assert.deepEqual(plot.map(fillCells), [...plot.map(fillCells)].sort((a, b) => b - a), "the shape only narrows");
});

check("a four-stage funnel with no height still steps", () => {
  const rows = renderFunnelRows({ width: 58, labels: ["A", "B", "C", "D"], values: [1000, 420, 180, 64] });
  assert.ok(rows.length >= 8, `at least two rows per stage: ${rows.length}`);
  assert.ok(fillCells(rows[0]) > fillCells(rows[rows.length - 1]), "it ends narrower than it starts");
});

check("a descending funnel narrows monotonically down the silhouette", () => {
  const rows = renderFunnelRows({ width: 58, labels: ["Visitors", "Signups", "Trials", "Paid"], values: [1000, 420, 180, 64] });
  const widths = rows.map(fillCells);
  for (let index = 1; index < widths.length; index += 1) {
    assert.ok(widths[index] <= widths[index - 1], `row ${index} is no wider than the row above: ${widths}`);
  }
  assert.ok(widths[0] > widths[widths.length - 1], `the last stage is narrower: ${widths}`);
});

check("only a stage's first row carries the value and the conversion", () => {
  const rows = renderFunnelRows({ width: 48, labels: ["A", "B", "C"], values: [1000, 500, 100] });
  for (const band of bands(rows, 3)) {
    assert.ok(/[0-9]/.test(runsText(band[0].runs)), "the first row has the numbers");
    for (const row of band.slice(1)) {
      assert.ok(!/[0-9%]/.test(runsText(row.runs)), `a later row is bar only: ${JSON.stringify(runsText(row.runs))}`);
    }
  }
});

check("showPercent: false hides the conversion, valueLabels: false hides the value", () => {
  const noPercent = renderFunnelRows({ width: 40, labels: ["One", "Two"], values: [1000, 500], showPercent: false });
  assert.ok(textRows(noPercent).every((text) => !text.includes("%")), "no percent sign is left");
  assert.ok(headTexts(noPercent, 2)[0].includes("1k"), "the value is still drawn");

  const noValue = renderFunnelRows({
    width: 40,
    labels: ["One", "Two"],
    values: [1000, 500],
    valueLabels: false,
  });
  assert.equal(noValue.flatMap((row) => row.runs).filter((run) => run.kind === "label").length, 0, "no value run is left");
  assert.ok(textRows(noValue).every((text) => !text.includes("1k") && !text.includes("500")), "the numbers are gone");
  assert.ok(headTexts(noValue, 2)[1].includes("50%"), "the conversion is still drawn");

  const bare = textRows(
    renderFunnelRows({
      width: 40,
      labels: ["One", "Two"],
      values: [1000, 500],
      valueLabels: false,
      showPercent: false,
    }),
  );
  assert.ok(bare.every((text) => !/[0-9%]/.test(text)), "both columns hidden leaves the labels and bars only");
});

check("a height too small for two rows a stage falls back to one row", () => {
  const rows = renderFunnelRows({ width: 48, labels: ["A", "B", "C", "D"], values: [100, 75, 50, 25], height: 4 });
  assert.equal(rows.length, 4, "one row per stage");
  assert.deepEqual(textRows(rows).map(percentOf), ["100", "75", "50", "25"]);
});

check("hidden stages do not move the conversion base off the first stage", () => {
  const rows = renderFunnelRows({
    width: 48,
    labels: ["A", "B", "C", "D", "E", "F"],
    values: [100, 80, 60, 40, 20, 10],
    height: 4,
  });
  assert.equal(rows.length, 4, "only the stages the height holds are drawn");
  assert.deepEqual(textRows(rows).map(percentOf), ["100", "80", "60", "40"]);
});

check("no stages says no data", () => {
  const empty = renderFunnelRows({ width: 40, labels: [], values: [] });
  assert.equal(empty.length, 1);
  assert.equal(runsText(empty[0].runs), "  no data");
  assert.equal(empty[0].runs[0].kind, "legend");

  const invalid = renderFunnelRows({ width: 40, labels: ["A", "B", "C"], values: [null, "x", NaN] });
  assert.equal(invalid.length, 1);
  assert.ok(runsText(invalid[0].runs).includes("no data"), "unreadable values leave no stage to draw");
});

check("every row fits at 16, 40 and 80 cells", () => {
  for (const width of [16, 40, 80]) {
    const rows = textRows(
      renderFunnelRows({
        width,
        title: "Signup funnel",
        labels: ["Visitors to the site", "Signed up", "Purchased"],
        values: [1000, 500, 100],
      }),
    );
    for (const text of rows) {
      assert.ok(cols(text) <= width, `${width}: ${JSON.stringify(text)} is ${cols(text)} cells`);
      assert.ok(!text.includes("NaN") && !text.includes("undefined"), `${width}: no placeholder text leaks`);
    }
  }
});

check("the same fence draws the same rows", () => {
  const spec = { width: 40, labels: ["A", "B", "C"], values: [9, 5, 2] };
  assert.deepEqual(renderFunnelRows(spec), renderFunnelRows(spec));
});

check("each stage's bar carries the stage colour on every row", () => {
  const rows = renderFunnelRows({ width: 40, labels: ["A", "B", "C"], values: [3, 2, 1] });
  assert.equal(rows.flatMap((row) => row.runs).filter((run) => run.kind === "legend").length, 0, "no legend is drawn");
  bands(rows, 3).forEach((band, index) => {
    for (const row of band) {
      const fill = row.runs.find((run) => run.kind === "fill");
      assert.ok(fill, `stage ${index} draws a bar`);
      assert.equal(fill.slice, index, "the slice is the stage index");
      assert.equal(styleOf(fill).fg, THEMES.dark.palette[index], `stage ${index} keeps its colour`);
    }
  });
});

check("the bars centre in the plot area as they narrow", () => {
  const rows = renderFunnelRows({ width: 40, labels: ["A", "B", "C"], values: [1000, 500, 100] });
  const [first, second, third] = bands(rows, 3).map((band) => fillStart(band[0]));
  assert.ok(first < second && second < third, `each narrower bar starts later: ${[first, second, third]}`);
});

console.log(`\n${checks}/${checks} checks passed`);
