import assert from "node:assert/strict";

import { runsText } from "../src/core.js";
import { normalizeBoard, renderKanbanRows } from "../src/kanban.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];

const spec = {
  type: "kanban",
  width: 52,
  columns: [
    { title: "Todo", cards: [{ title: "Ship the sankey", meta: "Alex · today" }, { title: "Write tests" }] },
    { title: "Doing", cards: [{ title: "Review the treemap", meta: "Priya" }] },
    { title: "Done", cards: [{ title: "Radar" }] },
  ],
};

check("a column carries its title and its count", () => {
  const text = textRows(renderKanbanRows(spec));
  assert.ok(text.some((row) => row.includes("Todo (2)")), "the header counts the cards in the column");
  assert.ok(text.some((row) => row.includes("Doing (1)")));
  assert.ok(text.some((row) => row.includes("Done (1)")));
});

check("a long title wraps inside its card instead of being cut", () => {
  const short = textRows(renderKanbanRows({ ...spec, width: 26, columnWidth: 20, columns: [{ title: "Todo", cards: [{ title: "Ship" }] }] }));
  const long = textRows(
    renderKanbanRows({ ...spec, width: 26, columnWidth: 20, columns: [{ title: "Todo", cards: [{ title: "Ship the sankey chart now" }] }] }),
  );
  assert.ok(long.length > short.length, `a wrapped card is taller (${long.length} vs ${short.length})`);
  for (const row of long) assert.ok(cellsOf(row).length <= 26, "a wrapped card stays inside the chart");
});

check("every row is the chart width", () => {
  for (const width of [30, 52, 70]) {
    for (const row of textRows(renderKanbanRows({ ...spec, width }))) {
      assert.ok(cellsOf(row).length <= width, `row fits in ${width}: ${JSON.stringify(row)}`);
    }
  }
});

check("a card takes its own colour and a plain card takes its column's", () => {
  const rows = renderKanbanRows({
    ...spec,
    columns: [{ title: "Todo", cards: [{ title: "Ship it", color: "#ff8c42" }, { title: "Plain" }] }],
  });
  const colours = rows.flatMap((row) => row.runs).filter((run) => run.kind === "fill").map((run) => run.color);
  assert.ok(colours.includes("#ff8c42"), `the declared card colour is used (${colours.join(",")})`);
  assert.ok(
    colours.some((colour) => colour && colour !== "#ff8c42" && colour.startsWith("#")),
    "a card without a colour takes its column's",
  );
});

check("a board that does not fit reports what it dropped", () => {
  const tight = textRows(renderKanbanRows({ ...spec, height: 6 }));
  assert.ok(tight.some((row) => row.includes("more")), "the board says how many cards it dropped");
  // Silently hiding cards would make the chart lie.
  const roomy = textRows(renderKanbanRows({ ...spec, height: 20 }));
  assert.ok(!roomy.some((row) => row.includes("more")), "a board with room drops nothing");
});

check("an empty board says so", () => {
  // A fresh spec, not a spread: spreading the full board would keep its columns.
  for (const empty of [{ columns: [] }, {}]) {
    const rows = textRows(renderKanbanRows({ width: 40, ...empty }));
    assert.ok(rows.some((row) => row.includes("no data")), "an empty board is named, not blank");
  }
});

check("a declared column width is honoured", () => {
  const rows = textRows(renderKanbanRows({ ...spec, width: 52, columnWidth: 16 }));
  const corners = rows.flatMap((row) => [...row].flatMap((cell, x) => (cell === "╭" ? [x] : [])));
  assert.ok(corners.includes(0), "the first column starts at the left edge");
  assert.ok(corners.includes(17), `the second column starts after the first (corner columns ${corners.join(",")})`);
});

check("meta lines are muted, not bold like the title", () => {
  const rows = renderKanbanRows(spec);
  const muted = rows.flatMap((row) => row.runs).filter((run) => run.kind === "legend" && run.text.includes("Alex"));
  // Three columns make the inner width narrow, so the title wraps; the first
  // line is the one to look for.
  const titled = rows.flatMap((row) => row.runs).filter((run) => run.kind === "title" && run.text.includes("Ship"));
  assert.equal(muted.length, 1, "the meta line is drawn as a muted run");
  assert.equal(titled.length, 1, "the title is drawn as a title run");
});

check("a flat card list groups by column and can be ordered", () => {
  const board = normalizeBoard({
    cards: [
      { column: "Todo", title: "a" },
      { column: "Doing", title: "b" },
      { column: "Todo", title: "c" },
    ],
    order: ["Doing", "Todo"],
  });
  assert.equal(board.columns.length, 2);
  assert.equal(board.columns[0].title, "Doing", "the order comes first");
  assert.equal(board.columns[0].cards.length, 1);
  assert.equal(board.columns[1].title, "Todo");
  assert.equal(board.columns[1].cards.length, 2);

  const flat = textRows(renderKanbanRows({ width: 40, ...board }));
  assert.ok(flat.some((row) => row.includes("Doing (1)")));
  assert.ok(flat.some((row) => row.includes("Todo (2)")));
});

check("the drawing only uses box glyphs and text", () => {
  for (const row of textRows(renderKanbanRows(spec))) {
    for (const cell of cellsOf(row)) {
      // Corners, edges, the rule, text, the count brackets, the wrap marker and
      // the separator only.
      if (cell === " " || "╭╮╰╯─│…·()".includes(cell) || /[0-9A-Za-z]/.test(cell)) continue;
      assert.ok(false, `"${cell}" is not a kanban glyph`);
    }
  }
});

console.log(`\n${checks}/${checks} checks passed`);
