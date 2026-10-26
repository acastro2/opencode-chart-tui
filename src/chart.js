// The dispatcher: one entry point for every chart family.
//
// The fence body carries a "type". Adding a family means adding an entry here
// and nothing else, which is the point of the shared core.
//
// A fence is written by hand (or by a model), so the reader is tolerant: // and
// /* */ comments and trailing commas are allowed, a JSON failure comes back as a
// short reason instead of a stack, and anything the chart had to coerce is said
// out loud in a footer row. A chart that silently changes the data is worse than
// one that admits it did.

import { runsText, truncate, wrapText } from "./core.js";
import { renderChartRows as renderPieRows } from "./pie.js";
import { renderBarRows } from "./bar.js";
import { renderHistogramRows } from "./histogram.js";
import { renderCandleRows } from "./candle.js";
import { renderOhlcRows } from "./ohlc.js";
import { renderLineRows } from "./line.js";
import { renderHeatmapRows } from "./heatmap.js";
import { renderGaugeRows } from "./gauge.js";
import { renderWaterfallRows } from "./waterfall.js";
import { renderTableRows } from "./table.js";
import { renderRadarRows } from "./radar.js";
import { renderTreemapRows } from "./treemap.js";
import { renderSankeyRows } from "./sankey.js";
import { renderKanbanRows } from "./kanban.js";
import { renderGanttRows } from "./gantt.js";

export const CHART_TYPES = {
  pie: renderPieRows,
  donut: renderPieRows,
  bar: renderBarRows,
  column: renderBarRows,
  hbar: renderBarRows,
  histogram: renderHistogramRows,
  candle: renderCandleRows,
  candlestick: renderCandleRows,
  ohlc: renderOhlcRows,
  line: renderLineRows,
  area: renderLineRows,
  sparkline: renderLineRows,
  scatter: renderLineRows,
  heatmap: renderHeatmapRows,
  gauge: renderGaugeRows,
  progress: renderGaugeRows,
  waterfall: renderWaterfallRows,
  table: renderTableRows,
  radar: renderRadarRows,
  treemap: renderTreemapRows,
  sankey: renderSankeyRows,
  kanban: renderKanbanRows,
  gantt: renderGanttRows,
};

/** A refusal: no spec, and the reason in plain words. */
function refused(error) {
  return { spec: null, error };
}

/** JSON.parse that turns a failure into a short reason instead of a stack. */
function parseBody(text) {
  if (text === "") return refused("empty fence body");
  try {
    return { spec: JSON.parse(readableJson(text)), error: null };
  } catch (error) {
    return refused(jsonReason(error, text));
  }
}

/** A fence body must be an object: an array or a scalar is a mistake. */
function isSpecObject(spec) {
  return Boolean(spec) && typeof spec === "object" && !Array.isArray(spec);
}

/**
 * Read a fence body. Comments and trailing commas are stripped, and a failure
 * comes back as `{ spec: null, error: "…" }` with a line and column, never as a
 * thrown exception: the caller shows the reason instead of the raw source.
 */
export function parseChart(source) {
  const text = String(source ?? "").trim();
  const parsed = parseBody(text);
  if (parsed.error) return parsed;
  return isSpecObject(parsed.spec) ? parsed : refused("the fence body must be a JSON object");
}

/** Where the string that starts at `start` ends: just past its closing quote. */
function stringEnd(source, start) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === '"') return index + 1;
    index += 1;
  }
  return index;
}

/**
 * Where a `//` comment that starts at `start` ends: past its newline, which the
 * comment owns, or at the end of the source.
 */
function lineEnd(source, start) {
  let index = start;
  while (index < source.length && source[index] !== "\n") index += 1;
  return Math.min(source.length, index + 1);
}

/** Whether the two characters at `index` close a block comment. */
function closesComment(source, index) {
  return source[index] === "*" && source[index + 1] === "/";
}

/** Where a block comment that starts at `start` ends: past its closing star. */
function blockEnd(source, start) {
  let index = start + 2;
  while (index < source.length && !closesComment(source, index)) index += 1;
  return Math.min(source.length, index + 2);
}

/** Whether a comma at `index` sits only white space away from a closing bracket. */
function dropsComma(source, index) {
  let ahead = index + 1;
  while (ahead < source.length && /\s/.test(source[ahead])) ahead += 1;
  return source[ahead] === "}" || source[ahead] === "]";
}

/** One source character, taken as it is. */
function plainToken(source, index) {
  return { text: source[index], end: index + 1 };
}

/** A quoted string, copied whole so a // or /* inside it survives. */
function stringToken(source, index) {
  const end = stringEnd(source, index);
  return { text: source.slice(index, end), end };
}

/** A slash: the start of a comment, or just a slash. */
function slashToken(source, index) {
  const next = source[index + 1];
  if (next === "/") return { text: "\n", end: lineEnd(source, index) };
  if (next === "*") return { text: " ", end: blockEnd(source, index) };
  return plainToken(source, index);
}

/** A comma, dropped when it only trails a value before a closing bracket. */
function commaToken(source, index) {
  return dropsComma(source, index) ? { text: "", end: index + 1 } : plainToken(source, index);
}

// The three characters that need more than a copy; every other one is plain.
const TOKENS = { '"': stringToken, "/": slashToken, ",": commaToken };

/** JSON with the human bits stripped: comments, trailing commas. */
export function readableJson(source) {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const take = TOKENS[source[index]] ?? plainToken;
    const token = take(source, index);
    out += token.text;
    index = token.end;
  }

  return out;
}

/** The position a JSON error names, or -1 when its message carries none. */
function errorPosition(error) {
  const found = /position (\d+)/.exec(String(error?.message ?? ""));
  return found ? Number(found[1]) : -1;
}

/** A JSON error as one line, with the position turned into line and column. */
function jsonReason(error, source) {
  const message = String(error?.message ?? error).replace(/ in JSON.*$/, "");
  const at = errorPosition(error);
  if (at < 0) return message;
  const before = source.slice(0, at);
  const line = before.split("\n").length;
  const column = at - before.lastIndexOf("\n");
  return `${message} (line ${line}, column ${column})`;
}

/** A heat map's rows carry a `values` array; a table's rows do not. */
function isHeatGrid(rows) {
  return rows.length > 0 && rows.every((row) => row && typeof row === "object" && Array.isArray(row.values));
}

/** The type the data looks like, when the fence did not name one. */
function guessType(spec) {
  const found = TYPE_GUESSES.find(([matches]) => matches(spec));
  return found ? found[1] : "";
}

function looksLikePie(spec) {
  return Array.isArray(spec.slices);
}

function looksLikeTable(spec) {
  return Array.isArray(spec.columns) && Array.isArray(spec.rows) && !isHeatGrid(spec.rows);
}

function hasRowList(spec) {
  return Array.isArray(spec.rows);
}

function hasNestedValues(spec) {
  return Array.isArray(spec.values) && Array.isArray(spec.values[0]);
}

function hasValueList(spec) {
  return Array.isArray(spec.values) || Array.isArray(spec.series);
}

// The guesses, in the order the shapes are tried. A pie's slices win over
// everything, and a bare value list is the last thing worth guessing.
const TYPE_GUESSES = [
  [looksLikePie, "pie"],
  [looksLikeTable, "table"],
  [hasRowList, "heatmap"],
  [hasNestedValues, "heatmap"],
  [hasValueList, "bar"],
];

/**
 * What `Number()` makes of one value. `ok` is a number the caller wrote, or a
 * string that reads as one. `coerced` is a missing value that `Number()` turns
 * into 0 all the same, so every family draws a 0. `bad` is a value no number
 * comes out of, which is the one a family may drop.
 */
function valueKind(value) {
  if (value === null || value === "") return "coerced";
  return Number.isFinite(Number(value)) ? "ok" : "bad";
}

/** Whether a value is an object worth reading fields from. */
function isObject(value) {
  return Boolean(value) && typeof value === "object";
}

// Every field a point, candle or bar object can carry a number in.
const NUMERIC_FIELDS = ["value", "x", "y", "o", "h", "l", "c", "open", "high", "low", "close"];

/** A tally of the values a chart cannot read outright: drawn as 0, or not at all. */
function emptyTally() {
  return { coerced: 0, bad: 0 };
}

/** Add one value's fate. A number the chart can draw adds nothing. */
function countValue(tally, value) {
  const kind = valueKind(value);
  if (kind !== "ok") tally[kind] += 1;
}

/** Add the numeric fields one object carries. A field left out is not a field. */
function countFields(tally, entry) {
  for (const key of NUMERIC_FIELDS) {
    if (entry[key] !== undefined) countValue(tally, entry[key]);
  }
}

/** A [label, value] pair carries its label first, so only the value counts. */
function pairValue(entry) {
  return entry.length === 2 && typeof entry[0] === "string" ? [entry[1]] : entry;
}

/** Add one entry of a numeric list: a pair is walked, an object read, a value judged. */
function countEntry(tally, entry) {
  if (Array.isArray(entry)) {
    for (const value of pairValue(entry)) countEntry(tally, value);
    return;
  }
  if (isObject(entry)) countFields(tally, entry);
  else countValue(tally, entry);
}

/** Add every entry of a numeric list. A list that is not a list holds nothing. */
function countEntries(tally, list) {
  if (!Array.isArray(list)) return;
  for (const entry of list) countEntry(tally, entry);
}

/** The fields this library has renamed, with when each rename applies. */
function renamedNotes(spec) {
  const notes = [];
  if (spec.percent !== undefined && spec.showPercent === undefined) notes.push("percent is now showPercent");
  if (gapIsColour(spec)) notes.push("the boundary colour is boundaryColor now");
  return notes;
}

/**
 * Whether a string `gap` is the old boundary colour. It names two things: the
 * colour between two shapes, and the blank columns a board puts between its
 * columns. A string that reads as a number is spacing, so it keeps its key:
 * renaming "2" into a colour throws the spacing away.
 */
function gapIsColour(spec) {
  return typeof spec.gap === "string" && !Number.isFinite(Number(spec.gap));
}

/**
 * The spec to draw. When `gap` is the old boundary colour the renamed key goes,
 * because a hex string left behind becomes `Math.floor("#333")` and shrinks the
 * board. A numeric `gap`, string or not, is spacing and passes untouched.
 */
function renamedSpec(spec) {
  if (!gapIsColour(spec)) return spec;
  const { gap, ...rest } = spec;
  return rest.boundaryColor === undefined ? { ...rest, boundaryColor: gap } : rest;
}

/** Whether a heat map still carries its column names in `columns`. */
function headersMoved(spec, type) {
  return type === "heatmap" && Array.isArray(spec.columns) && !Array.isArray(spec.headers);
}

/** The note for a heat map whose column names live under the old key. */
function headerNote(spec, type) {
  return headersMoved(spec, type) ? ["heatmap headers come from headers now"] : [];
}

/** The lists that carry plain numbers, wherever the family keeps them. */
function valueLists(spec) {
  const lists = [spec.values, spec.data, spec.points, spec.slices, spec.candles, spec.items, spec.children];
  if (Array.isArray(spec.series)) lists.push(...spec.series.map((item) => item?.values));
  if (Array.isArray(spec.links)) lists.push(spec.links);
  return lists;
}

/** A spec's `rows`, when there are any. */
function rowsOf(spec) {
  return Array.isArray(spec.rows) ? spec.rows : [];
}

/** Whether the spec draws a heat grid, whose rows hold value lists. */
function isHeatSpec(spec, type) {
  return type === "heatmap" || isHeatGrid(rowsOf(spec));
}

/** The heat map's per-row value lists, when the spec has them. */
function rowLists(spec, type) {
  if (!isHeatSpec(spec, type)) return [];
  return rowsOf(spec).map((row) => row?.values);
}

// The families that name what they could not draw in their own units: a candle
// skipped, a value omitted, a row with no values. Counting the same rows again
// at chart level reported one loss as two, in a wording that could be false.
const SELF_REPORTING = new Set(["heatmap", "candle", "candlestick", "ohlc", "treemap"]);

// The families that read a value they cannot draw as zero and paint the zero.
// Every other family drops the value, or the entry that held it. A gauge's own
// `value` is a scalar and is never counted here, so gauge and progress are out.
const ZERO_FILLED = new Set(["bar", "column", "hbar", "line", "area", "sparkline", "scatter", "radar"]);

/** `1 non-numeric value` / `2 non-numeric values`, the phrase every note uses. */
function countPhrase(count) {
  return `${count} non-numeric ${count === 1 ? "value" : "values"}`;
}

/**
 * The note for values the chart could not draw. The two groups are counted
 * apart, because the same loss does not have the same fate. A missing value is
 * always drawn as 0 — `Number()` makes it 0 and every family reads it that way —
 * so it never takes the dropping verb. A value no number comes out of takes the
 * family's verb, and the two groups share one phrase when the verb agrees.
 */
function valueNote(type, tally) {
  const total = tally.coerced + tally.bad;
  if (SELF_REPORTING.has(type) || total === 0) return "";
  if (ZERO_FILLED.has(type) || tally.bad === 0) return `${countPhrase(total)} treated as 0`;
  if (tally.coerced === 0) return `${countPhrase(tally.bad)} dropped`;
  return `${countPhrase(tally.coerced)} treated as 0 and ${countPhrase(tally.bad)} dropped`;
}

/** How many values the spec's lists hold that the chart cannot read outright. */
function valueTally(spec, type) {
  const tally = emptyTally();
  for (const list of valueLists(spec)) countEntries(tally, list);
  for (const list of rowLists(spec, type)) countEntries(tally, list);
  return tally;
}

/**
 * Everything the chart had to change to draw: values that are not numbers, and
 * keys that were renamed. Each one is worth a line under the chart.
 */
function collectNotes(spec, type, guessed) {
  const notes = guessed ? [`no type, read as ${type}`] : [];
  notes.push(...renamedNotes(spec), ...headerNote(spec, type));

  const note = valueNote(type, valueTally(spec, type));
  if (note) notes.push(note);

  return notes;
}

/**
 * The note footer: what the chart had to change. It wraps instead of clipping,
 * because a warning the reader cannot see is worse than no warning, and it stops
 * at three rows so a fence with many problems cannot bury the chart.
 */
function noteRows(text, width) {
  const wrapped = wrapText(text, Math.max(8, width - 4));
  const lines = wrapped.slice(0, 3);
  if (lines.length === 3 && wrapped.length > 3) {
    lines[2] = `${truncate(lines[2], Math.max(1, width - 6))} …`;
  }
  return lines.map((line) => ({
    width,
    runs: [{ text: `  ${line}`, slice: -1, kind: "legend" }],
  }));
}

/** Last resort for a family that cannot shrink its own rows to `height`. */
function fitToHeight(rows, budget, width) {
  const limit = Math.max(0, Math.floor(budget));
  if (rows.length <= limit) return rows;
  if (limit <= 1) return rows.slice(0, limit);
  const hidden = rows.length - limit;
  const note = noteRows(
    `${hidden} row${hidden === 1 ? "" : "s"} hidden at height ${limit}`,
    width,
  )[0];
  return [...rows.slice(0, limit - 1), note];
}

/** The footer rows for what the chart changed, if it changed anything. */
function notesFor(spec, type, guessed, width) {
  const notes = collectNotes(spec, type, guessed);
  return notes.length > 0 ? noteRows(notes.join("; "), width) : [];
}

/** One muted row that says why there is no chart. */
function legendRow(width, text) {
  return [{ width, runs: [{ text, slice: -1, kind: "legend" }] }];
}

/** The type the fence named, lowercased so "PIE" and "pie" agree. */
function requestedType(spec) {
  return String(spec.type ?? "").toLowerCase();
}

/** Whether a name is one of the registered families. */
function isKnownType(type) {
  return Boolean(CHART_TYPES[type]);
}

/** Whether the fence named a type that no family answers to. */
function isWrongType(requested) {
  return Boolean(requested) && !isKnownType(requested);
}

/**
 * The renderer and the spec to hand it, or the one row that says why there is
 * nothing to draw.
 */
function chooseChart(spec, width) {
  const requested = requestedType(spec);
  if (isWrongType(requested)) return { rows: legendRow(width, `unknown chart type "${requested}"`) };
  return chartFor(spec, requested, width);
}

/** The renderer for a name that is either known or about to be guessed. */
function chartFor(spec, requested, width) {
  const known = isKnownType(requested);
  const type = known ? requested : guessType(spec);
  const render = CHART_TYPES[type];
  if (!render) return { rows: legendRow(width, "no chart data") };

  const drawable = renamedSpec(spec);
  // A guessed type is handed over under its own name, so a family that checks
  // `spec.type` still sees the type it was guessed as.
  return { render, type, spec: type === requested ? drawable : { ...drawable, type }, guessed: !known };
}

/** Keep the whole block, notes included, inside the requested `height`. */
function applyHeight(rows, notes, height, width) {
  const total = Number(height);
  if (!Number.isFinite(total) || total <= 0) return [...rows, ...notes];

  const limit = Math.max(1, Math.floor(total));
  const noteBudget = Math.min(notes.length, Math.max(0, limit - 1));
  const familyBudget = Math.max(1, limit - noteBudget);
  return [...fitToHeight(rows, familyBudget, width), ...notes.slice(0, noteBudget)].slice(0, limit);
}

/**
 * The height to hand the family: the block, less the rows its notes will take.
 * The note footer is part of the block `height` measures, so a note has to cost
 * a row of budget, not the family's last data row. A chart with no notes, or no
 * height, is handed the spec as it came.
 */
function familyHeight(height, noteCount) {
  const total = Number(height);
  if (!Number.isFinite(total) || total <= 0) return height;
  const limit = Math.max(1, Math.floor(total));
  return Math.max(1, limit - Math.min(noteCount, Math.max(0, limit - 1)));
}

/** The rows a fence becomes, as styled runs. */
export function renderChartRows(spec = {}) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const chart = chooseChart(spec, width);
  if (chart.rows) return chart.rows;

  // The notes are read before the family draws, so they are paid for out of the
  // height budget instead of out of the rows the family already drew.
  const notes = notesFor(spec, chart.type, chart.guessed, width);
  const height = familyHeight(spec.height, notes.length);
  const familyRows = chart.render(height === spec.height ? chart.spec : { ...chart.spec, height });
  // `height` is the total block, not a family's private plot height. Families
  // budget their own chrome first; this is the guard for the ones that cannot.
  return applyHeight(familyRows, notes, spec.height, width);
}

/** The plain text of a chart, for a caller with no colour. */
export function renderChart(source = {}) {
  // A fence body arrives as text in the TUI, which parses it first. Accepting a
  // string here too keeps the plain-text and styled-run paths on one contract,
  // so a caller (or a test) can hand over exactly what the fence held.
  const { spec, error } = typeof source === "string" ? parseChart(source) : { spec: source, error: null };
  if (error) return `  chart: ${error}`;
  return renderChartRows(spec ?? {})
    .map((row) => runsText(row.runs))
    .join("\n");
}

export function chartTypes() {
  return Object.keys(CHART_TYPES);
}

// Re-exported so the TUI plugin needs one import for the whole library.
export { DEFAULT_PALETTE, contrastOn, formatNumber } from "./core.js";
export { PALETTES, THEMES, paletteOf, styleOf, themeOf } from "./theme.js";
