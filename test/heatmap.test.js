import assert from "node:assert/strict";
import { cols, mixOklab, runsText } from "../src/core.js";
import { normalizeGrid, renderHeatmapRows } from "../src/heatmap.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
// The matrix cells of a row: a painted cell, a labelled cell, or a hole.
const cellsOf = (row) =>
  row.runs.filter((run) => run.kind === "cell" || run.kind === "label" || run.kind === "outside");

check("a rectangular matrix, one cell per header", () => {
  const grid = normalizeGrid({ headers: ["a", "b"], rows: [{ label: "r", values: [1, 2, 3] }] });
  assert.deepEqual(grid.columns, ["a", "b"]);
  assert.deepEqual(grid.rows[0].values, [1, 2, 3], "normalization keeps what the fence said");

  const rows = renderHeatmapRows({
    type: "heatmap",
    width: 40,
    headers: ["a", "b"],
    rows: [{ label: "r1", values: [1, 2, 3, 4, 5] }, { label: "r2", values: [1, 2] }],
    scale: false,
  });
  for (const row of rows.filter((entry) => entry !== rows[0] && entry.runs[0]?.kind === "axis")) {
    assert.equal(cellsOf(row).length, 2, "one cell per header");
  }
  const text = textRows(rows);
  assert.ok(text.some((row) => row.includes("values for 2 headers; row 1 has 5")), text.join(" | "));
  assert.ok(!text.some((row) => row.includes("row 2 has")), "a row that matches needs no note");
});

check("a short row is padded with holes and noted", () => {
  const rows = renderHeatmapRows({
    type: "heatmap",
    width: 40,
    headers: ["a", "b", "c", "d"],
    rows: [{ label: "r", values: [1] }],
    scale: false,
  });
  const cells = cellsOf(rows[1]);
  assert.equal(cells.length, 4, "four cells, one per header");
  assert.equal(cells.filter((cell) => cell.kind === "outside").length, 3, "three of them are empty");
  assert.ok(textRows(rows).some((row) => row.includes("values for 4 headers; row 1 has 1")));

  // No headers: the longest row sets the count.
  const headerless = renderHeatmapRows({ type: "heatmap", width: 40, rows: [[1, 2], [3]], scale: false });
  assert.equal(cellsOf(headerless[1]).length, 2);
  assert.ok(textRows(headerless).some((row) => row.includes("values for 2 columns; row 2 has 1")));
});

check("the header sits on its cells, measured in display width", () => {
  const rows = renderHeatmapRows({
    type: "heatmap",
    width: 40,
    cellWidth: 4,
    headers: ["東京", "ab"],
    rows: [{ label: "r", values: [1, 2] }],
    scale: false,
  });
  const header = rows[0].runs[1].text;
  assert.equal(header, "東京  ab", "each header cell is four display cells");
  assert.equal(header.length, 6, "six UTF-16 units");
  assert.equal(cols(header), 8, "but eight terminal cells");
  const cells = cellsOf(rows[1]);
  assert.deepEqual(cells.map((cell) => cols(cell.text)), [4, 4]);
  assert.equal(cols(runsText(rows[1].runs)) - 3, cols(header), "the body starts where the header starts");

  // A wide glyph that cannot fit its cell is cut, never cut mid-surrogate.
  const tight = renderHeatmapRows({
    type: "heatmap",
    width: 24,
    cellWidth: 2,
    headers: ["東京", "京都"],
    rows: [{ label: "r", values: [1, 2] }],
    scale: false,
  });
  assert.equal(cols(tight[0].runs[1].text), 4, "two cells of two");
  assert.equal(cols(runsText(tight[1].runs)) - 3, 4, "and the body agrees");
});

check("a heat map never draws past its width", () => {
  const headers = Array.from({ length: 12 }, (_, index) => `h${index + 1}`);
  const values = Array.from({ length: 12 }, (_, index) => index + 1);
  for (let width = 16; width <= 40; width++) {
    const rows = renderHeatmapRows({
      type: "heatmap",
      width,
      headers,
      rows: [{ label: "row", values }, { label: "two", values: values.map((value) => value * 2) }],
      scale: false,
    });
    for (const row of rows) assert.ok(cols(runsText(row.runs)) <= width, `${width}: "${runsText(row.runs)}"`);
    const body = rows.filter((row) => row !== rows[0] && row.runs[0]?.kind === "axis");
    assert.equal(body.length, 2, "both data rows are drawn");
    const count = cellsOf(body[0]).length;
    for (const row of body) assert.equal(cellsOf(row).length, count, "the grid stays rectangular");
    assert.equal(cols(runsText(body[0].runs)), cols(runsText(rows[0].runs)), "the body and the header agree");

    // Beyond the width the tail is hidden, and said out loud.
    const hidden = 12 - count;
    if (hidden > 0) {
      assert.ok(
        textRows(rows).some((row) => row.includes(`${hidden} ${hidden === 1 ? "column" : "columns"} hidden`)),
        `width ${width}: ${textRows(rows).join(" | ")}`,
      );
    }
  }
});

check("a value that is not a number is a hole, not a zero", () => {
  const rows = renderHeatmapRows({
    type: "heatmap",
    width: 30,
    headers: ["a", "b"],
    rows: [{ label: "r", values: [0, "x"] }],
    scale: false,
  });
  assert.ok(textRows(rows).some((row) => row.includes("1 value is not a number")), textRows(rows).join(" | "));
  const cells = cellsOf(rows[1]);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].text.trim(), "0", "a real zero is drawn as a number");
  assert.equal(cells[1].kind, "outside", "a bad value claims no colour");
  assert.equal(cells[1].text.trim(), "", "and prints no number");
});

check("the scale names the range and fits the width", () => {
  for (const values of [[123456789, -987654321], [0, 1e9], [-1e9, -1], [3, 3]]) {
    for (const width of [16, 24, 48]) {
      const rows = renderHeatmapRows({ type: "heatmap", width, headers: ["a", "b"], rows: [{ label: "r", values }] });
      for (const row of rows) assert.ok(cols(runsText(row.runs)) <= width, `${width}: "${runsText(row.runs)}"`);
      const scale = textRows(rows).at(-1);
      assert.match(scale, /\d/, "the scale still names the range");
    }
  }
});

check("a row with no values is noted, and a malformed row does not throw", () => {
  // An empty row is dropped by the normalizer, so the note has to carry it.
  const empty = renderHeatmapRows({
    type: "heatmap",
    width: 40,
    headers: ["a", "b"],
    rows: [{ label: "ok", values: [1, 2] }, { label: "none", values: [] }],
    scale: false,
  });
  assert.ok(textRows(empty).some((row) => row.includes("1 row has no values")), textRows(empty).join(" | "));
  assert.equal(empty.filter((row) => row.runs[0]?.kind === "axis" && row.runs.length > 2).length, 1);

  // A scalar where a row belongs is a row with no values, not a `.map` crash.
  const flat = renderHeatmapRows({ type: "heatmap", width: 40, values: [[1, 2], 3], scale: false });
  assert.equal(cellsOf(flat[1]).length, 2, "the bad row still holds its shape");
  assert.ok(textRows(flat).some((row) => row.includes("values for 2 columns; row 2 has 0")));

  assert.doesNotThrow(() => renderHeatmapRows({ type: "heatmap", width: 40, series: [{ name: "s", values: [1] }, 5] }));
});

check("an explicit min and max pin the ramp", () => {
  const rows = renderHeatmapRows({
    type: "heatmap",
    width: 24,
    headers: ["a"],
    rows: [{ label: "r", values: [5] }],
    min: 0,
    max: 10,
    low: "#000000",
    high: "#ffffff",
  });
  const cell = cellsOf(rows[1])[0];
  assert.equal(cell.kind, "label");
  assert.equal(cell.color, mixOklab("#000000", "#ffffff", 0.5), "half of the pinned range is half the ramp");
  const scale = textRows(rows).at(-1);
  assert.match(scale, /0/, "the scale names the pinned floor");
  assert.match(scale, /10/, "and the pinned ceiling");
});

check("valueLabels false paints the cell instead of the number", () => {
  const rows = renderHeatmapRows({
    type: "heatmap",
    width: 20,
    headers: ["a"],
    rows: [{ label: "r", values: [1] }],
    valueLabels: false,
    scale: false,
  });
  const cells = cellsOf(rows[1]);
  assert.equal(cells.length, 1, "one cell under one header");
  assert.equal(cells[0].kind, "cell");
  assert.equal(cells[0].text.trim(), "", "the number is gone");
  assert.ok(cells[0].color, "the colour is still there");
});

check("a title and an empty grid still render", () => {
  const titled = renderHeatmapRows({ type: "heatmap", width: 24, title: "Heat", rows: [] });
  assert.equal(titled.length, 2, "the title and the no-data line");
  assert.equal(titled[0].runs[0].kind, "title");
  assert.match(textRows(titled)[0], /Heat/);
  assert.match(textRows(titled)[1], /no data/);
  for (const row of titled) assert.ok(cols(runsText(row.runs)) <= 24);
});

console.log(`\n${checks}/${checks} checks passed`);
