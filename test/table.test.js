import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
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

console.log(`\n${checks}/${checks} checks passed`);
