import assert from "node:assert/strict";

import { runsText } from "../src/core.js";
import { normalizeBoard, renderKanbanRows } from "../src/kanban.js";
import { displayWidth, graphemeWidth, graphemes } from "../src/text.js";

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

check("metaLines: 0 draws no meta line at all", () => {
  const rows = renderKanbanRows({
    width: 50,
    metaLines: 0,
    columns: [{ title: "Todo", cards: [{ title: "card", meta: "@ana" }] }],
  });
  const text = textRows(rows);
  assert.ok(!text.some((row) => row.includes("@ana")), `the meta line is gone (${text.join(" / ")})`);
  assert.equal(rows.flatMap((row) => row.runs).filter((run) => run.kind === "legend").length, 0, "no muted run is drawn");
  // Header, rule, then a card of two borders and one title row.
  assert.equal(text.length, 5, "a card with no meta is two rows shorter");
  assert.ok(text[4].includes("╰"), "the card still closes");
});

check("an overflow note never shares a row with a card", () => {
  // Nine rows of board: two three-row cards would fill rows 2-4 and 6-8, the
  // third is dropped, so the note has no free row of its own unless it is
  // reserved. It may cost a card, never a border.
  const text = textRows(
    renderKanbanRows({ width: 30, height: 9, columns: [{ title: "Todo", cards: [{ title: "a" }, { title: "b" }, { title: "c" }] }] }),
  );
  const noteAt = text.findIndex((row) => row.includes("…"));
  assert.ok(noteAt >= 0, `the drop is reported (${text.join(" / ")})`);
  const noteRow = text[noteAt];
  assert.ok(!/[╭╮╰╯│─]/.test(noteRow), `the note row holds no border: ${JSON.stringify(noteRow)}`);

  // The count is the report, so it must equal the cards that were not drawn.
  const drawn = [...text.join("")].filter((cell) => cell === "╭").length;
  assert.ok(drawn >= 1, "a card is still drawn");
  assert.ok(noteRow.includes(`… ${3 - drawn} more`), `the note counts exactly what it dropped: ${JSON.stringify(noteRow)}`);
  assert.ok(noteAt > text.findLastIndex((row) => row.includes("╰")), "the note sits below the last card");
});

check("a card that does not fit ends its column, so order is kept", () => {
  // Card 2 wraps past the board and card 3 is small enough to fit after it: a
  // later card must not jump the one that was dropped.
  const text = textRows(
    renderKanbanRows({
      width: 30,
      height: 9,
      columns: [
        {
          title: "Todo",
          cards: [{ title: "a" }, { title: "one two three four five six seven eight nine ten" }, { title: "lastcard" }],
        },
      ],
    }),
  );
  assert.ok(!text.some((row) => row.includes("lastcard")), `no card jumps the queue (${text.join(" / ")})`);
  assert.ok(!text.some((row) => row.includes("seven")), "the wrapped card did not fit");
  assert.ok(text.some((row) => row.includes("… 2 more")), "both dropped cards are counted");
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

check("explicit columns are read as written, gaps included", () => {
  const board = normalizeBoard({
    columns: [
      { title: "Todo", cards: [{ title: "a" }, { title: "b" }] },
      { label: "Doing", items: [{ title: "c" }] },
      {},
      { title: null, cards: null },
    ],
    // A declared column list wins over a flat card list; it is not merged.
    cards: [{ column: "Ignored", title: "flat" }],
  });
  assert.deepEqual(board.columns.map((column) => column.title), ["Todo", "Doing", "Column 3", "Column 4"], "a missing title is named by position");
  assert.deepEqual(board.columns.map((column) => column.cards.length), [2, 1, 0, 0], "a column without cards is empty, not dropped");
  assert.equal(board.columns[0].cards[0].title, "a");
  assert.deepEqual(normalizeBoard({ columns: [] }).columns, [], "an empty column list is a valid board");
  assert.deepEqual(normalizeBoard({ columns: "nope" }).columns, [], "a non-array column list is not a board");
});

check("a non-array `cards` does not hide a real `items` list", () => {
  const board = normalizeBoard({ columns: [{ title: "T", cards: "nope", items: [{ title: "via items" }] }] });
  assert.equal(board.columns[0].cards.length, 1);
  assert.equal(board.columns[0].cards[0].title, "via items");
});

check("a flat list groups by column, status or list, in first-seen order", () => {
  const board = normalizeBoard({
    cards: [
      { column: "Todo", title: "a" },
      { status: "Doing", title: "b" },
      { list: "Backlog", title: "c" },
      { title: "d" },
      { status: "Todo", title: "e" },
    ],
  });
  assert.deepEqual(board.columns.map((column) => column.title), ["Todo", "Doing", "Backlog", "Cards"], "a card with no key joins Cards");
  assert.deepEqual(board.columns.map((column) => column.cards.length), [2, 1, 1, 1]);
  assert.deepEqual(board.columns[0].cards.map((card) => card.title), ["a", "e"], "column and status share one key");
});

check("the declared order wins and a ghost title is ignored", () => {
  const board = normalizeBoard({
    cards: [{ column: "Todo", title: "a" }, { column: "Doing", title: "b" }],
    order: ["Doing", "Ghost"],
  });
  assert.deepEqual(board.columns.map((column) => column.title), ["Doing", "Todo"], "named first, then the rest in appearance order");
  assert.equal(board.columns[1].cards[0].title, "a");
});

check("an empty board has no columns at all", () => {
  for (const empty of [{}, { columns: [] }, { cards: [] }, { columns: null, cards: null }]) {
    assert.deepEqual(normalizeBoard(empty).columns, [], `no columns from ${JSON.stringify(empty)}`);
  }
});

check("a card that is not an object still becomes an empty card", () => {
  const board = normalizeBoard({ cards: [null, undefined, "str", 7, {}] });
  assert.equal(board.columns.length, 1, "everything with no column lands in the default column");
  assert.equal(board.columns[0].title, "Cards");
  assert.equal(board.columns[0].cards.length, 5, "a junk row is counted, not dropped");
  for (const card of board.columns[0].cards) assert.deepEqual(card, { title: "", meta: [], color: null });
});

check("a card title falls back through label and name, never to undefined", () => {
  const titleOf = (raw) => normalizeBoard({ cards: [raw] }).columns[0].cards[0].title;
  assert.equal(titleOf({ label: "lab" }), "lab");
  assert.equal(titleOf({ name: "nam" }), "nam");
  assert.equal(titleOf({ title: "", label: "lab" }), "", "an empty title is a value, not a miss");
  assert.equal(titleOf({ title: 7 }), "7", "a number title is stringified");
  assert.equal(titleOf({}), "", "a card with no name is empty, never the string undefined");
});

check("meta lines come from meta, then subtitle, and keep their order", () => {
  const metaOf = (raw) => normalizeBoard({ cards: [{ title: "t", ...raw }] }).columns[0].cards[0].meta;
  assert.deepEqual(metaOf({ meta: "one" }), ["one"]);
  assert.deepEqual(metaOf({ meta: ["a", 2] }), ["a", "2"], "every meta entry is a string");
  assert.deepEqual(metaOf({ subtitle: "sub" }), ["sub"]);
  assert.deepEqual(metaOf({ meta: [], subtitle: "ignored" }), [], "an empty meta wins over the subtitle");
  assert.deepEqual(metaOf({ meta: null, subtitle: "sub" }), ["sub"], "a null meta falls through to the subtitle");
  assert.deepEqual(metaOf({}), []);
});

check("a card colour is taken only when it is a string", () => {
  const colourOf = (color) => normalizeBoard({ cards: [{ title: "t", color }] }).columns[0].cards[0].color;
  assert.equal(colourOf("#ff8c42"), "#ff8c42");
  assert.equal(colourOf(5), null);
  assert.equal(colourOf(null), null);
});

check("cards with the same status share one column", () => {
  const board = normalizeBoard({
    cards: [{ column: "Todo", title: "a" }, { status: "Todo", title: "b" }, { list: "Todo", title: "c" }],
  });
  assert.equal(board.columns.length, 1, "one key, one column");
  assert.equal(board.columns[0].cards.length, 3);
  const text = textRows(renderKanbanRows({ width: 40, ...board }));
  assert.ok(text.some((row) => row.includes("Todo (3)")), "the header counts every card");
});

check("a CJK column name survives grouping and counting", () => {
  const board = normalizeBoard({
    cards: [
      { list: "進行中", title: "請求書を送る" },
      { list: "進行中", title: "短い" },
      { list: "完了", title: "x" },
    ],
  });
  assert.deepEqual(board.columns.map((column) => column.title), ["進行中", "完了"]);
  assert.deepEqual(board.columns.map((column) => column.cards.length), [2, 1]);
  const text = textRows(renderKanbanRows({ width: 40, ...board }));
  for (const row of text) assert.ok(displayWidth(row) <= 40, `row fits in 40: ${JSON.stringify(row)}`);
  assert.ok(text.some((row) => row.includes("進行中 (2)")), `a wide column name keeps its count (${text.join(" / ")})`);
});

check("an empty column still states its count", () => {
  const text = textRows(renderKanbanRows({ width: 40, columns: [{ title: "Todo", cards: [{ title: "a" }] }, { title: "Done" }] }));
  assert.ok(text.some((row) => row.includes("Todo (1)")));
  assert.ok(text.some((row) => row.includes("Done (0)")), `a column with no cards says zero (${text.join(" / ")})`);
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

/** Every display column a glyph starts at, so a wide glyph cannot hide a shift. */
const columnsOf = (row, glyph) => {
  let column = 0;
  const found = [];
  for (const part of graphemes(row)) {
    if (part === glyph) found.push(column);
    column += graphemeWidth(part);
  }
  return found;
};

const corners = (rows) => rows.reduce((count, row) => count + [...row].filter((cell) => cell === "╭").length, 0);

check("a 24-wide board keeps all three columns", () => {
  const rows = renderKanbanRows({ ...spec, width: 24 });
  const text = textRows(rows);
  for (const row of text) assert.ok(displayWidth(row) <= 24, `row fits in 24: ${JSON.stringify(row)}`);
  // Three columns side by side: 7 cells, a gap, 7, a gap, 7.
  const starts = text.flatMap((row) => columnsOf(row, "╭"));
  assert.ok([0, 8, 16].every((column) => starts.includes(column)), `all three columns are drawn (${starts.join(",")})`);
  assert.equal(corners(text), 4, "all four cards are drawn");
  assert.ok(!text.some((row) => row.includes("hidden")), "no column is hidden");
  assert.ok(!text.some((row) => row.includes("more")), "no card is dropped");
});

check("a 40-wide board keeps all three columns and their full headers", () => {
  const text = textRows(renderKanbanRows({ ...spec, width: 40 }));
  for (const row of text) assert.ok(displayWidth(row) <= 40, `row fits in 40: ${JSON.stringify(row)}`);
  for (const header of ["Todo (2)", "Doing (1)", "Done (1)"]) {
    assert.ok(text.some((row) => row.includes(header)), `${header} is spelled out when there is room`);
  }
  assert.equal(corners(text), 4, "all four cards are drawn");
});

check("a board too narrow for every column says so instead of clipping", () => {
  const wide = { width: 40, height: 8, columns: Array.from({ length: 11 }, (_, index) => ({ title: `C${index + 1}`, cards: [{ title: `card ${index + 1}` }] })) };
  const text = textRows(renderKanbanRows(wide));
  assert.ok(text.some((row) => row.includes("1 column hidden (1 card)")), `the hidden column is counted (${text.join(" / ")})`);

  // At 16 cells only four columns of four fit, and the cards still show: a
  // narrow board shrinks its columns before it loses one.
  const tight = { width: 16, height: 10, columns: Array.from({ length: 5 }, (_, index) => ({ title: `C${index + 1}`, cards: [{ title: `card ${index + 1}` }] })) };
  const narrow = textRows(renderKanbanRows(tight));
  assert.equal(narrow.length, 10, "the notes are rows of the declared height");
  assert.equal(corners(narrow), 4, "four columns still carry their cards");
  // The footer truncates like every other note; the count of lost columns is
  // what survives, and the ellipsis says a detail was cut.
  assert.ok(narrow.some((row) => row.includes("1 column hidd")), "the lost column is named");
  for (const row of narrow) assert.ok(displayWidth(row) <= 16, `row fits in 16: ${JSON.stringify(row)}`);
});

check("a CJK title keeps the card's border in place", () => {
  const rows = renderKanbanRows({ width: 40, columns: [{ title: "東京", cards: [{ title: "請求書を送る", meta: "田中" }] }] });
  const text = textRows(rows);
  for (const row of text) assert.ok(displayWidth(row) <= 40, `row fits in 40: ${JSON.stringify(row)}`);
  assert.ok(text.some((row) => row.includes("東京 (1)")), "the header is not mangled");
  assert.ok(text.some((row) => row.includes("請求書を送る")), "the wide title is drawn whole");

  // A wide glyph must not shift the box: the closing border sits at the same
  // display column on every row of the card.
  const boxed = text.filter((row) => row.includes("│"));
  assert.equal(boxed.length, 2, "the card body has two rows");
  for (const row of boxed) assert.deepEqual(columnsOf(row, "│"), [0, 39], `the card edges do not move: ${JSON.stringify(row)}`);
  const top = text.find((row) => row.includes("╭"));
  assert.deepEqual([columnsOf(top, "╭"), columnsOf(top, "╮")], [[0], [39]], "the top border spans the board width");
});

check("an unparseable titleLines falls back instead of hiding the title", () => {
  // `Math.max(1, Math.floor("x"))` is NaN, and clipLines then slices to nothing:
  // the card draws as an empty box. A bad option must not erase data.
  const spec = {
    type: "kanban",
    width: 50,
    titleLines: "x",
    columns: [{ title: "Todo", cards: [{ title: "card title" }] }],
  };
  const text = renderKanbanRows(spec).map((row) => runsText(row.runs)).join("\n");
  assert.match(text, /card title/, "the card title is still drawn");
});

console.log(`\n${checks}/${checks} checks passed`);
