// Slope: two fixed columns, one line per category, on one shared value axis.
//
// The checks read the plain-text render, so they prove what a reader sees: every
// mark lands in one of two columns whatever its value, the line between the two
// dots is unbroken, and a rise and a fall carry different palette slices even
// where the glyphs are identical.

import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { renderSlopeRows } from "../src/slope.js";
import { PALETTES, styleOf } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const DOTS = "◆";
const LINES = "─╱╲│";
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** The display columns that carry one of `glyphs`, wide labels included. */
const columnsOf = (text, glyphs) => {
  const found = [];
  let column = 0;
  for (const cell of [...text]) {
    if (glyphs.includes(cell)) found.push(column);
    column += cols(cell);
  }
  return found;
};

/**
 * The block as cells, indexed by display column. Every glyph these checks meet —
 * letters, digits, the marks and the line's own glyphs — is one cell wide, which
 * is what makes a plain array index safe here.
 */
const cellsOf = (texts) => texts.map((text) => [...text]);
const glyphAt = (cells, x, y) => cells[y]?.[x] ?? "";
const rowFor = (texts, label) => texts.find((text) => text.includes(label)) ?? "";
const lineRuns = (row) => row.runs.filter((run) => run.kind === "fill");
const lineSlice = (row) => lineRuns(row)[0]?.slice;

/** Every mark in the block, as `[column, row]`. */
const marksOf = (cells) => {
  const marks = [];
  cells.forEach((row, y) => row.forEach((glyph, x) => {
    if (glyph === DOTS) marks.push([x, y]);
  }));
  return marks;
};

/** The columns every mark shares: this chart's two, at most. */
const markColumns = (texts) => [...new Set(marksOf(cellsOf(texts)).map(([x]) => x))].sort((a, b) => a - b);

/** True when one of the line's own glyphs sits next to the cell (x, y). */
const touchesMark = (cells, x, y) =>
  NEIGHBOURS.some(([dx, dy]) => {
    const glyph = glyphAt(cells, x + dx, y + dy);
    return glyph !== "" && LINES.includes(glyph);
  });

/**
 * True when the line glyphs starting at `from` reach a mark in column `x`. The
 * walk is 8-connected, which is how a step to the next row is drawn, so an
 * unbroken connector is exactly a path that arrives at the far mark.
 */
const reachesMark = (cells, from, x) => {
  const key = (cx, cy) => `${cx},${cy}`;
  const seen = new Set([key(from[0], from[1])]);
  const queue = [from];
  while (queue.length > 0) {
    const [cx, cy] = queue.pop();
    for (const [dx, dy] of NEIGHBOURS) {
      const glyph = glyphAt(cells, cx + dx, cy + dy);
      const next = key(cx + dx, cy + dy);
      if (glyph === "" || seen.has(next)) continue;
      if (glyph === DOTS && cx + dx === x) return true;
      if (!LINES.includes(glyph)) continue;
      seen.add(next);
      queue.push([cx + dx, cy + dy]);
    }
  }
  return false;
};

const change = {
  type: "slope",
  labels: ["Alpha", "Beta"],
  series: [
    { name: "Before", values: [40, 65] },
    { name: "After", values: [55, 60] },
  ],
};

check("every mark lands in one of two columns, whatever its value", () => {
  const texts = textRows(renderSlopeRows({ ...change, width: 60 }));
  const cells = cellsOf(texts);
  const columns = markColumns(texts);

  assert.equal(columns.length, 2, `two columns and no others (${columns.join(", ")})`);
  assert.equal(marksOf(cells).length, 4, "four marks: a before and an after for each category");
  for (const column of columns) {
    assert.equal(marksOf(cells).filter(([x]) => x === column).length, 2, `one mark per category in ${column}`);
  }

  // The before marks share a column even though 40 and 65 are far apart: a point
  // no longer sits at its own value's x.
  const beforeRow = texts.findIndex((text) => text.includes("Alpha"));
  const before = glyphAt(cells, columns[0], beforeRow);
  assert.equal(before, DOTS, "the first category starts in the first column");
  assert.equal(glyphAt(cells, columns[1], beforeRow), "", "and nothing marks its value's old x");
});

check("a rise, a fall and no change paint with different slices", () => {
  const rows = renderSlopeRows({ ...change, width: 60 });
  const byLabel = (label) => rows.find((row) => runsText(row.runs).includes(label));

  assert.equal(lineSlice(byLabel("Alpha")), 0, "40 → 55 is a rise, slice 0");
  assert.equal(lineSlice(byLabel("Beta")), 1, "65 → 60 is a fall, slice 1");

  // The slice is the colour: the theme palette turns it into the foreground of
  // the `fill` run, so two directions must produce two different colours.
  const up = styleOf(lineRuns(byLabel("Alpha"))[0]);
  const down = styleOf(lineRuns(byLabel("Beta"))[0]);
  assert.equal(up.fg, PALETTES.dark[0]);
  assert.equal(down.fg, PALETTES.dark[1]);
  assert.notEqual(up.fg, down.fg, "the two directions are not the same colour");
});

check("the connector touches both marks and never breaks between them", () => {
  const texts = textRows(renderSlopeRows({ ...change, width: 60 }));
  const cells = cellsOf(texts);
  const [left, right] = markColumns(texts);

  for (const label of ["Alpha", "Beta"]) {
    const y = texts.findIndex((text) => text.includes(label));
    assert.equal(glyphAt(cells, left, y), DOTS, `${label} starts in the before column`);
    assert.ok(touchesMark(cells, left, y), `${label} has line next to its before mark`);
    assert.ok(reachesMark(cells, [left, y], right), `${label} draws one line from its left dot to its right dot`);
  }
});

check("the series names sit under their own columns", () => {
  const texts = textRows(renderSlopeRows({ ...change, width: 60 }));
  const [left, right] = markColumns(texts);
  const names = texts.find((text) => text.includes("Before") && text.includes("After")) ?? "";
  assert.ok(names !== "", "one row names both series");
  assert.ok(texts.indexOf(names) > texts.findIndex((text) => text.includes("Alpha")), "it is under the plot");

  const centre = (label) => names.indexOf(label) + (cols(label) - 1) / 2;
  assert.ok(Math.abs(centre("Before") - left) <= 1, `the first name is under the first column (${centre("Before")})`);
  assert.ok(Math.abs(centre("After") - right) <= 1, `the second name is under the last column (${centre("After")})`);

  const quiet = textRows(renderSlopeRows({ ...change, width: 60, legend: false }));
  assert.ok(!quiet.some((text) => text.includes("Before")), "legend: false drops the names");
});

check("each number sits beside its own mark, and both go when they do not fit", () => {
  const wide = textRows(renderSlopeRows({ ...change, width: 60 }));
  const [left, right] = markColumns(wide);
  const cells = cellsOf(wide);

  wide.forEach((text, y) => {
    if (glyphAt(cells, left, y) === DOTS) {
      assert.match(glyphAt(cells, left - 2, y), /[0-9]/, `a before number is left of the mark: ${text}`);
      assert.equal(glyphAt(cells, left - 1, y), " ", "with one cell of air");
    }
    if (glyphAt(cells, right, y) === DOTS) {
      assert.match(glyphAt(cells, right + 2, y), /[0-9]/, `an after number is right of the mark: ${text}`);
      assert.equal(glyphAt(cells, right + 1, y), " ", "with one cell of air");
    }
  });

  const narrow = textRows(renderSlopeRows({ ...change, width: 24 }));
  assert.ok(!narrow.some((text) => /[0-9]/.test(text)), "no numbers beside a narrow plot");
  assert.equal(marksOf(cellsOf(narrow)).length, 4, "and every mark is still drawn");
});

check("a value that does not move draws a flat line in slice 2", () => {
  const rows = renderSlopeRows({
    width: 40,
    labels: ["Stay"],
    series: [
      { name: "Before", values: [5] },
      { name: "After", values: [5] },
    ],
  });
  const text = textRows(rows).find((row) => row.includes("Stay")) ?? "";
  const stay = rows.find((row) => runsText(row.runs).includes("Stay"));

  assert.equal(columnsOf(text, DOTS).length, 2, "both ends are still marked");
  assert.equal(lineSlice(stay), 2, "no change is slice 2");
  assert.ok(columnsOf(text, "─").length > 2, "the connector is level");
  assert.equal(columnsOf(text, "╱").length + columnsOf(text, "╲").length, 0, "with no direction to show");
});

check("a slope needs exactly two series", () => {
  const cases = [
    [{ name: "Only", values: [1, 2] }],
    [
      { name: "a", values: [1] },
      { name: "b", values: [2] },
      { name: "c", values: [3] },
    ],
    undefined,
  ];
  for (const series of cases) {
    const texts = textRows(renderSlopeRows({ labels: ["x", "y"], series, width: 40 }));
    assert.equal(texts[0], "  no data", "the chart refuses to guess a before and an after");
    assert.match(texts.join("\n"), /two series/, "and says why");
  }
});

check("every row fits the chart at 24 and 60, and the same spec draws the same frame", () => {
  const spec = { ...change, labels: ["A really long category name that cannot fit any gutter", "Beta"] };
  for (const width of [24, 60]) {
    const rows = renderSlopeRows({ ...spec, width });
    assert.deepEqual(rows.map((row) => row.runs), renderSlopeRows({ ...spec, width }).map((row) => row.runs));
    for (const row of rows) {
      assert.equal(row.width, width, "the row carries the chart width");
      const text = runsText(row.runs);
      assert.ok(cols(text) <= width, `row fits ${width} cells (${cols(text)}): ${text}`);
    }
    assert.equal(marksOf(cellsOf(textRows(rows))).length, 4, "both marks survive a long label");
  }

  const long = textRows(renderSlopeRows({ ...spec, width: 60 }));
  assert.ok(!long.some((text) => text.includes("cannot fit any gutter")), "the long label is cut to the gutter");
  assert.ok(long.some((text) => text.startsWith("A really")), "and kept at the left edge");
});

check("height is a row budget", () => {
  const rows = renderSlopeRows({ ...change, width: 40, height: 8 });
  assert.ok(rows.length <= 8, `the block stays inside the height (${rows.length})`);
});

check("a blank or unreadable value is drawn as zero, per the slope policy", () => {
  const texts = textRows(
    renderSlopeRows({
      width: 40,
      labels: ["A"],
      series: [
        { name: "Before", values: [null] },
        { name: "After", values: ["x"] },
      ],
    }),
  );
  assert.match(rowFor(texts, "A"), /0\s+◆/, "the before value reads as zero");
  assert.match(texts.join("\n"), /◆ 0/, "and so does the after value");
});

check("a label that collides on a row is counted, and both lines still draw", () => {
  const texts = textRows(
    renderSlopeRows({
      width: 40,
      labels: ["One", "Two"],
      series: [
        { name: "Before", values: [10, 10] },
        { name: "After", values: [30, 20] },
      ],
    }),
  );
  const note = texts.find((text) => text.includes("hidden")) ?? "";
  assert.match(note, /1 label hidden/, "the second label says so instead of sitting beside another line");
  assert.equal(marksOf(cellsOf(texts)).length, 3, "the shared before mark and both after marks");
  assert.match(texts.join("\n"), /◆ 30/);
  assert.match(texts.join("\n"), /◆ 20/);
});

check("a series without a name or a values list still reads", () => {
  // A bare array is the series' own numbers; an entry with no `name` is named by
  // the position it holds, so the names row never prints an empty label.
  const bare = renderSlopeRows({ width: 40, series: [[1, 2], [3, 4]] });
  const names = textRows(bare).find((text) => text.includes("series 1")) ?? "";
  assert.ok(names.includes("series 1") && names.includes("series 2"), `the positions name them: ${names}`);

  // An object with no `values` holds nothing, so its end of the line is zero.
  const empty = textRows(
    renderSlopeRows({ width: 40, labels: ["a"], series: [{ name: "x" }, { name: "y", values: [4] }] }),
  );
  assert.match(rowFor(empty, "a"), /0\s+◆/, "a series with no values reads as zero, per the policy");

  // Two entries that are not objects at all: no values and no names to use.
  assert.deepEqual(textRows(renderSlopeRows({ width: 40, series: [null, null] })), ["  no data"], "nothing to join");

  // An unset width falls back to the default rather than to NaN.
  const plain = renderSlopeRows({ series: [[1], [2]] });
  assert.equal(plain[0].width, 60, "an unset width is 60 cells");
});

check("an empty slope says so", () => {
  const texts = textRows(
    renderSlopeRows({
      width: 40,
      labels: [],
      series: [
        { name: "Before", values: [] },
        { name: "After", values: [] },
      ],
    }),
  );
  assert.equal(texts[0], "  no data");
});

console.log(`\n${checks}/${checks} checks passed`);
