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

import { cols, runsText, truncate, wrapText } from "./core.js";
import { coerceList, policyFor } from "./values.js";
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

/** Whether a comma at `index` sits only white space away from a closing bracket. */
function dropsComma(source, index) {
  let ahead = index + 1;
  while (ahead < source.length && /\s/.test(source[ahead])) ahead += 1;
  return source[ahead] === "}" || source[ahead] === "]";
}

/** JSON with the human bits stripped: comments, trailing commas. */
function isLineComment(source, index) {
  return source[index] === "/" && source[index + 1] === "/";
}

function isBlockComment(source, index) {
  return source[index] === "/" && source[index + 1] === "*";
}

/** One token: the text to copy and where reading continues. */
function readerStep(source, index) {
  const char = source[index];
  if (char === '"') {
    // A string is copied whole, so a // or /* inside it survives.
    const end = stringEnd(source, index);
    return { text: source.slice(index, end), next: end };
  }
  if (isLineComment(source, index)) {
    // The newline goes with the comment; the output keeps one either way.
    const newline = source.indexOf("\n", index);
    return { text: "\n", next: newline < 0 ? source.length : newline + 1 };
  }
  if (isBlockComment(source, index)) {
    // One space stands in for the comment, closed or not.
    const close = source.indexOf("*/", index + 2);
    return { text: " ", next: close < 0 ? source.length : close + 2 };
  }
  if (char === "," && dropsComma(source, index)) return { text: "", next: index + 1 };
  return { text: char, next: index + 1 };
}

export function readableJson(source) {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const { text, next } = readerStep(source, index);
    out += text;
    index = next;
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

// Every field a point, candle or bar object can carry a number in.
const NUMERIC_FIELDS = ["value", "x", "y", "o", "h", "l", "c", "open", "high", "low", "close"];

/**
 * Append the values one entry of a numeric list carries: a pair's value, the
 * numeric fields of an object, or the entry itself. The shapes are the ones the
 * families accept, so the tally judges exactly the values they draw.
 */
function addEntryValues(values, entry) {
  if (Array.isArray(entry)) {
    // A [label, value] pair carries its label first, so only the value counts.
    const pair = entry.length === 2 && typeof entry[0] === "string";
    for (const value of pair ? [entry[1]] : entry) addEntryValues(values, value);
    return;
  }
  if (entry && typeof entry === "object") {
    // A field left out is not a field, so it is not a value the chart lost.
    for (const key of NUMERIC_FIELDS) {
      if (entry[key] !== undefined) values.push(entry[key]);
    }
    return;
  }
  values.push(entry);
}

/** The values a list holds. A list that is not a list holds nothing. */
function listValues(list) {
  const values = [];
  if (!Array.isArray(list)) return values;
  for (const entry of list) addEntryValues(values, entry);
  return values;
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
  // `points` is absent on purpose: `line.js` owns that list and reports skipped
  // pairs itself with `POINTS_POLICY`, so counting it here reported the same
  // value twice under two different fates.
  const lists = [spec.values, spec.data, spec.slices, spec.candles, spec.items, spec.children];
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

/** `1 non-numeric value` / `2 non-numeric values`, the phrase every note uses. */
function countPhrase(count) {
  return `${count} non-numeric ${count === 1 ? "value" : "values"}`;
}

/**
 * The note for values the chart could not draw, in the words the family's own
 * policy used: a value kept in place reads as a zero, a value the family
 * removed reads as dropped, and both groups are counted apart. A family that
 * names its own losses keeps the dispatcher quiet, or one loss is reported
 * twice. A hole is a slot kept empty, so it counts with the zeros: nothing was
 * removed, and today no family reports holes at chart level.
 */
function valueNote(type, tally) {
  if (policyFor(type).selfReports) return "";
  const kept = tally.zeroed + tally.holes;
  const total = kept + tally.dropped;
  if (total === 0) return "";
  if (tally.dropped === 0) return `${countPhrase(total)} treated as 0`;
  if (kept === 0) return `${countPhrase(tally.dropped)} dropped`;
  return `${countPhrase(kept)} treated as 0 and ${countPhrase(tally.dropped)} dropped`;
}

/** How many values the spec's lists hold that the chart cannot draw outright. */
function valueTally(spec, type) {
  const policy = policyFor(type);
  const tally = { zeroed: 0, holes: 0, dropped: 0 };
  const lists = valueLists(spec);
  // A gauge and a progress bar draw one scalar, not a list. It is data all the
  // same, so an unreadable value must be counted rather than silently drawn as 0.
  if (type === "gauge" || type === "progress") lists.push([spec.value]);
  for (const list of [...lists, ...rowLists(spec, type)]) {
    const counted = coerceList(listValues(list), policy);
    tally.zeroed += counted.zeroed;
    tally.holes += counted.holes;
    tally.dropped += counted.dropped;
  }
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

/**
 * The guard's sentence, in the longest form that fits the row. `noteRows` wraps
 * and keeps the first line, so a sentence that does not fit used to end at
 * "hidden at" — the count survived, the meaning did not.
 */
function hiddenNoteText(hidden, limit, width) {
  const count = `${hidden} ${hidden === 1 ? "row" : "rows"}`;
  const room = Math.max(1, width - 4);
  const forms = [
    `${count} hidden at height ${limit}`,
    `${count} hidden at ${limit}`,
    `${count} hidden`,
    `${hidden} hidden`,
  ];
  return forms.find((form) => cols(form) <= room) ?? `${hidden} hidden`;
}

/** Last resort for a family that cannot shrink its own rows to `height`. */
function fitToHeight(rows, budget, width) {
  const limit = Math.max(0, Math.floor(budget));
  if (rows.length <= limit) return rows;
  if (limit <= 1) return rows.slice(0, limit);
  const hidden = rows.length - limit;
  const note = noteRows(hiddenNoteText(hidden, limit, width), width)[0];
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
 * Families that keep the ledger for their whole block: they spend `height` on
 * the title, the axis, the tasks, their own notes and the legend themselves, and
 * take the rows the dispatcher appends under the chart as `noteRows` (see
 * `ganttWindow`). The dispatcher hands them the height whole and does not take
 * the note rows away a second time; the family leaves exactly that many rows
 * free, so the block still ends at `height`.
 */
const OWNS_HEIGHT = new Set(["gantt"]);

/**
 * The height to hand the family. For most families that is the block less the
 * rows the dispatcher's notes will take: the note footer is part of the block
 * `height` measures, so a note has to cost a row of budget, not the family's last
 * data row. A family that keeps its own ledger (`OWNS_HEIGHT`) gets the block
 * whole and takes the note rows itself. A chart with no height is handed the spec
 * as it came.
 */
function familyHeight(height, noteCount, type) {
  const total = Number(height);
  if (!Number.isFinite(total) || total <= 0) return height;
  const limit = Math.max(1, Math.floor(total));
  if (OWNS_HEIGHT.has(type)) return limit;
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
  const height = familyHeight(spec.height, notes.length, chart.type);
  const familySpec = height === spec.height ? chart.spec : { ...chart.spec, height };
  // `noteRows` tells a family that owns its block how many rows to leave for the
  // notes below; other families ignore it.
  const familyRows = chart.render(familySpec, { noteRows: notes.length });
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
