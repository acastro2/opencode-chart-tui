// Shared pieces for every chart drawn in a character grid: the palette, colour
// helpers, the run model, the legend, and the sub-cell sampler that lets a curve
// follow something finer than a whole cell.
//
// Nothing here knows what a pie or a bar is. Each family imports this and adds
// its own geometry.

import { glyphFor, modeName, modeShape } from "./mosaic.js";
import { coerceList, policyFor } from "./values.js";
import {
  displayWidth,
  graphemeWidth,
  graphemes,
  padByWidth,
  padStartByWidth,
  truncateByWidth,
  wrapByWidth,
} from "./text.js";

export const SOLID = "█";
export const BLANK = " ";

/** Textures for callers with no colour, so neighbouring series still differ. */
export const TEXTURES = {
  four: ["█", "░", "▓", "▒"],
  eight: ["█", "░", "▓", "▒", "▚", "▞", "▨", "▩"],
};

/** Line characters chosen by the direction of a boundary a cell crosses. */
export const SPOKE = {
  horizontal: "─",
  vertical: "│",
  downRight: "╲", // upper left to lower right, y grows downward
  upRight: "╱",
};

/** Default series colours, ordered for maximum separation at small sizes. */
export const DEFAULT_PALETTE = [
  "#4e9de0", // blue
  "#57c98a", // green
  "#e5b83c", // amber
  "#e5695f", // red
  "#a98bd8", // violet
  "#43b8b0", // teal
  "#e08bc0", // pink
  "#9a9a52", // olive
];

/** WCAG relative luminance: linearise every sRGB channel first. */
function relativeLuminance(hex) {
  const value = String(hex).replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, (char) => char + char) : value.slice(0, 6);
  const channel = (offset) => {
    const part = parseInt(full.slice(offset, offset + 2), 16) / 255;
    if (!Number.isFinite(part)) return 0;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio, 1 to 21. */
function contrastRatio(a, b) {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return (high + 0.05) / (low + 0.05);
}

/**
 * Dark text on a light fill, light text on a dark fill. Compare the two real
 * ratios instead of guessing from one luminance threshold; the old rule picked
 * the weaker colour for mid-tone fills.
 */
export function contrastOn(hex) {
  const fill = relativeLuminance(hex);
  const dark = relativeLuminance("#101010");
  const light = relativeLuminance("#ffffff");
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? "#101010" : "#ffffff";
}

/** "62.0%" */
export function formatPercent(value, total) {
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * `showPercent` is the contract. `percent` is the old name, still accepted so an
 * existing fence keeps drawing while the note tells the author what changed.
 */
export function showPercentOf(spec, fallback = true) {
  if (spec?.showPercent !== undefined) return Boolean(spec.showPercent);
  if (spec?.percent !== undefined) return Boolean(spec.percent);
  return fallback;
}

/** The unit suffixes formatNumber can reach, largest last. */
const NUMBER_UNITS = ["", "k", "M", "G", "T", "P"];

/** Two decimals under 10, one under 100, none above; trailing decimal zeros dropped. */
function roundScaled(scaled) {
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const text = scaled.toFixed(digits);
  // Strip trailing zeros after a decimal point only: 1.20 -> 1.2, but 120 stays 120.
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** The largest unit the number reaches, and the mantissa in that unit. */
function compactScaled(size) {
  let power = 0;
  let scaled = size;
  while (scaled >= 1000 && power < NUMBER_UNITS.length - 1) {
    scaled /= 1000;
    power += 1;
  }
  return { power, scaled };
}

/** A number at or above 1000, in the shortest unit that does not round to 1000. */
function compactNumber(size) {
  const { power, scaled } = compactScaled(size);
  const text = roundScaled(scaled);
  const rounded = Number(text) >= 1000 && power < NUMBER_UNITS.length - 1;
  if (!rounded) return `${text}${NUMBER_UNITS[power]}`;
  return `${roundScaled(size / 1000 ** (power + 1))}${NUMBER_UNITS[power + 1]}`;
}

/** A number below 1000: two significant digits under 0.01, else the rounded value. */
function magnitudeText(size) {
  if (size < 0.01) return `${Number(size.toPrecision(2))}`;
  return size < 1000 ? roundScaled(size) : compactNumber(size);
}

/**
 * Short numbers for axes and value labels: 1234 -> "1.23k", 2500000 -> "2.5M",
 * 0.25 -> "0.25". Keeps the gutter narrow without lying about the magnitude: a
 * value under 0.01 keeps two significant digits instead of rounding to "0", and
 * 999,999 reads as "1M" rather than "1000k", because the unit is chosen after
 * the mantissa is rounded.
 */
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "?";
  if (number === 0) return "0";
  const sign = number < 0 ? "-" : "";
  return `${sign}${magnitudeText(Math.abs(number))}`;
}

/**
 * Width in terminal cells, not code points and not UTF-16 units. A mosaic glyph
 * is one cell; a CJK character is two; a combining mark is zero.
 */
export function cols(text) {
  return displayWidth(text);
}

/** Cut to a width in cells, with an ellipsis when it does not fit. */
export function truncate(text, width) {
  return truncateByWidth(text, width);
}

/** Pad to a width in cells. */
export function padTo(text, width) {
  return padByWidth(text, width);
}

/** Pad with spaces on the left, so numbers line up under each other. */
export function padStart(text, width) {
  return padStartByWidth(text, width);
}

/** An array entry as `{ label, value }`, with the label already a string. */
function arrayEntry(item) {
  return { label: String(item[0] ?? ""), value: Number(item[1]) };
}

/** An object entry as `{ label, value }`, with the label already a string. */
function objectEntry(item) {
  return { label: String(item?.label ?? ""), value: Number(item?.value) };
}

/** One entry in either accepted shape, normalized. */
function entryParts(item) {
  return Array.isArray(item) ? arrayEntry(item) : objectEntry(item);
}

/** A value a chart can draw: finite and above zero. */
function positiveValue(value) {
  return Number.isFinite(value) && value > 0;
}

/** Accept [[label, value]] or [{ label, value }], drop empty values, keep order. */
export function normalizeEntries(input) {
  const entries = [];
  for (const item of input ?? []) {
    const { label, value } = entryParts(item);
    if (!positiveValue(value)) continue;
    entries.push({ label, value });
  }
  return entries;
}

/** Running totals as fractions of 1. */
export function cumulativeFractions(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  let running = 0;
  return values.map((value) => {
    running += value / total;
    return running;
  });
}

/** One glyph per series, for callers with no colour. */
export function seriesGlyphs(count) {
  if (count <= 0) return [];
  const set = count <= 4 ? TEXTURES.four : TEXTURES.eight;
  return Array.from({ length: count }, (_, index) => set[index % set.length]);
}

/** Blend two colours, for a gradient: t is 0 at `from` and 1 at `to`. */
export function mixHex(from, to, t) {
  const parse = (hex) => {
    const value = String(hex).replace("#", "");
    const full = value.length === 3 ? value.replace(/./g, (char) => char + char) : value.slice(0, 6);
    return [
      parseInt(full.slice(0, 2), 16) || 0,
      parseInt(full.slice(2, 4), 16) || 0,
      parseInt(full.slice(4, 6), 16) || 0,
    ];
  };
  const start = parse(from);
  const end = parse(to);
  const amount = Math.max(0, Math.min(1, Number(t) || 0));
  return `#${start
    .map((channel, index) => Math.round(channel + (end[index] - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Blend two colours perceptually (OKLab) instead of channel by channel: a ramp
 * from dark blue to red through a perceptual space keeps its lightness, where
 * sRGB mixing dips through muddy browns.
 */
export function mixOklab(from, to, t) {
  const amount = Math.max(0, Math.min(1, Number(t) || 0));
  const start = oklabOf(from);
  const end = oklabOf(to);
  return hexOfOklab({
    L: start.L + (end.L - start.L) * amount,
    a: start.a + (end.a - start.a) * amount,
    b: start.b + (end.b - start.b) * amount,
  });
}

function channels(hex) {
  const value = String(hex).replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, (char) => char + char) : value.slice(0, 6);
  return [
    (parseInt(full.slice(0, 2), 16) || 0) / 255,
    (parseInt(full.slice(2, 4), 16) || 0) / 255,
    (parseInt(full.slice(4, 6), 16) || 0) / 255,
  ];
}

const linear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const gamma = (channel) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** sRGB hex to OKLab (Björn Ottosson's matrices). */
function oklabOf(hex) {
  const [red, green, blue] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function hexOfOklab({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channelsOut = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${channelsOut
    .map((channel) => Math.round(clamp01(gamma(clamp01(channel))) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** True when the spec named its series; otherwise `values` is the one series. */
function hasSeries(spec) {
  return Array.isArray(spec.series) && spec.series.length > 0;
}

/** The raw series list: `series` wins over `values`, and neither is an error. */
function seriesSource(spec, fallbackName) {
  if (hasSeries(spec)) return spec.series;
  if (!Array.isArray(spec.values)) return [];
  return [{ name: spec.name ?? fallbackName, values: spec.values }];
}

/**
 * The value policy the spec's family declares. The name is lowercased, because
 * a fence that says "PIE" draws the same family as one that says "pie". A spec
 * with no family keeps the strict policy: there is no declaration to read.
 */
function policyOf(spec) {
  return policyFor(String(spec?.type ?? "").toLowerCase());
}

/**
 * The numbers of one series, copied so padding cannot touch the caller's array,
 * and read by the same policy the footer reports. A value the policy drops stays
 * a hole rather than a zero: the series position is the label's position, so a
 * removed point would move every label after it.
 */
function seriesValues(item, policy) {
  const numbers = Array.isArray(item) ? item : (item?.values ?? []);
  return coerceList(numbers, policy).values;
}

/** The name of a plain-array series: the spec's name, or the fallback. */
function arrayItemName(spec, fallbackName) {
  return spec.name ?? fallbackName;
}

/** The name of an object series: its own, the spec's, or its position. */
function namedItemName(item, spec, index) {
  return item?.name ?? spec.name ?? `series ${index + 1}`;
}

/** The name of one series item, whichever shape it came in. */
function itemName(item, spec, index, fallbackName) {
  return Array.isArray(item) ? arrayItemName(spec, fallbackName) : namedItemName(item, spec, index);
}

function longerOf(longest, item) {
  return Math.max(longest, item.values.length);
}

function labelCount(spec) {
  return Array.isArray(spec.labels) ? spec.labels.length : 0;
}

/** The longest series or label list: the number of points every series must have. */
function seriesLength(series, spec) {
  return Math.max(series.reduce(longerOf, 0), labelCount(spec));
}

/** Pad every series to `length` with zeros, in place. */
function padSeries(series, length) {
  for (const item of series) while (item.values.length < length) item.values.push(0);
}

function labelAt(labels, index) {
  return String(labels[index] ?? index + 1);
}

/** Labels from the spec when given, else the point's position. */
function labelsFor(spec, length) {
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  return Array.from({ length }, (_, index) => labelAt(labels, index));
}

/**
 * The series shape every chart family shares: labels plus one or more named
 * series of numbers. Accepts `values: [..]` for a single series or
 * `series: [{ name, values }]`, and a plain array of numbers for a series.
 * Missing labels become their position. Each value is read by the family's own
 * value policy, so the drawing and the dispatcher's footer cannot disagree: a
 * value the policy drops stays a hole in its slot, never a silent zero.
 */
export function normalizeSeries(spec, fallbackName = "value") {
  const policy = policyOf(spec);
  const series = [];
  for (const [index, item] of seriesSource(spec, fallbackName).entries()) {
    const values = seriesValues(item, policy);
    if (values.length === 0) continue;
    series.push({ name: String(itemName(item, spec, index, fallbackName)), values });
  }

  const length = seriesLength(series, spec);
  padSeries(series, length);
  return { labels: labelsFor(spec, length), series };
}

/** Kept for callers that already speak of slices. */
export const sliceGlyphs = seriesGlyphs;

/** Sentinel for a sub-cell outside the shape; a series index can be NaN. */
const OUTSIDE = Symbol("outside");

/** The shape's predicate: false, null, undefined and negatives mean "not here". */
function inShape(value) {
  return value !== false && value !== null && value !== undefined && !(value < 0);
}

/** The series index of a sub-cell, or OUTSIDE. `true` means series 0. */
function subCellSeries(value) {
  if (!inShape(value)) return OUTSIDE;
  return value === true ? 0 : value;
}

/** Add one owned sub-cell to the mask and the two tallies. */
function addSubCell(state, index, bit) {
  state.mask |= bit;
  state.masks.set(index, (state.masks.get(index) ?? 0) | bit);
  state.tally.set(index, (state.tally.get(index) ?? 0) + 1);
}

/** Sample every sub-cell of one cell through `classify`. */
function sampleCell(sampler, x, y, classify) {
  const { shape } = sampler;
  const state = { mask: 0, tally: new Map(), masks: new Map() };
  for (let row = 0; row < shape.rows; row++) {
    for (let column = 0; column < shape.columns; column++) {
      // Sub-cell centres, centred on the cell (-1/3, 0, +1/3 for a sextant).
      // Centring matters: an offset grid sampled from the cell edge is not
      // symmetric, so a rim drifts half a sub-cell.
      const index = subCellSeries(
        classify(
          x + (column + 0.5 - shape.columns / 2) / shape.columns,
          y + (row + 0.5 - shape.rows / 2) / shape.rows,
        ),
      );
      if (index !== OUTSIDE) addSubCell(state, index, 1 << (row * shape.columns + column));
    }
  }
  return state;
}

/** The glyph for a mask, or the series glyph when the cell is fully filled. */
function glyphOf(sampler, mask, solidGlyph = SOLID) {
  return mask === sampler.solidMask ? solidGlyph : glyphFor(mask, sampler.mosaic);
}

/**
 * Sub-cell sampler: every cell is sampled as a small grid (2x2, 2x3 or 2x4)
 * and drawn with the mosaic glyph that fills exactly the sub-cells inside the
 * shape. This is what makes a rim or a line follow the curve.
 *
 * @param {string|false} [mode] "sextant" (default), "octant", "quadrant", or
 *   false for quadrant, the universal-font fallback.
 */
export function makeSampler(mode) {
  // Sextants (Unicode 13) are the default: the glyphs are present in every
  // terminal font that draws blocks at all. Octants (Unicode 16) are smoother
  // and one field away — `"mosaic": "octant"` — but a font without them turns
  // the sub-cell rim into boxes, and a width check cannot see that.
  //
  // A name `modeName` does not know (`"octants"`) is that default too: the
  // sampler runs inside the TUI's measure pass, outside the plugin's try/catch,
  // so a typo must draw the standard grid rather than lose the whole frame.
  const mosaic = mode === false ? "quadrant" : modeName(mode);
  const shape = modeShape(mosaic);
  const subCells = shape.columns * shape.rows;
  const sampler = {
    mosaic,
    shape,
    subCells,
    solidMask: 2 ** subCells - 1,
    // A quadrant cell needs two of its four sub-cells before it joins the shape,
    // which is what the whole-cell renderer used to do. Finer modes can claim a
    // cell with a single sub-cell, because a fragment is already more faithful.
    minimum: mosaic === "quadrant" ? 2 : 1,
  };
  // Bound rather than closed over: a nested function would be one more branch
  // for the complexity gate, and binding keeps `this` irrelevant to callers.
  sampler.sample = sampleCell.bind(null, sampler);
  sampler.glyph = glyphOf.bind(null, sampler);
  return sampler;
}

/**
 * The same tally, read from a grid that already knows which series owns each
 * sub-cell: `seriesAt(subX, subY)` returns the series index or -1. Line and
 * area charts build the grid first and then ask this what each cell shows,
 * which keeps the sub-cell arithmetic in one place.
 */
export function tallyFromGrid(seriesAt, x, y, sampler) {
  const { columns, rows } = sampler.shape;
  const tally = new Map();
  const masks = new Map();
  let mask = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = seriesAt(x * columns + column, y * rows + row);
      if (!(index >= 0)) continue;
      const bit = 1 << (row * columns + column);
      mask |= bit;
      masks.set(index, (masks.get(index) ?? 0) | bit);
      tally.set(index, (tally.get(index) ?? 0) + 1);
    }
  }
  return { mask, tally, masks };
}

/**
 * What a cell shows, given the sub-cells inside it. One implementation of the
 * two-colour boundary: a cell crossed by a boundary carries both series at once,
 * the glyph filling the winning one and the cell background showing the other.
 *
 * @returns {{slice: number, other?: number, char: string, kind: string, mask: number}}
 *   kind is "fill" (also at the shape's edge, where the winner paints every
 *   owned sub-cell so nothing spills outside and no dark tick lands on the
 *   shape), "edge" (two series at once, wholly inside) or "spoke" when a
 *   `spoke` callback is supplied and the boundary meets the edge.
 */
export function paintCell({ sampler, mask, tally, masks, glyphs = [], solidGlyph = SOLID, spoke }) {
  const winner = winnerOf(tally);
  const winnerMask = masks.get(winner) ?? 0;

  if (winnerMask !== mask) {
    const other = secondIndex(tally, winner);
    if (mask === sampler.solidMask) {
      return { slice: winner, other, char: sampler.glyph(winnerMask), kind: "edge", mask };
    }
    if (spoke) return { slice: winner, other, char: spoke(winner), kind: "spoke", mask };
    return { slice: winner, other, char: sampler.glyph(mask), kind: "fill", mask };
  }

  return { slice: winner, char: sampler.glyph(mask, glyphs[winner] ?? solidGlyph), kind: "fill", mask };
}

/** Majority series of a cell, ties broken by the lower index. */
export function winnerOf(tally) {
  let winner = -1;
  let best = -1;
  for (const [index, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > best) {
      best = count;
      winner = index;
    }
  }
  return winner;
}

/** The most common series in a cell that is not the winner. */
export function secondIndex(tally, winner) {
  let other = -1;
  let best = -1;
  for (const [index, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (index === winner || count <= best) continue;
    best = count;
    other = index;
  }
  return other;
}

/** The style fields a run compares on, with the cell's absent values spelled out. */
function cellStyle(cell) {
  return {
    other: cell.other ?? -1,
    color: cell.color ?? null,
    background: cell.background ?? null,
  };
}

/** True when a run carries the same explicit colours as `style`. */
function sameColour(run, style) {
  return (run.color ?? null) === style.color && (run.background ?? null) === style.background;
}

/** True when `cell` belongs to the run, so its glyph can extend the text. */
function sameRun(run, cell, style) {
  return run.slice === cell.slice && run.kind === cell.kind && run.other === style.other && sameColour(run, style);
}

/** A fresh run for a cell that starts one. */
function startRun(cell, style) {
  const run = { text: cell.char, slice: cell.slice, kind: cell.kind, other: style.other };
  // A run may carry its own colours, which is how a heat map paints a ramp
  // instead of a palette entry.
  if (style.color) run.color = style.color;
  if (style.background) run.background = style.background;
  return run;
}

function isBlankRun(run) {
  return run.text.trim() === "";
}

/** Drop the trailing blank runs: they carry no information and lengthen the frame. */
function dropTrailingBlanks(runs) {
  while (runs.length > 0 && isBlankRun(runs[runs.length - 1])) runs.pop();
  return runs;
}

/** Cells to runs, merged while series, kind and the second series agree. */
export function cellsToRuns(cells) {
  const runs = [];
  for (const cell of cells) {
    const style = cellStyle(cell);
    const current = runs[runs.length - 1];
    if (current && sameRun(current, cell, style)) {
      current.text += cell.char;
      continue;
    }
    runs.push(startRun(cell, style));
  }
  return dropTrailingBlanks(runs);
}

/** The plain text of a run row. */
export function runsText(runs) {
  return runs.map((run) => run.text).join("");
}

/** A single title row. */
export function titleRow(title, width) {
  return { width, runs: [{ text: truncate(title, width), slice: -1, kind: "title" }] };
}

function legendLayout(entries, options) {
  const width = Math.max(12, Math.floor(options.width ?? options.inner ?? 48));
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const values = entries.map((entry) => String(entry.value));
  const valueWidth = Math.max(...values.map((value) => value.length));
  const percentWidth = 6; // "100.0%"
  const indent = options.markers ? 2 : 0;
  const labelWidth = Math.max(4, width - indent - valueWidth - percentWidth - 2);
  return { width, total, values, valueWidth, percentWidth, labelWidth };
}

/** Legend lines in plain text, aligned on the label and the value. */
export function legendLines(entries, options = {}) {
  const glyphs = options.glyphs ?? [];
  const markers = options.markers ?? new Set(glyphs).size > 1;
  const { width, total, values, valueWidth, percentWidth, labelWidth } = legendLayout(entries, {
    ...options,
    markers,
  });

  return entries.map((entry, index) => {
    const prefix = markers ? `${glyphs[index] ?? "•"} ` : "";
    // A caller can drop the percentage and keep the value, which is what a 100%
    // chart wants in its legend: the shares are on the chart, not in the list.
    const tail =
      options.percent === false
        ? values[index].padStart(valueWidth)
        : `${values[index].padStart(valueWidth)} ${formatPercent(entry.value, total).padStart(percentWidth)}`;
    return padTo(`${prefix}${padTo(truncate(entry.label, labelWidth), labelWidth)}${tail}`, width);
  });
}

/** The same legend as runs, so each marker keeps its series colour. */
export function legendRowRuns(entries, options = {}) {
  // markers is true so the label width leaves room for the marker column.
  const { width, total, values, valueWidth, percentWidth, labelWidth } = legendLayout(entries, {
    ...options,
    markers: true,
  });
  const marker = options.marker ?? "●";

  if (options.values === false) {
    return entries.map((entry, index) => ({
      width,
      runs: [
        { text: `${marker} `, slice: index, kind: "legend-mark" },
        { text: truncate(entry.label, Math.max(1, width - 2)), slice: -1, kind: "legend" },
      ],
    }));
  }

  return entries.map((entry, index) => ({
    width,
    runs: [
      { text: `${marker} `, slice: index, kind: "legend-mark" },
      { text: padTo(truncate(entry.label, labelWidth), labelWidth), slice: -1, kind: "legend" },
      {
        text:
          options.percent === false
            ? values[index].padStart(valueWidth)
            : `${values[index].padStart(valueWidth)} ${formatPercent(entry.value, total).padStart(percentWidth)}`,
        slice: -1,
        kind: "legend",
      },
    ],
  }));
}

/**
 * A grid of empty cells. Every shape family draws into one of these and then
 * turns it into runs, which is what keeps text and colour two renderings of the
 * same layout.
 */
export function blankGrid(width, height) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ slice: -1, char: BLANK, kind: "outside", mask: 0 })),
  );
}

/** True when a cell is the second half of a wide glyph. */
function isContinuation(cell) {
  return Boolean(cell && cell.cont);
}

/** A composing mark belongs to the glyph before it, not to a cell of its own. */
function attachMark(row, cursor, mark) {
  let base = cursor - 1;
  while (base > 0 && isContinuation(row[base])) base -= 1;
  if (row[base]) row[base] = { ...row[base], char: row[base].char + mark };
}

/** Write one grapheme, and the empty continuation cell when it is wide. */
function writeGlyph(row, cursor, char, cells, template) {
  row[cursor] = { ...template, char };
  if (cells === 2) row[cursor + 1] = { ...template, char: "", cont: true };
}

/** Write one grapheme at the cursor; false when it does not fit and the run ends. */
function stampGrapheme(state, char) {
  const cells = graphemeWidth(char);
  if (cells === 0) {
    attachMark(state.row, state.cursor, char);
    return true;
  }
  if (state.cursor + cells > state.row.length) return false;
  writeGlyph(state.row, state.cursor, char, cells, state.template);
  state.cursor += cells;
  state.written += cells;
  return true;
}

/**
 * Write text into a grid, one grapheme per cell (two for a wide glyph), clipped
 * to the grid. A wide glyph leaves an empty continuation cell so the row still
 * has exactly one grid entry per terminal column.
 */
export function stampText(grid, x, y, text, template = {}) {
  const row = grid[y];
  if (!row) return 0;
  const state = { row, cursor: Math.max(0, Math.floor(x)), written: 0, template };
  for (const char of graphemes(text)) {
    if (!stampGrapheme(state, char)) break;
  }
  return state.written;
}

/** Fill a rectangle of a grid, clipped to the grid. */
export function fillRect(grid, x0, y0, x1, y1, template = {}) {
  const char = template.char ?? BLANK;
  for (let y = Math.max(0, y0); y <= Math.min(grid.length - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(grid[y].length - 1, x1); x++) {
      grid[y][x] = { ...template, char, mask: 0 };
    }
  }
}

/** Border characters, with the caller's overrides on top. */
function boxGlyphs(template) {
  return { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", ...(template.glyph ?? {}) };
}

function drawHorizontalEdges(grid, x0, x1, y0, y1, glyph, template) {
  for (let x = x0 + 1; x < x1; x++) stampText(grid, x, y0, glyph.h, template);
  if (y1 !== y0) for (let x = x0 + 1; x < x1; x++) stampText(grid, x, y1, glyph.h, template);
}

function drawVerticalEdges(grid, x0, x1, y0, y1, glyph, template) {
  for (let y = y0 + 1; y < y1; y++) stampText(grid, x0, y, glyph.v, template);
  if (x1 !== x0) for (let y = y0 + 1; y < y1; y++) stampText(grid, x1, y, glyph.v, template);
}

function drawCorners(grid, x0, y0, x1, y1, glyph, template) {
  stampText(grid, x0, y0, glyph.tl, template);
  stampText(grid, x1, y0, glyph.tr, template);
  if (y1 === y0) return;
  stampText(grid, x0, y1, glyph.bl, template);
  stampText(grid, x1, y1, glyph.br, template);
}

/** Draw a box border into a grid, clipped to the grid. */
export function drawBox(grid, x0, y0, x1, y1, template = {}) {
  if (x1 < x0 || y1 < y0) return;
  const glyph = boxGlyphs(template);
  drawHorizontalEdges(grid, x0, x1, y0, y1, glyph, template);
  drawVerticalEdges(grid, x0, x1, y0, y1, glyph, template);
  drawCorners(grid, x0, y0, x1, y1, glyph, template);
}

/**
 * Greedy word wrap in display cells. A word longer than the line is broken
 * rather than dropped, and a blank line in the text stays a blank line.
 */
export function wrapText(text, width) {
  return wrapByWidth(text, width);
}
