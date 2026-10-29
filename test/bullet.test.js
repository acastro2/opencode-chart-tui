import assert from "node:assert/strict";

import { cols, runsText } from "../src/core.js";
import { renderBulletRows } from "../src/bullet.js";
import { THEMES, styleOf } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

/** Plot cells only: the bands, the bar and the tick, in drawing order. */
const PLOT_KINDS = new Set(["fill", "target", "series", "track", "outside"]);

/** The target tick's glyph: the one mark that is never a band and never a bar. */
const TICK = "│";

const textRows = (rows) => rows.map((row) => runsText(row.runs));

const plotCells = (row) =>
  row.runs
    .filter((run) => PLOT_KINDS.has(run.kind))
    .flatMap((run) => [...run.text].map((char) => ({ char, kind: run.kind })));

const count = (cells, predicate) => cells.filter(predicate).length;

const filled = (cells) => count(cells, (cell) => cell.kind === "fill");

/** The tick's position in the plot, found by its glyph so the run kind is free. */
const tickAt = (cells) => cells.findIndex((cell) => cell.char === TICK);

const lastRow = (rows) => runsText(rows[rows.length - 1].runs);

check("a row is the label, the track and the value, exactly as wide as the fence", () => {
  const row = renderBulletRows({ width: 40, labels: ["Rev"], values: [50], max: 100 })[0];
  const text = runsText(row.runs);

  assert.equal(cols(text), 40, `the row is 40 cells: ${JSON.stringify(text)}`);
  assert.equal(row.width, 40, "the row says how wide it is");
  assert.ok(text.startsWith(" Rev  "), `the label is a gutter with a space either side: ${JSON.stringify(text)}`);
  assert.ok(text.endsWith(" 50"), "the value column closes the row");
  // 40 - 6 (label) - 3 (value) = 31 track cells; half of 31 rounds to 16.
  assert.equal(count(plotCells(row), (cell) => cell.char === "█"), 16, "the bar covers half the track");
  assert.equal(count(plotCells(row), (cell) => cell.char === "░"), 15, "the rest is track");
});

check("the bar length follows the value", () => {
  for (const [value, max] of [[50, 100], [25, 100], [80, 200], [3, 4], [0, 100]]) {
    const cells = plotCells(renderBulletRows({ width: 40, labels: ["Revenue"], values: [value], max })[0]);
    const expected = Math.round((value / max) * cells.length);
    assert.ok(cells.length > 10, "the row leaves a real track to measure");
    assert.equal(filled(cells), expected, `${value}/${max} fills ${expected} of ${cells.length} cells`);
  }
});

check("the target tick sits at the target fraction of the track", () => {
  for (const [target, fraction] of [[0, 0], [25, 0.25], [50, 0.5], [100, 1]]) {
    const cells = plotCells(renderBulletRows({ width: 40, labels: ["Revenue"], values: [0], targets: [target], max: 100 })[0]);
    const tick = tickAt(cells);
    assert.ok(tick >= 0, `a target of ${target} draws a tick`);
    assert.equal(cells[tick].char, TICK, "the tick is a vertical rule");
    assert.equal(tick, Math.min(cells.length - 1, Math.floor(fraction * cells.length)), `the tick is at ${fraction} of the track`);
  }
});

check("a tick inside the bar is drawn over it, not under it", () => {
  const row = renderBulletRows({ width: 40, labels: ["Rev"], values: [90], targets: [40], max: 100 })[0];
  const cells = plotCells(row);
  const tick = tickAt(cells);
  const end = filled(cells);

  assert.ok(tick > 0 && tick < end, `the tick (${tick}) lands inside the bar (${end})`);
  assert.equal(count(row.runs, (run) => run.kind === "fill"), 2, "the notch splits the fill into two runs");
  assert.equal(count(cells, (cell) => cell.char === "█"), end, "the bar's length still reads through the notch");
});

check("every bar is one palette colour, and the bands keep their own", () => {
  const spec = { width: 44, labels: ["Revenue", "Cost", "NPS"], values: [72, 40, 81], targets: [100, 50, 90], ranges: [[0, 50], [50, 100]], max: 100 };
  for (const theme of [THEMES.dark, THEMES.light]) {
    const runs = renderBulletRows({ ...spec, theme: theme.name }).flatMap((row) => row.runs);
    const colour = (run) => styleOf(run, theme.palette, theme).fg;
    const bars = runs.filter((run) => run.kind === "fill");
    const bands = runs.filter((run) => run.kind === "track" || run.kind === "outside");

    assert.ok(bars.length >= 3, `every row draws a bar (${bars.length})`);
    assert.deepEqual(new Set(bars.map(colour)), new Set([theme.palette[0]]), `${theme.name}: one bar colour, the first palette entry`);
    assert.ok(bands.length >= 3, `the bands are still drawn under and past the bars (${bands.length})`);
    assert.ok(bands.every((run) => colour(run) !== theme.palette[0]), "no band takes the bar colour");
  }
});

check("the target tick is its own contrasting run", () => {
  const theme = THEMES.dark;
  const runs = renderBulletRows({ width: 44, labels: ["Revenue"], values: [72], targets: [80], max: 100 })[0].runs;
  const tick = runs.find((run) => run.text.includes(TICK));
  const bar = runs.find((run) => run.kind === "fill");

  assert.ok(tick && bar, "the row draws both marks");
  assert.notEqual(tick.kind, "fill", "the tick is not part of the bar run");
  const colour = (run) => styleOf(run, theme.palette, theme).fg;
  assert.notEqual(colour(tick), colour(bar), "the tick does not read as one more bar");
  assert.notEqual(colour(tick), theme.muted, "the tick is not the bands' muted tone it is drawn across");

  const bare = renderBulletRows({ width: 44, labels: ["Revenue"], values: [72], max: 100 })[0];
  assert.equal(count(bare.runs, (run) => run.text.includes(TICK)), 0, "no target, no tick run");
});

check("a value above max is clamped and counted in a note", () => {
  const rows = renderBulletRows({ width: 40, labels: ["Revenue", "Cost"], values: [50, 150], max: 100 });
  const short = plotCells(rows[0]);
  const long = plotCells(rows[1]);

  assert.equal(long.length, short.length, "both rows share one track");
  assert.equal(filled(long), long.length, "an over-max value fills the track");
  assert.ok(filled(short) < filled(long), "the in-scale row stays shorter");
  assert.equal(rows.length, 3, "one note row, not one note per item");
  assert.match(lastRow(rows), /1 value clamped to max 100/, `the clamp is explained: ${JSON.stringify(lastRow(rows))}`);
  assert.ok(textRows(rows)[1].includes("150"), "the value column keeps the number as written");
});

check("two range bands shade differently and the bar sits on top of them", () => {
  const row = renderBulletRows({ width: 44, labels: ["Revenue"], values: [30], max: 100, ranges: [[0, 50], [50, 100]] })[0];
  const cells = plotCells(row);
  const end = filled(cells);
  const bands = cells.filter((cell) => cell.kind === "track");

  assert.equal(new Set(bands.map((cell) => cell.char)).size, 2, "each band has its own shade");
  assert.ok(new Set(bands.map((cell) => cell.char)).has("▓"), "the lowest band is the densest");
  assert.ok(new Set(bands.map((cell) => cell.char)).has("▒"), "the upper band is lighter");
  assert.ok(cells.slice(0, end).every((cell) => cell.kind === "fill" && cell.char === "█"), "the bar covers the start of the track");
  assert.equal(cells[end].kind, "track", "the band is still there where the bar stops");
  assert.equal(cells[end].char, "▓", "the band under the bar continues past it");
  assert.ok(cells.slice(end).some((cell) => cell.char === "▒"), "the upper band is visible past the bar");
});

check("three ranges run dark to light along the track", () => {
  // No tick and no bar: this measures the bands alone, one cell per shade.
  const cells = plotCells(
    renderBulletRows({ width: 60, labels: ["Rev"], values: [0], max: 100, ranges: [[0, 40], [40, 70], [70, 100]] })[0],
  );
  const order = [...new Set(cells.filter((cell) => cell.kind === "track").map((cell) => cell.char))];
  assert.deepEqual(order, ["▓", "▒", "░"], "the shades run from the lowest band to the highest");
  for (const [char, fraction] of [["▓", 0.4], ["▒", 0.3], ["░", 0.3]]) {
    const seen = count(cells, (cell) => cell.kind === "track" && cell.char === char);
    assert.ok(Math.abs(seen - fraction * cells.length) <= 1, `${char} covers ${fraction} of the track (${seen}/${cells.length})`);
  }
});

check("a range that cannot be read is dropped, not drawn", () => {
  // Every shape that is not a rising pair of numbers: not an array at all, too
  // short, not numeric, empty and reversed. Only the last entry is a range, so
  // the track must look exactly as it does with that one range alone.
  const ranges = [null, 7, [0], ["a", 10], [0, "b"], [5, 5], [9, 1], [0, 100]];
  const spec = { width: 44, labels: ["Rev"], values: [30], max: 100 };
  const rows = renderBulletRows({ ...spec, ranges });
  assert.deepEqual(rows, renderBulletRows({ ...spec, ranges: [[0, 100]] }), "the junk entries change nothing");

  const cells = plotCells(rows[0]);
  assert.deepEqual(
    [...new Set(cells.filter((cell) => cell.kind === "track").map((cell) => cell.char))],
    ["▓"],
    "the one readable range shades the whole track",
  );
  assert.equal(count(cells, (cell) => cell.kind === "outside"), 0, "nothing sits outside it");
});

check("no targets means no tick and no slash", () => {
  for (const targets of [undefined, []]) {
    const row = renderBulletRows({ width: 40, labels: ["Revenue"], values: [72], targets, max: 100 })[0];
    const text = runsText(row.runs);
    assert.equal(count(row.runs, (run) => run.text.includes(TICK)), 0, "no tick run");
    assert.ok(!text.includes(TICK), "no tick is drawn");
    assert.ok(!text.includes("/"), `the value stands alone: ${JSON.stringify(text)}`);
    assert.ok(text.endsWith(" 72"), "the value column still reports the value");
  }
});

check("the value column reports the actual and the target, right aligned", () => {
  const rows = renderBulletRows({ width: 48, labels: ["Revenue", "Cost"], values: [72, 5], targets: [100, 100], max: 100 });
  const [first, second] = textRows(rows);

  assert.ok(first.endsWith(" 72 → 100"), `the actual and the target: ${JSON.stringify(first)}`);
  assert.ok(second.endsWith("  5 → 100"), "a shorter value is padded so the arrows line up");
  for (const row of rows) assert.equal(cols(runsText(row.runs)), 48, "the value column never pushes the row");
});

check("empty says no data", () => {
  const bare = renderBulletRows({ width: 40 });
  assert.equal(bare.length, 1, "one row says everything");
  assert.equal(runsText(bare[0].runs), "  no data", "the sentence is indented like a note");
  assert.equal(bare[0].width, 40);

  const titled = renderBulletRows({ width: 40, title: "Coverage", labels: [], values: [] });
  assert.deepEqual(textRows(titled), ["Coverage", "  no data"], "a title still leads the block");
});

check("every row fits at 24 and 60 cells", () => {
  const spec = {
    labels: ["Revenue", "A long label that will not fit", "スループット"],
    values: [72, 150, 0],
    targets: [100, 90, 20],
    ranges: [[0, 60], [60, 100]],
    max: 100,
  };
  for (const width of [24, 60]) {
    for (const row of renderBulletRows({ ...spec, width })) {
      const text = runsText(row.runs);
      assert.equal(row.width, width, "the row declares the width it was drawn at");
      assert.ok(cols(text) <= width, `${width}: ${cols(text)} cells in ${JSON.stringify(text)}`);
      assert.ok(!text.includes("NaN") && !text.includes("undefined"), "no placeholder text leaks into the row");
    }
  }
});

check("a tight height drops items instead of rows", () => {
  const rows = renderBulletRows({ width: 40, height: 3, labels: ["One", "Two", "Three", "Four"], values: [1, 2, 3, 4] });
  assert.equal(rows.length, 3, "the block stops at the height asked for");
  assert.ok(!textRows(rows).join(" ").includes("Four"), "the rows that do not fit are not drawn");

  const clamped = renderBulletRows({ width: 40, height: 4, labels: ["One", "Two", "Three", "Four"], values: [1, 2, 3, 150], max: 100 });
  assert.ok(clamped.length <= 4, `a note is paid for, not added: ${clamped.length} rows`);
  assert.ok(textRows(clamped).some((text) => text.includes("clamped")), "the note still fits");
});

check("the same spec renders the same rows twice", () => {
  const spec = { width: 44, labels: ["Revenue", "Cost"], values: [72, 40], targets: [100, 50], ranges: [[0, 50], [50, 100]], max: 100 };
  assert.deepEqual(renderBulletRows(spec), renderBulletRows(spec));
});

console.log(`\n${checks}/${checks} checks passed`);
