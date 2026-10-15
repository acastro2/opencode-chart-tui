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

/** How many lines a title or a set of meta lines may take per card. */
const TITLE_LINES = 3;
const META_LINES = 2;
/** One clear column between boards, because columns must not touch. */
const GAP = 1;
const MIN_COLUMN = 10;

function readCard(raw) {
  const meta = raw?.meta ?? raw?.subtitle ?? null;
  return {
    title: String(raw?.title ?? raw?.label ?? raw?.name ?? ""),
    meta: Array.isArray(meta) ? meta.map(String) : meta == null ? [] : [String(meta)],
    color: typeof raw?.color === "string" ? raw.color : null,
  };
}

/**
 * Read the board out of a spec. Accepts `columns: [{title, cards}]` or a flat
 * `cards: [{column, title, meta, color}]` grouped by the `column` key, with the
 * order taken from `spec.order` first and appearance second.
 */
export function normalizeBoard(spec) {
  const columns = [];
  const list = Array.isArray(spec.columns) ? spec.columns : null;

  if (list) {
    for (const column of list) {
      const cards = Array.isArray(column?.cards) ? column.cards : Array.isArray(column?.items) ? column.items : [];
      columns.push({
        title: String(column?.title ?? column?.label ?? `Column ${columns.length + 1}`),
        cards: cards.map(readCard),
      });
    }
    return { columns };
  }

  const cards = Array.isArray(spec.cards) ? spec.cards : [];
  const order = Array.isArray(spec.order) ? spec.order.map(String) : [];
  const grouped = new Map();
  for (const raw of cards) {
    const key = String(raw?.column ?? raw?.status ?? raw?.list ?? "Cards");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(readCard(raw));
  }
  const titles = [...order.filter((title) => grouped.has(title)), ...[...grouped.keys()].filter((title) => !order.includes(title))];
  for (const title of titles) columns.push({ title, cards: grouped.get(title) ?? [] });
  return { columns };
}

/** Keep at most `max` lines and mark the cut with an ellipsis. */
function clipLines(lines, max) {
  const limit = Math.max(1, max);
  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  const last = kept[limit - 1];
  kept[limit - 1] = `${truncate(last, Math.max(1, cols(last) - 1))}…`;
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

export function renderKanbanRows(spec) {
  const width = Math.max(24, Math.floor(spec.width ?? 56));
  const rows = [];
  const title = spec.title == null ? null : String(spec.title);
  if (title) rows.push(titleRow(title, width));

  const { columns } = normalizeBoard(spec);
  if (columns.length === 0) {
    rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });
    return rows;
  }

  const palette = paletteOf(spec);
  const gap = Math.max(1, Math.floor(spec.gap ?? GAP));
  const natural = Math.floor((width - (columns.length - 1) * gap) / columns.length);
  const columnWidth = Math.max(MIN_COLUMN, Math.min(natural, Math.floor(spec.columnWidth ?? natural)));
  const inner = Math.max(4, columnWidth - 2);

  const limit = { title: Math.max(1, Math.floor(spec.titleLines ?? TITLE_LINES)), meta: Math.max(0, Math.floor(spec.metaLines ?? META_LINES)) };
  const wrapped = columns.map((column) => wrapColumn(column, inner, limit));
  const needed = Math.max(...wrapped.map((entry) => entry.height));
  const height = Math.max(4, Math.floor(spec.height ?? needed));

  const grid = blankGrid(width, height);
  const reports = [];

  columns.forEach((column, index) => {
    const accent = palette[index % palette.length];
    const x0 = index * (columnWidth + gap);
    const x1 = x0 + columnWidth - 1;

    stampText(grid, x0, 0, truncate(`${column.title} (${column.cards.length})`, columnWidth), { slice: index, kind: "title" });
    stampText(grid, x0, 1, "─".repeat(columnWidth), { slice: index, kind: "axis" });

    let y = 2;
    let dropped = 0;
    for (const entry of wrapped[index].cards) {
      if (y + entry.height - 1 >= height) {
        dropped += 1;
        continue;
      }
      drawBox(grid, x0, y, x1, y + entry.height - 1, { slice: index, kind: "fill", color: entry.card.color ?? accent });
      entry.lines.forEach((line, lineIndex) => {
        stampText(grid, x0 + 1, y + 1 + lineIndex, line, { slice: index, kind: "title" });
      });
      entry.meta.forEach((line, lineIndex) => {
        stampText(grid, x0 + 1, y + 1 + entry.lines.length + lineIndex, line, { slice: index, kind: "legend" });
      });
      y += entry.height + 1;
    }

    if (dropped > 0) reports.push({ index, x0, y: Math.min(y, height - 1), text: `… ${dropped} more` });
  });

  for (const report of reports) {
    stampText(grid, report.x0, report.y, truncate(report.text, columnWidth), { slice: report.index, kind: "legend" });
  }

  for (const row of grid) rows.push({ width, runs: cellsToRuns(row) });
  return rows;
}
