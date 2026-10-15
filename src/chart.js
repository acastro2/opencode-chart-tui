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

import { runsText, wrapText } from "./core.js";
import { renderChartRows as renderPieRows } from "./pie.js";
import { renderBarRows } from "./bar.js";
import { renderHistogramRows } from "./histogram.js";
import { renderCandleRows } from "./candle.js";
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
  ohlc: renderCandleRows,
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

/**
 * Read a fence body. Comments and trailing commas are stripped, and a failure
 * comes back as `{ spec: null, error: "…" }` with a line and column, never as a
 * thrown exception: the caller shows the reason instead of the raw source.
 */
export function parseChart(source) {
  const text = String(source ?? "").trim();
  if (text === "") return { spec: null, error: "empty fence body" };

  let spec;
  try {
    spec = JSON.parse(readableJson(text));
  } catch (error) {
    return { spec: null, error: jsonReason(error, text) };
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { spec: null, error: "the fence body must be a JSON object" };
  }
  return { spec, error: null };
}

/** JSON with the human bits stripped: comments, trailing commas. */
export function readableJson(source) {
  let out = "";
  let inString = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        index += 1;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      out += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      out += " ";
      continue;
    }
    if (char === ",") {
      let ahead = index + 1;
      while (ahead < source.length && /\s/.test(source[ahead])) ahead += 1;
      if (source[ahead] === "}" || source[ahead] === "]") continue;
    }
    out += char;
  }

  return out;
}

/** A JSON error as one line, with the position turned into line and column. */
function jsonReason(error, source) {
  const message = String(error?.message ?? error).replace(/ in JSON.*$/, "");
  const position = /position (\d+)/.exec(String(error?.message ?? ""));
  if (!position) return message;
  const at = Number(position[1]);
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
  if (Array.isArray(spec.slices)) return "pie";
  if (Array.isArray(spec.columns) && Array.isArray(spec.rows) && !isHeatGrid(spec.rows)) return "table";
  if (Array.isArray(spec.rows)) return "heatmap";
  if (Array.isArray(spec.values) && Array.isArray(spec.values[0])) return "heatmap";
  if (Array.isArray(spec.values) || Array.isArray(spec.series)) return "bar";
  return "";
}

/** How many entries of a numeric list are not numbers. */
function badEntries(list) {
  if (!Array.isArray(list)) return 0;
  let count = 0;
  for (const entry of list) {
    if (Array.isArray(entry)) {
      // A [label, value] pair carries its label first, so only the value counts.
      const pair = entry.length === 2 && typeof entry[0] === "string";
      count += badEntries(pair ? [entry[1]] : entry);
    } else if (entry && typeof entry === "object") count += badFields(entry);
    else if (typeof entry !== "number" || !Number.isFinite(entry)) count += 1;
  }
  return count;
}

/** How many of an object's numeric fields are not numbers. */
function badFields(entry) {
  let count = 0;
  for (const key of ["value", "x", "y", "o", "h", "l", "c", "open", "high", "low", "close"]) {
    const value = entry[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) count += 1;
  }
  return count;
}

/**
 * Everything the chart had to change to draw: values that are not numbers, and
 * keys that were renamed. Each one is worth a line under the chart.
 */
function collectNotes(spec, type, guessed) {
  const notes = [];
  if (guessed) notes.push(`no type, read as ${type}`);
  if (spec.percent !== undefined && spec.showPercent === undefined) {
    notes.push("percent is now showPercent");
  }
  if (typeof spec.gap === "string") notes.push("the boundary colour is boundaryColor now");
  if (type === "heatmap" && Array.isArray(spec.columns) && !Array.isArray(spec.headers)) {
    notes.push("heatmap headers come from headers now");
  }

  const lists = [spec.values, spec.points, spec.slices, spec.candles, spec.items, spec.children];
  if (Array.isArray(spec.series)) lists.push(...spec.series.map((item) => item?.values));
  if (Array.isArray(spec.links)) lists.push(spec.links);
  if (type === "heatmap" || isHeatGrid(spec.rows ?? [])) {
    lists.push(...(spec.rows ?? []).map((row) => row?.values));
  }

  let bad = 0;
  for (const list of lists) bad += badEntries(list);
  if (bad > 0) notes.push(`${bad} non-numeric ${bad === 1 ? "value" : "values"} treated as 0`);

  return notes;
}

/** A muted line under the chart: what was changed to make the picture. */
/**
 * The note footer: what the chart had to change. It wraps instead of clipping,
 * because a warning the reader cannot see is worse than no warning, and it stops
 * at three rows so a fence with many problems cannot bury the chart.
 */
function noteRows(text, width) {
  const lines = wrapText(text, Math.max(8, width - 4)).slice(0, 3);
  if (lines.length === 3 && wrapText(text, Math.max(8, width - 4)).length > 3) {
    lines[2] = `${lines[2].slice(0, Math.max(1, width - 6))} …`;
  }
  return lines.map((line) => ({
    width,
    runs: [{ text: `  ${line}`, slice: -1, kind: "legend" }],
  }));
}

/** The rows a fence becomes, as styled runs. */
export function renderChartRows(spec = {}) {
  const requested = String(spec.type ?? "").toLowerCase();
  const known = Boolean(CHART_TYPES[requested]);
  const width = Math.max(16, Math.floor(spec.width ?? 48));

  // A type that was named and is not known is a mistake worth saying out loud.
  // Only a missing type is guessed from the shape of the data.
  if (requested && !known) {
    return [
      {
        width,
        runs: [{ text: `unknown chart type "${requested}"`, slice: -1, kind: "legend" }],
      },
    ];
  }

  const type = known ? requested : guessType(spec);
  const render = CHART_TYPES[type];
  if (!render) {
    return [{ width, runs: [{ text: "no chart data", slice: -1, kind: "legend" }] }];
  }

  const rows = render(type === requested ? spec : { ...spec, type });
  const notes = collectNotes(spec, type, !known);
  if (notes.length > 0) rows.push(...noteRows(notes.join("; "), width));
  return rows;
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
