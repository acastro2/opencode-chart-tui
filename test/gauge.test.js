import assert from "node:assert/strict";

import { SOLID, cols, runsText } from "../src/core.js";
import { renderGaugeRows } from "../src/gauge.js";
import { styleOf } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const gaugeRow = (spec) => renderGaugeRows(spec)[0];
const gaugeText = (spec) => runsText(gaugeRow(spec).runs);

/** The display column a run starts at. */
const offsetOf = (runs, index) => runs.slice(0, index).reduce((sum, run) => sum + cols(run.text), 0);

/** The cells of the bar: the fill and the marker are the value, the rest is track. */
const barCells = (runs) => runs.filter((run) => run.kind === "fill" || run.kind === "line").reduce((sum, run) => sum + cols(run.text), 0);

check("a gauge row is exactly as wide as the spec asks", () => {
  const cases = [
    { label: "Coverage", value: 62, max: 100 },
    { label: "A longish label", value: 140, max: 100, target: 75 },
    { label: "Throughput", value: 123456789, max: 1 },
    { label: "", value: 0, max: 100 },
    { label: "Done", value: 0.4, max: 1, target: 0.5 },
    { label: "スループット", value: 37, max: 100, target: 75 },
    { label: "x", value: 99.9, max: 100, target: 100 },
    { label: "Coverage", value: 62, max: 100, target: 120 },
    { label: "Coverage", value: 62, max: 100, target: -5 },
  ];
  for (const width of [16, 24, 48]) {
    for (const spec of cases) {
      const rows = renderGaugeRows({ ...spec, width });
      assert.equal(cols(textRows(rows)[0]), width, `the gauge row is ${width} cells: ${JSON.stringify(textRows(rows)[0])}`);
      for (const row of textRows(rows)) {
        assert.ok(cols(row) <= width, `row fits in ${width}: ${JSON.stringify(row)}`);
        assert.ok(!row.includes("NaN") && !row.includes("undefined"), "no placeholder text leaks into the row");
      }
    }
  }
});

check("a long value is cut, never allowed to push the row", () => {
  // value / max that spells out fifteen cells of percentage.
  const spec = { width: 16, label: "Throughput", value: 123456789, max: 1 };
  const row = gaugeRow(spec);
  const value = row.runs.find((run) => run.kind === "label");
  assert.ok(value, "the value is still drawn, just shorter");
  assert.ok(value.text.trimEnd().endsWith("…"), `the value says it was cut: ${JSON.stringify(value.text)}`);
  assert.equal(cols(runsText(row.runs)), 16, "the whole row still fits");

  // A value too long for the row is cut at every width that cannot hold it; the
  // row itself is always exactly the width asked for.
  for (const width of [16, 24, 48]) {
    const rows = renderGaugeRows({ ...spec, width });
    assert.equal(cols(textRows(rows)[0]), width, `the row is ${width} cells, never more`);
    if (width === 16) assert.ok(!textRows(rows)[0].includes("12345678900.0%"), "the full value is not drawn past the width");
  }
});

check("target 0 marks the first cell of the bar", () => {
  const row = gaugeRow({ width: 24, label: "x", value: 0, max: 100, target: 0 });
  const index = row.runs.findIndex((run) => run.kind === "target");
  assert.ok(index >= 0, "a target of zero still draws a marker");
  assert.equal(row.runs[index].text, "│");
  // The label block is " x " (three cells), so the bar starts at column 3.
  assert.equal(offsetOf(row.runs, index), 3, "the marker sits on the first bar cell");
  assert.ok(runsText(row.runs).includes("target 0"));
});

check("a target on the fractional end of the bar keeps that glyph", () => {
  const row = gaugeRow({ width: 40, value: 62, max: 100, target: 62 });
  const runs = row.runs;
  const fill = runs.filter((run) => run.kind === "fill" && run.slice === 0).map((run) => run.text).join("");
  const edge = [...fill].at(-1);
  assert.ok(edge !== SOLID, `the bar ends on a partial glyph (${JSON.stringify(edge)})`);

  const index = runs.findIndex((run) => run.kind === "target");
  assert.ok(index >= 0, "the marker is drawn next to the fraction, not instead of it");
  assert.ok(runsText(runs).includes(`${edge}│`), "the partial glyph still touches the marker");
  assert.equal(offsetOf(runs, index), cols(fill), "the marker is the cell right after the fill");
  assert.equal(runs.filter((run) => run.kind === "line").length, 0, "nothing is painted over the fill");
});

check("a target already passed is a line over the bar, not a lost block", () => {
  const spec = { width: 40, label: "x", value: 90, max: 100, target: 40 };
  const row = gaugeRow(spec);
  const runs = row.runs;
  const lines = runs.filter((run) => run.kind === "line");
  assert.equal(lines.length, 1, "one line marks the target");
  assert.equal(lines[0].text, "│");
  assert.equal(runs.filter((run) => run.kind === "target").length, 0, "the marker is not on the track");
  // The bar is 20 cells and the value fills 18 of them; the line replaces one
  // of those cells, so the filled length still reads as 18.
  assert.equal(barCells(runs), 18, "the fill length is unchanged by the marker");
  assert.equal(offsetOf(runs, runs.findIndex((run) => run.kind === "line")), 3 + 8, "the line is at the target column");
});

check("a target outside the scale is clamped and noted", () => {
  const barKinds = ["fill", "line", "target", "track"];
  const barOf = (runs) => {
    const start = runs.findIndex((run) => barKinds.includes(run.kind));
    const width = runs.filter((run) => barKinds.includes(run.kind)).reduce((sum, run) => sum + cols(run.text), 0);
    return { start, width };
  };

  const high = gaugeRow({ width: 48, label: "Coverage", value: 62, max: 100, target: 120 });
  const highText = textRows(renderGaugeRows({ width: 48, label: "Coverage", value: 62, max: 100, target: 120 }));
  assert.ok(highText.some((row) => row.includes("target 120 clamped to 100")), `the clamp is explained (${highText.join(" / ")})`);
  // Clamped to the maximum, so the marker is the bar's last cell.
  const highBar = barOf(high.runs);
  const highMark = high.runs.findIndex((run) => run.kind === "target" || run.kind === "line");
  assert.equal(offsetOf(high.runs, highMark), offsetOf(high.runs, highBar.start) + highBar.width - 1, "the clamped marker is at the end of the bar");

  const low = gaugeRow({ width: 48, label: "Coverage", value: 62, max: 100, target: -5 });
  const lowText = textRows(renderGaugeRows({ width: 48, label: "Coverage", value: 62, max: 100, target: -5 }));
  assert.ok(lowText.some((row) => row.includes("target -5 clamped to 0")), "a negative target is explained");
  const lowBar = barOf(low.runs);
  assert.equal(offsetOf(low.runs, lowBar.start), 10, "the bar starts after the label");
  // Zero is under the fill here, so it is drawn as the line over the bar.
  assert.ok(["line", "target"].includes(low.runs[lowBar.start].kind), "the clamped marker is the bar's first cell");

  const odd = textRows(renderGaugeRows({ width: 40, value: 40, target: "soon" }));
  assert.ok(odd.some((row) => row.includes("target is not a number")), "an unreadable target is named, not guessed");
  assert.ok(!odd[0].includes("│"), "an unreadable target draws no marker");
});

check("the value is a label with a background, not a bare fill", () => {
  const run = gaugeRow({ width: 40, label: "Coverage", value: 62, max: 100 }).runs.find((item) => item.kind === "label");
  assert.ok(run, "the value run is a label");
  assert.equal(run.slice, 0, "it is tied to the series colour");
  const style = styleOf(run);
  assert.ok(typeof style.bg === "string" && style.bg.startsWith("#"), `the label has a background (${style.bg})`);
  assert.ok(style.fg !== style.bg, "the foreground contrasts with the background");
});

check("a progress bar fills in proportion", () => {
  for (const [value, max] of [[0.4, 1], [0.25, 1], [0.75, 1], [1, 1], [0, 1]]) {
    const runs = gaugeRow({ width: 40, label: "Done", value, max }).runs;
    const filled = runs.filter((run) => run.kind === "fill").reduce((sum, run) => sum + cols(run.text), 0);
    const track = runs.filter((run) => run.kind === "track").reduce((sum, run) => sum + cols(run.text), 0);
    const total = filled + track;
    assert.ok(total > 0, "the bar has cells");
    assert.ok(Math.abs(filled / total - value / max) <= 1 / total, `${filled}/${total} matches ${value}/${max} within a cell`);
  }
});

check("a CJK label is cut by display width", () => {
  const row = gaugeRow({ width: 16, label: "スループット", value: 37, max: 100 });
  const label = row.runs[0];
  assert.equal(label.kind, "axis");
  assert.ok(label.text.startsWith(" ") && label.text.endsWith(" "), "the label block keeps its padding");
  const trimmed = label.text.trim();
  assert.ok(trimmed.endsWith("…"), `the label is cut with an ellipsis (${JSON.stringify(trimmed)})`);
  assert.ok("スループット".startsWith(trimmed.slice(0, -1)), "the label starts from the real text");
  assert.equal(cols(runsText(row.runs)), 16, "the row still fits");
});

console.log(`\n${checks}/${checks} checks passed`);
