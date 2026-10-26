// Kanban: columns of cards.
//
// The board is drawn as a grid, so the same layout serves the plain-text and the
// styled rendering. Three ideas:
//
// 1. A column owns a horizontal band: its header, a rule, then one boxed card
//    after another with a blank row between them. Cards wrap, so a long title
//    grows its box instead of being cut.
// 2. Colour is per column, and a card may override it. The box border carries
//    the colour, the title stays bold and the meta lines stay muted, so a card
//    reads as a card rather than as a painted block.
// 3. A board that does not fit reports what it dropped. Silently hiding cards
//    would make the chart lie, which is worse than being short.
//
// The width is a budget. It is spent in this order: the gap between columns,
// then the columns themselves down to MIN_COLUMN cells, then whole columns. A
// column that cannot be shown is counted in a note, so no card leaves without a
// word.

import {
  DEFAULT_PALETTE,
  blankGrid,
  cellsToRuns,
  cols,
  drawBox,
  stampText,
  titleRow,
  truncate,
  wrapText,
} from "./core.js";
import { paletteOf, themeOf } from "./theme.js";
import { plotRows as plotRowsFor } from "./layout.js";

/** How many lines a title or a set of meta lines may take per card. */
const TITLE_LINES = 3;
const META_LINES = 2;
/** One clear column between boards, because columns must not touch. */
const GAP = 1;
/** The narrowest a column may get: a two-cell card is still a card. */
const MIN_COLUMN = 4;
/** The narrowest board worth drawing: below this the header has no room. */
const MIN_WIDTH = 16;

/**
 * The first of `keys` that `raw` has and does not set to null, else null. Every
 * field on a card and on a column is a `title ?? label ?? name` chain, and a
 * card may not even be an object, so the chain lives here once.
 */
function firstValue(raw, keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (value != null) return value;
  }
  return null;
}

/**
 * The first of `values` that is an array, else an empty list. A column may carry
 * `cards` or `items`; a non-array in `cards` must not hide a real `items` list.
 */
function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** A card's meta lines: an array is mapped, a single value is one line. */
function readMeta(raw) {
  const meta = firstValue(raw, ["meta", "subtitle"]);
  if (meta == null) return [];
  return Array.isArray(meta) ? meta.map(String) : [String(meta)];
}

/** A card's own colour, when it declares one as a string. */
function readColor(raw) {
  const color = firstValue(raw, ["color"]);
  return typeof color === "string" ? color : null;
}

function readCard(raw) {
  return {
    title: String(firstValue(raw, ["title", "label", "name"]) ?? ""),
    meta: readMeta(raw),
    color: readColor(raw),
  };
}

/** A column's header: its title, its label, then a positional name. */
function columnTitle(column, index) {
  const title = firstValue(column, ["title", "label"]);
  return String(title ?? `Column ${index + 1}`);
}

/** `columns: [{title, cards}]` as written, in the order given. */
function readColumns(list) {
  return list.map((column, index) => ({
    title: columnTitle(column, index),
    cards: firstArray(column?.cards, column?.items).map(readCard),
  }));
}

/** Bucket flat cards by their column key, keeping first-seen order. */
function groupByColumn(cards) {
  const grouped = new Map();
  for (const raw of cards) {
    const key = String(firstValue(raw, ["column", "status", "list"]) ?? "Cards");
    const bucket = grouped.get(key) ?? [];
    bucket.push(readCard(raw));
    grouped.set(key, bucket);
  }
  return grouped;
}

/** `order` first for the titles it names, then the rest in appearance order. */
function orderedTitles(order, grouped) {
  const named = order.filter((title) => grouped.has(title));
  const rest = [...grouped.keys()].filter((title) => !order.includes(title));
  return [...named, ...rest];
}

/** Flat `cards: [{column, title}]`, grouped by column or status. */
function groupedColumns(spec) {
  const grouped = groupByColumn(firstArray(spec.cards));
  const order = firstArray(spec.order).map(String);
  return orderedTitles(order, grouped).map((title) => ({ title, cards: grouped.get(title) ?? [] }));
}

/**
 * Read the board out of a spec. Accepts `columns: [{title, cards}]` or a flat
 * `cards: [{column, title, meta, color}]` grouped by the `column` key, with the
 * order taken from `spec.order` first and appearance second.
 */
export function normalizeBoard(spec) {
  if (Array.isArray(spec.columns)) return { columns: readColumns(spec.columns) };
  return { columns: groupedColumns(spec) };
}

/**
 * How many columns fit, how wide they are, and the gap between them. The gap
 * goes first, then the columns shrink to MIN_COLUMN, and only then is one
 * dropped: every step is the smallest one that lets another column stay.
 */
function fitColumns(width, count, gap, requested) {
  let gapUsed = gap;
  let shown = count;

  for (;;) {
    const natural = Math.floor((width - (shown - 1) * gapUsed) / shown);
    if (natural >= MIN_COLUMN) {
      return {
        gap: gapUsed,
        shown,
        width: Math.max(MIN_COLUMN, Math.min(natural, requested ?? natural)),
      };
    }
    if (gapUsed > 0) {
      gapUsed = 0;
      continue;
    }
    if (shown > 1) {
      shown -= 1;
      continue;
    }
    // One column, still narrower than the minimum: it takes the whole width and
    // the note rows explain the rest.
    return { gap: 0, shown, width: Math.max(MIN_COLUMN, width) };
  }
}

/**
 * The header line. `Title (n)` when it fits, `Title(n)` when the space is worth
 * more than the space between them, and a cut title when the count is the only
 * part that must survive: a column with no count reads as empty.
 */
function columnHeader(title, count, width) {
  const spaced = ` (${count})`;
  if (cols(title) + cols(spaced) <= width) return `${title}${spaced}`;
  const tight = `(${count})`;
  if (cols(title) + cols(tight) <= width) return `${title}${tight}`;
  const room = width - cols(tight);
  if (room >= 2) return `${truncate(title, room)}${tight}`;
  return truncate(`${title}${spaced}`, width);
}

/** Keep at most `max` lines and mark the cut with an ellipsis. Zero keeps none. */
function clipLines(lines, max) {
  if (max <= 0) return [];
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1];
  // `truncate` adds its own ellipsis; a second one is just noise.
  const cut = truncate(last, Math.max(1, cols(last) - 1));
  kept[max - 1] = cut.endsWith("…") ? cut : `${cut}…`;
  return kept;
}

/** Wrap every card of a column for a given inner width. */
function wrapColumn(column, inner, limit) {
  let height = 2; // the rule and the header
  const cards = column.cards.map((card) => {
    const lines = clipLines(wrapText(card.title, inner), limit.title);
    const meta = clipLines(card.meta.flatMap((line) => wrapText(line, inner)), limit.meta);
    const cardHeight = lines.length + meta.length + 2; // borders
    return { card, lines, meta, height: cardHeight };
  });
  for (const entry of cards) height += entry.height + 1;
  return { cards, height: Math.max(0, height - 1) };
}

function kanbanWidth(spec) {
  return Math.max(MIN_WIDTH, Math.floor(spec.width ?? 56));
}

function kanbanTitle(spec) {
  return spec.title == null ? null : String(spec.title);
}

function kanbanRequested(spec) {
  return Number.isFinite(Number(spec.columnWidth)) ? Math.floor(Number(spec.columnWidth)) : null;
}

function kanbanGap(spec) {
  const asked = Number(spec.gap);
  return Number.isFinite(asked) ? Math.max(0, Math.floor(asked)) : GAP;
}

/** Columns that did not fit, as one note with the cards they held. */
function hiddenNote(hidden) {
  if (hidden.length === 0) return null;
  const cards = hidden.reduce((sum, column) => sum + column.cards.length, 0);
  const columns = `${hidden.length} column${hidden.length === 1 ? "" : "s"}`;
  const cardText = `${cards} card${cards === 1 ? "" : "s"}`;
  return `${columns} hidden (${cardText})`;
}

/** A count from a fence: a finite number wins, anything else is the default. */
function lineCount(value, fallback, min) {
  const asked = Number(value);
  return Number.isFinite(asked) ? Math.max(min, Math.floor(asked)) : fallback;
}

function linesLimit(spec) {
  return {
    title: lineCount(spec.titleLines, TITLE_LINES, 1),
    meta: lineCount(spec.metaLines, META_LINES, 0),
  };
}

/** `needed` is the grid the cards want; title and notes are rows too. */
function boardHeightOf(spec, title, notes, needed) {
  return Math.max(
    2,
    plotRowsFor(spec, {
      chrome: (title ? 1 : 0) + notes.length,
      fallback: needed,
      min: 2,
      max: 60,
    }),
  );
}

/** The shortest overflow note that still carries the count. */
function overflowText(dropped, columnWidth) {
  const text = `… ${dropped} more`;
  return cols(text) <= columnWidth ? text : truncate(`…${dropped}`, columnWidth);
}

/**
 * Which cards fit in `limit` rows, and where each one starts. The first card
 * that does not fit ends the list: a later, smaller card must not jump the one
 * that was dropped, or the column reads out of order.
 */
function placeCards(cards, limit) {
  const placed = [];
  let y = 2; // the rule and the header
  for (const entry of cards) {
    if (y + entry.height - 1 >= limit) break;
    placed.push({ entry, y });
    y += entry.height + 1;
  }
  return { placed, y };
}

/** One column: header, rule, cards. Returns its overflow report, if any. */
function drawColumn(grid, { column, index, x0, x1, columnWidth, accent, wrapped, boardHeight }) {
  stampText(grid, x0, 0, columnHeader(column.title, column.cards.length, columnWidth), { slice: index, kind: "title" });
  stampText(grid, x0, 1, "─".repeat(columnWidth), { slice: index, kind: "axis" });

  const full = placeCards(wrapped.cards, boardHeight);
  // The report needs a row of its own, so a column that drops gives up its last
  // row instead of writing the note over a card's border.
  const layout = full.placed.length === wrapped.cards.length ? full : placeCards(wrapped.cards, boardHeight - 1);

  for (const { entry, y } of layout.placed) {
    drawBox(grid, x0, y, x1, y + entry.height - 1, { slice: index, kind: "fill", color: entry.card.color ?? accent });
    entry.lines.forEach((line, lineIndex) => {
      stampText(grid, x0 + 1, y + 1 + lineIndex, line, { slice: index, kind: "title" });
    });
    entry.meta.forEach((line, lineIndex) => {
      stampText(grid, x0 + 1, y + 1 + entry.lines.length + lineIndex, line, { slice: index, kind: "legend" });
    });
  }

  const dropped = wrapped.cards.length - layout.placed.length;
  if (dropped === 0) return null;
  // The count is the report: a narrower column shortens the words, never the
  // number.
  return { index, x0, y: Math.min(layout.y, boardHeight - 1), text: overflowText(dropped, columnWidth) };
}

function pushGrid(rows, width, grid) {
  for (const row of grid) rows.push({ width, runs: cellsToRuns(row) });
}

function pushNotes(rows, width, notes) {
  for (const note of notes) rows.push({ width, runs: [{ text: truncate(`  ${note}`, width), slice: -1, kind: "legend" }] });
}

export function renderKanbanRows(spec) {
  const width = kanbanWidth(spec);
  const rows = [];
  const title = kanbanTitle(spec);
  if (title) rows.push(titleRow(title, width));

  const { columns } = normalizeBoard(spec);
  if (columns.length === 0) {
    rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });
    return rows;
  }

  const palette = paletteOf(spec);
  const fit = fitColumns(width, columns.length, kanbanGap(spec), kanbanRequested(spec));
  const shown = columns.slice(0, fit.shown);
  const columnWidth = fit.width;
  const inner = Math.max(1, columnWidth - 2);

  // A column that cannot be shown is one note with the cards it held, so the
  // reader can see that the board is short rather than think it is complete.
  const note = hiddenNote(columns.slice(fit.shown));
  const notes = note === null ? [] : [note];

  const wrapped = shown.map((column) => wrapColumn(column, inner, linesLimit(spec)));
  const needed = Math.max(...wrapped.map((entry) => entry.height));
  const boardHeight = boardHeightOf(spec, title, notes, needed);

  const grid = blankGrid(width, boardHeight);
  const reports = [];
  shown.forEach((column, index) => {
    const x0 = index * (columnWidth + fit.gap);
    const report = drawColumn(grid, {
      column,
      index,
      x0,
      x1: x0 + columnWidth - 1,
      columnWidth,
      accent: palette[index % palette.length],
      wrapped: wrapped[index],
      boardHeight,
    });
    if (report) reports.push(report);
  });

  for (const report of reports) {
    stampText(grid, report.x0, report.y, report.text, { slice: report.index, kind: "legend" });
  }

  pushGrid(rows, width, grid);
  pushNotes(rows, width, notes);
  return rows;
}
