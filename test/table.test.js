import assert from "node:assert/strict";
import { cols, mixOklab, runsText } from "../src/core.js";
import { columnWidths, exact, normalizeColumns, normalizeRows, renderTableRows } from "../src/table.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));

const spec = {
  type: "table",
  width: 56,
  title: "Accounts",
  columns: [
    { label: "Account" },
    { label: "ARR", type: "number" },
    { label: "Share", type: "bar" },
    { label: "Trend", type: "heat" },
  ],
  rows: [
    ["Globex", 4200, 42, 3],
    ["Initech", 3100, 31, 7],
    ["Umbrella", 2900, 29, 5],
    ["Soylent", 880, 9, 2],
  ],
};

check("numbers are exact and right-aligned", () => {
  assert.equal(exact(4200), "4,200");
  assert.equal(exact(-1500000), "-1,500,000");
  assert.equal(exact(880), "880");
  assert.equal(exact(12.5), "12.5");
  assert.equal(exact("n/a"), "n/a");

  const rows = textRows(renderTableRows(spec));
  assert.ok(rows.some((row) => row.includes("4,200")), "thousands separators survive");
  const ends = rows
    .filter((row) => /\d,\d{3}|\s+\d{2,3}\s/.test(row) && !row.startsWith("─"))
    .map((row) => row.indexOf("  ", row.indexOf("Account") + 1));
  assert.ok(ends.length >= 3);
});

check("column widths come from the content and shrink to fit", () => {
  const columns = normalizeColumns(spec);
  const rows = normalizeRows(spec, columns);
  const roomy = columnWidths(columns, rows, 80);
  const tight = columnWidths(columns, rows, 30);
  assert.ok(roomy.reduce((sum, value) => sum + value, 0) >= tight.reduce((sum, value) => sum + value, 0));
  assert.ok(tight.every((width) => width >= 4), "no column drops below the floor");
  assert.ok(tight.reduce((sum, value) => sum + value, 0) + 6 <= 30, "the tight table fits its chart");
  // A declared width wins.
  const declared = columnWidths(normalizeColumns({ columns: [{ label: "x", width: 12 }] }), [], 80);
  assert.deepEqual(declared, [12]);
});

check("every row is the same width and inside the chart", () => {
  for (const width of [40, 56, 80]) {
    const rows = textRows(renderTableRows({ ...spec, width }));
    const widths = new Set(rows.map((row) => cols(row)));
    for (const row of rows) assert.ok(cols(row) <= width, `"${row}" is ${cols(row)} of ${width}`);
    assert.ok(widths.size <= 2, `rows agree on a width, saw ${[...widths].join(",")}`);
  }
});

check("a bar cell is as long as its value", () => {
  const rows = textRows(renderTableRows(spec));
  const lengths = rows
    .filter((row) => /[█▏▎▍▌▋▊▉]/.test(row))
    .map((row) => cellsOfBlocks(row));
  assert.ok(lengths.length >= 4, `four bar cells, saw ${lengths.length}`);
  for (let index = 1; index < lengths.length; index++) {
    assert.ok(lengths[index] <= lengths[index - 1], `bar ${index} is not longer than the one above it`);
  }
  assert.ok(lengths[0] > lengths[lengths.length - 1], "the biggest value draws the longest bar");
});

// The filled part of a bar row, in cells: full blocks plus a partial one.
function cellsOfBlocks(row) {
  let filled = 0;
  for (const cell of row) {
    if (cell === "█") filled += 1;
    else if ("▏▎▍▌▋▊▉".includes(cell)) filled += 0.5;
  }
  return filled;
}

check("the exact number sits beside its bar", () => {
  const rows = textRows(renderTableRows(spec));
  assert.ok(rows.some((row) => row.includes("█████ 42")), "the bar is followed by its value");
  const narrow = textRows(
    renderTableRows({ ...spec, width: 34, columns: [{ label: "Account" }, { label: "ARR", type: "number" }, { label: "Share", type: "bar" }] }),
  );
  assert.ok(narrow.every((row) => cols(row) <= 34));
});

check("a heat cell carries its own colour", () => {
  const rows = renderTableRows(spec);
  // A bar column also labels its value, so the check is per row: every data row
  // carries at least one coloured cell, and the ramp paints them differently.
  const colouredRows = rows.filter((row) => row.runs.some((run) => run.kind === "label" && run.color));
  assert.equal(colouredRows.length, 4, "every data row carries a coloured cell");
  const colours = new Set(
    rows.flatMap((row) => row.runs).filter((run) => run.kind === "label" && run.color).map((run) => run.color),
  );
  assert.ok(colours.size >= 4, `the ramp varies with the value, saw ${colours.size} colours`);
});

check("explicit heat bounds set the ramp from the column or the fence", () => {
  const heat = (bounds, column = {}) =>
    renderTableRows({
      type: "table",
      width: 24,
      rules: false,
      columns: [{ label: "h", type: "heat", width: 4, ...column }],
      rows: [[0], [10]],
      ...bounds,
    });

  const bounded = heat({ low: "#102030", high: "#abcdef" });
  assert.equal(bounded[1].runs[0].color, mixOklab("#102030", "#abcdef", 0), "the fence low starts the ramp");
  assert.equal(bounded[2].runs[0].color, mixOklab("#102030", "#abcdef", 1), "the fence high ends the ramp");

  const byColumn = heat({ low: "#ffffff", high: "#000000" }, { low: "#102030", high: "#abcdef" });
  assert.equal(byColumn[1].runs[0].color, mixOklab("#102030", "#abcdef", 0), "a column's own low beats the fence");
  assert.equal(byColumn[2].runs[0].color, mixOklab("#102030", "#abcdef", 1), "a column's own high beats the fence");

  const themed = heat({});
  assert.notEqual(themed[1].runs[0].color, bounded[1].runs[0].color, "no bounds still uses the theme ramp");

  // The same value, two ramps: the colour has to move.
  const two = renderTableRows({
    type: "table",
    width: 24,
    rules: false,
    columns: [
      { label: "a", type: "heat", width: 3, low: "#000000", high: "#ffffff" },
      { label: "b", type: "heat", width: 3, low: "#ff0000", high: "#00ff00" },
    ],
    rows: [[5, 5], [5, 5]],
  });
  const colours = two.slice(1).map((row) => row.runs.filter((run) => run.color).map((run) => run.color));
  assert.equal(colours[0].length, 2, "two heat cells in one row");
  assert.notEqual(colours[0][0], colours[0][1], "the same value takes a different colour under a different ramp");
});

check("a missing number cell stays blank, not zero", () => {
  const missing = renderTableRows({
    type: "table",
    width: 24,
    columns: [{ label: "Name" }, { label: "N", type: "number" }],
    rows: [{ Name: "a" }, { Name: "b", N: 7 }],
  });
  const cells = missing.slice(2).map((row) => row.runs.at(-1).text);
  assert.equal(cells[0].trim(), "", `a missing number prints nothing: "${cells[0]}"`);
  assert.equal(cells[1].trim(), "7", "a real number still prints");

  // Undefined, null and "" are blank; a real numeric zero is not.
  const kinds = renderTableRows({
    type: "table",
    width: 24,
    columns: ["n", { label: "v", type: "number" }],
    rows: [["a", undefined], ["b", null], ["c", ""], ["d", 0]],
  });
  assert.deepEqual(
    kinds.slice(2).map((row) => row.runs.at(-1).text.trim()),
    ["", "", "", "0"],
    "blank stays blank and a real zero still prints",
  );

  // A blank bar or heat cell draws no mark and takes no colour.
  const painted = renderTableRows({
    type: "table",
    width: 24,
    columns: [{ label: "n" }, { label: "b", type: "bar" }, { label: "h", type: "heat", width: 4 }],
    rows: [["a"], ["b", 5, 5]],
  });
  const blank = painted[2].runs;
  assert.ok(blank.every((run) => !run.color), `a blank cell takes no colour: ${blank.map((run) => run.kind).join(",")}`);
  assert.ok(!/[█▏▎▍▌▋▊▉\d]/.test(runsText(blank)), `a blank bar draws nothing: "${runsText(blank)}"`);
  assert.ok(painted[3].runs.some((run) => run.kind === "fill"), "a row with a value still draws its bar");
});

check("a header, a rule and truncation", () => {
  const rows = textRows(renderTableRows(spec));
  assert.match(rows[1], /Account\s+ARR\s+Share\s+Trend/, "the header names every column");
  assert.match(rows[2], /^─+(\s+─+)+$/, "the rule is a dash per column");
  assert.equal(cols(rows[2]), cols(rows[1]), "the rule spans the header");

  const narrow = textRows(
    renderTableRows({
      type: "table",
      width: 28,
      columns: [{ label: "Customer name" }, { label: "ARR", type: "number" }],
      rows: [["Globex International Holdings", 4200]],
    }),
  );
  assert.ok(narrow.some((row) => row.includes("…")), `a long value is truncated: ${narrow.join("|")}`);
  assert.ok(narrow.every((row) => cols(row) <= 28));
});

check("rules can be turned off and an empty table says so", () => {
  const noRules = textRows(renderTableRows({ ...spec, rules: false }));
  assert.ok(!noRules.some((row) => /^─+(\s+─+)+$/.test(row)), "no rule row when rules are off");
  const empty = textRows(renderTableRows({ type: "table", width: 30, columns: ["a"], rows: [] }));
  assert.equal(empty.length, 1);
  assert.match(empty[0], /no data/);
});

check("a narrow table hides its tail instead of drawing past the width", () => {
  const narrow = {
    type: "table",
    width: 16,
    columns: ["a", "b", "c", "d", "e", "f", "g", "h"],
    rows: [["1", "2", "3", "4", "5", "6", "7", "8"]],
  };
  const columns = normalizeColumns(narrow);
  const widths = columnWidths(columns, normalizeRows(narrow, columns), 16);
  assert.equal(widths.length, 6, "six columns fit at one cell each");
  assert.ok(widths.every((value) => value >= 1), "no column is narrower than a cell");

  const rows = textRows(renderTableRows(narrow));
  for (const row of rows) assert.ok(cols(row) <= 16, `"${row}" is ${cols(row)} of 16`);
  assert.ok(rows.some((row) => row.includes("2 columns hidden")), rows.join(" | "));
});

check("no row is ever wider than the table", () => {
  const columns = ["Account", "ARR", "Share", "Trend", "Region", "Owner", "Notes", "Extra"];
  const rows = [
    ["Globex International Holdings", 4200, 42, 3, "EMEA", "Ana", "renewal due", 1],
    ["Initech", -3100, -31, 7, "APAC", "Bo", "churn risk", 2],
  ];
  for (let width = 16; width <= 80; width++) {
    for (const row of textRows(renderTableRows({ type: "table", width, columns, rows }))) {
      assert.ok(cols(row) <= width, `${width}: "${row}" is ${cols(row)}`);
    }
  }
});

check("a negative bar is drawn from the column's range", () => {
  const spec = {
    width: 40,
    columns: [{ label: "v" }, { label: "Delta", type: "bar", showValue: false }],
    rows: [["a", -10], ["b", -5], ["c", 0], ["d", 10]],
  };
  const lengths = textRows(renderTableRows(spec))
    .filter((row) => /^[a-d] /.test(row))
    .map((row) => cellsOfBlocks(row));
  assert.equal(lengths.length, 4, `four bar rows, saw ${lengths.length}`);
  assert.equal(lengths[0], 0, "the column's low end is an empty bar, as proportion says");
  assert.ok(lengths[1] > 0, `-5 draws a bar, saw ${lengths[1]}`);
  assert.ok(lengths[1] < lengths[2] && lengths[2] < lengths[3], `the bars grow with the value: ${lengths.join(",")}`);

  const numbers = textRows(
    renderTableRows({ width: 40, columns: [{ label: "v" }, { label: "Delta", type: "bar" }], rows: [["a", -10], ["b", -5]] }),
  );
  assert.ok(numbers.some((row) => row.includes("-10")), "the exact number stays beside its bar");
  assert.ok(numbers.some((row) => row.includes("-5")), "and so does the smaller one");
});

check("a long heat number stays inside its cell", () => {
  const rows = renderTableRows({
    width: 24,
    columns: [{ label: "Name" }, { label: "Trend", type: "heat", width: 4 }],
    rows: [["Globex", 123456789]],
  });
  const cells = rows.flatMap((row) => row.runs).filter((run) => run.kind === "label");
  assert.equal(cells.length, 1, "one heat cell");
  assert.equal(cols(cells[0].text), 4, "the cell is exactly its column");
  assert.equal(cells[0].text.trim(), "123M", "the compact form fits where the exact one cannot");
  assert.ok(!textRows(rows).some((row) => row.includes("123,456,789")), "the exact number does not break the column");
  for (const row of textRows(rows)) assert.ok(cols(row) <= 24, `"${row}" is ${cols(row)} of 24`);

  // Eight four-wide columns cannot fit 24 cells: every cell shrinks to one, and
  // a number that cannot be said in one cell paints the colour and says nothing.
  const heat = { label: "h", type: "heat" };
  const tiny = renderTableRows({
    width: 24,
    columns: Array.from({ length: 8 }, () => heat),
    rows: [Array.from({ length: 8 }, () => 123456789)],
  });
  assert.equal(tiny.flatMap((row) => row.runs).filter((run) => run.kind === "label").length, 0);
  assert.equal(tiny.flatMap((row) => row.runs).filter((run) => run.kind === "cell").length, 8);
  for (const row of textRows(tiny)) assert.ok(cols(row) <= 24, `"${row}" is ${cols(row)} of 24`);
});

check("a ragged row is padded, and both directions are noted", () => {
  const rows = renderTableRows({
    width: 30,
    columns: ["a", "b", "c"],
    rows: [["x", 1], ["y", 2, 3, 4]],
  });
  const text = textRows(rows);
  assert.ok(text.some((row) => row.includes("1 cell missing")), text.join(" | "));
  assert.ok(text.some((row) => row.includes("1 extra value ignored")), text.join(" | "));

  const data = rows.filter((row) => row.runs.some((run) => run.kind === "text"));
  assert.equal(data.length, 2);
  assert.equal(new Set(data.map((row) => cols(runsText(row.runs)))).size, 1, "every data row is the same width");
});

check("a number header is clipped, not padded past its column", () => {
  const rows = renderTableRows({
    width: 24,
    columns: [{ label: "Revenue (USD)", type: "number", width: 5 }, { label: "x" }],
    rows: [[1234, "a"]],
  });
  assert.equal(rows[0].runs[0].text, "Reve…", "the header takes the column's width");
  assert.equal(cols(rows[0].runs[0].text), 5);
  assert.equal(runsText(rows[2].runs), "1,234  a   ", "the number keeps its alignment");
  for (const row of textRows(rows)) assert.ok(cols(row) <= 24, `"${row}" is ${cols(row)} of 24`);
});

check("a column spec is read tolerantly", () => {
  const columns = normalizeColumns({
    columns: [
      "plain",
      { key: "arr", label: "ARR", type: "NUMBER", width: "12", color: "#f00", align: "right", showValue: false, low: "#000000", high: "#ffffff" },
      { label: "only-label" },
      {},
    ],
  });
  assert.equal(columns[0].key, "plain", "a name is both key and label");
  assert.equal(columns[0].label, "plain");
  assert.equal(columns[0].type, "text");
  assert.equal(columns[0].width, undefined);
  assert.equal(columns[1].type, "number", "the type is lowercased");
  assert.equal(columns[1].width, 12, "a declared width is a number");
  assert.equal(columns[1].key, "arr");
  assert.equal(columns[1].color, "#f00");
  assert.equal(columns[1].align, "right");
  assert.equal(columns[1].showValue, false);
  assert.equal(columns[1].low, "#000000", "a low bound is carried");
  assert.equal(columns[1].high, "#ffffff", "a high bound is carried");
  assert.equal(columns[0].low, undefined, "a named column carries no bounds");
  assert.equal(columns[2].key, "only-label", "a missing key falls back to the label");
  assert.equal(columns[3].key, "4", "a nameless column is its position");
  assert.equal(columns[3].label, "4");
  const nullColumn = normalizeColumns({ columns: [null] })[0];
  assert.equal(nullColumn.key, "1", "a null column is still a column");
  assert.equal(nullColumn.type, "text");
  assert.deepEqual(normalizeColumns({}), []);
});

check("an object row is read by key, then label", () => {
  const columns = normalizeColumns({ columns: [{ key: "k", label: "Label" }, { label: "only" }] });
  const rows = normalizeRows({ rows: [{ k: 1, only: 2 }, { Label: 3 }, { nothing: 4 }, [9, 8], null] }, columns);
  assert.deepEqual(rows, [[1, 2], [3, ""], ["", ""], [9, 8], ["", ""]]);
  assert.deepEqual(normalizeRows({}, columns), []);
});

check("a width comes from the content, with room for a bar", () => {
  const columns = normalizeColumns({ columns: [{ label: "abc" }, { label: "v", type: "bar" }, { label: "h", type: "heat" }] });
  assert.deepEqual(columnWidths(columns, [["abcdef", 10, 1]], 80), [6, 5, 4], "text, bar plus its number, heat at the floor");
  assert.deepEqual(columnWidths(normalizeColumns({ columns: [{ label: "x", width: 1 }] }), [], 80), [4], "a declared width cannot go below the floor");
  // No elastic column left: the difference comes out of every column above one cell.
  const numbers = normalizeColumns({
    columns: [{ label: "a", type: "number", width: 10 }, { label: "b", type: "number", width: 10 }],
  });
  assert.deepEqual(columnWidths(numbers, [], 20), [9, 9]);
});

check("alignment, colour and a bar that cannot be numbered", () => {
  const aligned = renderTableRows({
    width: 20,
    columns: [{ label: "name" }, { label: "note", align: "right" }],
    rows: [["ab", "cd"]],
  });
  assert.equal(runsText(aligned[2].runs), "ab      cd");
  assert.equal(aligned[2].runs.at(-1).text, "  cd", "a right-aligned text cell pads on the left");

  assert.equal(exact(undefined), "", "a missing number prints nothing");

  const bar = renderTableRows({ width: 30, columns: ["name", { label: "bar", type: "bar" }], rows: [["a", "n/a"], ["b", 5]] });
  const barText = bar.map((row) => runsText(row.runs));
  assert.ok(!barText.some((row) => row.includes("n/a")), "a value that is not a number draws no bar and no number");
  assert.ok(barText.every((row) => cols(row) <= 30));

  const coloured = renderTableRows({ width: 40, columns: [{ label: "b", type: "bar", color: "#123456" }], rows: [[5]] });
  assert.equal(coloured[2].runs[0].color, "#123456", "a bar column keeps its own colour");

  const heat = renderTableRows({ width: 30, columns: [{ label: "h", type: "heat", width: 4, color: "#00ff00" }], rows: [[0], [5]] });
  assert.equal(heat[2].runs[0].color, "#00ff00", "a heat column's low end is its own colour");
  assert.notEqual(heat[3].runs[0].color, "#00ff00", "and the high end is not");
});

check("the default width is 48 and the floor is 16", () => {
  const natural = renderTableRows({ columns: ["a"], rows: [["x"]] });
  assert.ok(natural.every((row) => row.width === 48), "no width means 48");
  const tiny = renderTableRows({ width: 1, columns: ["a"], rows: [["x"]] });
  assert.ok(tiny.every((row) => row.width === 16), "the chart floor is 16");
});

check("one hidden column is singular, and the notes count plurals", () => {
  const hidden = textRows(
    renderTableRows({ width: 16, columns: ["a", "b", "c", "d", "e", "f", "g"], rows: [["1", "2", "3", "4", "5", "6", "7"]] }),
  );
  assert.ok(hidden.some((row) => row.includes("1 column hidden")), hidden.join(" | "));
  const extra = textRows(renderTableRows({ width: 40, columns: ["a"], rows: [["x"], ["y", 1, 2]] }));
  assert.ok(extra.some((row) => row.includes("2 extra values ignored")), extra.join(" | "));
  const missing = textRows(renderTableRows({ width: 40, columns: ["a", "b"], rows: [["x"], ["y"]] }));
  assert.ok(missing.some((row) => row.includes("2 cells missing")), missing.join(" | "));
});

console.log(`\n${checks}/${checks} checks passed`);
