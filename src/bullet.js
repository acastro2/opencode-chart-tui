// A bullet chart: one row per measure, the actual against its target inside
// qualitative ranges.
//
// Why this shape: a bullet answers one question — are we where we said we would
// be — so a row spends its cells on two marks, the actual as a bar and the target
// as a tick, and puts the numbers in a column at the end instead of on an axis.
// The ranges are the background: they say what good looks like before the bar
// covers them.
//
// The shades are glyph densities, not colours, so the bands survive the plain
// text dump: ▓ then ▒ then ░ as the values grow, darkest first. `kind` stays
// "track" for every band, because the band is furniture; a cell outside every
// declared range is "outside", so the uncovered track still differs in colour.
//
// Every bar is the same colour — `palette[0]` — because the colour carries no
// information here: each row already names its own measure, and one hue per row
// turned a list of targets into eight competing series. The tick is the theme's
// foreground instead, the one tone that reads against the blue bar and against
// every grey band; `target` would take the bands' own muted tone and disappear
// on them.
//
// The row is a budget. The label gives way first, then the value column is cut,
// and the track keeps a cell to the end, so no row draws past its width.

import {
  SOLID,
  cellsToRuns,
  cols,
  formatNumber,
  padStart,
  padTo,
  titleRow,
  truncate,
} from "./core.js";
import { layoutFor } from "./layout.js";
import { themeOf } from "./theme.js";
import { coerce, policyFor } from "./values.js";

const TRACK = "░";
const TICK = "│";
/** The band shades, darkest first: the lowest range is the darkest. */
const BAND_GLYPHS = ["▓", "▒", "░"];
/** Values and targets share one policy: a blank and a bad number are 0. */
const BULLET_POLICY = policyFor("bullet");
/** The least track worth drawing; the label is cut before the track goes under. */
const MIN_TRACK = 8;
/** The most ranges a bullet carries: three bands is the whole vocabulary. */
const MAX_BANDS = 3;

/** The row is 16 cells wide at the very least, whatever the fence asks. */
function readWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/**
 * One item's target, or null when the fence gave none. The slot decides: an
 * array shorter than `values` has no target for the rows it does not reach,
 * while a number inside the array is read under the family policy.
 */
function targetAt(targets, index) {
  if (!targets || index >= targets.length) return null;
  return coerce(targets[index], BULLET_POLICY).value;
}

/** One row per value, with its label and its target when it has one. */
function readItems(spec) {
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const values = Array.isArray(spec.values) ? spec.values : [];
  const targets = Array.isArray(spec.targets) ? spec.targets : null;
  return values.map((raw, index) => ({
    label: String(labels[index] ?? index + 1),
    value: coerce(raw, BULLET_POLICY).value,
    target: targetAt(targets, index),
  }));
}

/** A range entry's two slots, or null when the entry is not a pair. */
function rangeSlots(entry) {
  if (!Array.isArray(entry)) return null;
  if (entry.length < 2) return null;
  return [entry[0], entry[1]];
}

/** Two numbers as a drawable range, or null when they rise the wrong way. */
function drawableRange(low, high) {
  if (!Number.isFinite(low)) return null;
  if (!Number.isFinite(high)) return null;
  if (high <= low) return null;
  return [low, high];
}

/** One declared range as `[lo, hi]`, or null when the pair cannot be drawn. */
function readRange(entry) {
  const slots = rangeSlots(entry);
  return slots ? drawableRange(Number(slots[0]), Number(slots[1])) : null;
}

/** Up to three ranges, lowest first, so the darkest band is the lowest one. */
function readRanges(spec) {
  const raw = Array.isArray(spec.ranges) ? spec.ranges : [];
  return raw
    .map(readRange)
    .filter(Boolean)
    .sort((left, right) => left[0] - right[0])
    .slice(0, MAX_BANDS);
}

/** The largest of a list of numbers, never below zero. */
function largest(values) {
  return values.reduce((top, value) => (value > top ? value : top), 0);
}

/**
 * The scale's top end: the fence's own `max`, or the largest mark in the data.
 * A range top counts, so a band is never chopped off by a value smaller than it.
 */
function readMax(spec, items, bands) {
  const given = Number(spec.max);
  if (Number.isFinite(given) && given > 0) return given;
  const marks = items.flatMap((item) => (item.target === null ? [item.value] : [item.value, item.target]));
  const top = largest([...marks, ...bands.map((range) => range[1])]);
  return top > 0 ? top : 1;
}

/** A number on the scale: a mark cannot draw outside the track. */
function onScale(value, max) {
  return Math.max(0, Math.min(value, max));
}

/** The value column: `72 → 100` against a target, `72` without one. */
function valueTextOf(item) {
  const value = formatNumber(item.value);
  return item.target === null ? value : `${value} → ${formatNumber(item.target)}`;
}

/** The label block: a space either side and two after. */
function labelCells(labelWidth) {
  return labelWidth > 0 ? labelWidth + 3 : 0;
}

/** The value block: one space, then the column. */
function valueCells(valueWidth) {
  return valueWidth > 0 ? valueWidth + 1 : 0;
}

/** The cells left for the track once the text has taken its share. */
function trackCells(width, labelWidth, valueWidth) {
  return width - labelCells(labelWidth) - valueCells(valueWidth);
}

/** The label may take two fifths of the row; a longer one is cut, not squeezed. */
function naturalLabelWidth(labels, width) {
  const widest = largest(labels.map((label) => cols(label)));
  return widest === 0 ? 0 : Math.min(widest, Math.max(4, Math.floor(width * 0.4)));
}

/** Cut the label until the track has its room, or until the label is gone. */
function fitLabel(width, natural, valueWidth) {
  let current = natural;
  while (current > 0 && trackCells(width, current, valueWidth) < MIN_TRACK) {
    current = current <= 2 ? 0 : current - 1;
  }
  return current;
}

/**
 * The columns: a label gutter, the track, and a right-aligned value. The value
 * yields last, but it is capped so a fence with huge numbers still keeps track
 * cells; a column narrower than its text is cut by `valueRun`.
 */
function fitColumns(width, items) {
  const widest = largest(items.map((item) => cols(item.text)));
  const valueWidth = Math.min(widest, Math.max(1, width - 3));
  const natural = naturalLabelWidth(items.map((item) => item.label), width);
  return { labelWidth: fitLabel(width, natural, valueWidth), valueWidth };
}

/** The shades for the bands, darkest first. */
function bandGlyphs(count) {
  return BAND_GLYPHS.slice(0, Math.max(0, Math.min(count, BAND_GLYPHS.length)));
}

/** The band a value falls in, or -1 when it is outside every declared range. */
function bandOf(value, bands) {
  for (let index = 0; index < bands.length; index++) {
    if (value >= bands[index][0] && value < bands[index][1]) return index;
  }
  return -1;
}

/** The value a track cell stands for: its middle, so a band edge lands once. */
function cellValue(column, trackWidth, max) {
  return ((column + 0.5) / trackWidth) * max;
}

/** One cell of the track, before the bar and the tick are drawn over it. */
function trackCell(column, trackWidth, max, bands, glyphs) {
  if (bands.length === 0) return { char: TRACK, slice: -1, kind: "track" };
  const band = bandOf(cellValue(column, trackWidth, max), bands);
  if (band < 0) return { char: TRACK, slice: -1, kind: "outside" };
  return { char: glyphs[band], slice: -1, kind: "track" };
}

/** The columns the actual covers, rounded so the bar ends nearest its value. */
function fillCells(value, max, trackWidth) {
  return Math.round((onScale(value, max) / max) * trackWidth);
}

/** The column a target sits on: its left edge, and the last cell at the max. */
function tickColumn(target, max, trackWidth) {
  const fraction = onScale(target, max) / max;
  return Math.min(trackWidth - 1, Math.max(0, Math.floor(fraction * trackWidth)));
}

/**
 * The track with the actual painted over it, then the target tick on top: the
 * tick cuts the bar in two, which is the one mark a reader looks for.
 *
 * Every bar cell asks for slice 0, so the whole chart is one palette colour. The
 * tick asks for the theme foreground on a mark kind, because `target` is
 * furniture and would come out the same muted grey as the bands it crosses.
 */
function itemCells(item, geometry, theme) {
  const { trackWidth, max, bands, glyphs } = geometry;
  const filled = fillCells(item.value, max, trackWidth);
  const tick = item.target === null ? -1 : tickColumn(item.target, max, trackWidth);
  const cells = [];
  for (let column = 0; column < trackWidth; column++) {
    if (column === tick) cells.push({ char: TICK, slice: -1, kind: "series", color: theme.foreground });
    else if (column < filled) cells.push({ char: SOLID, slice: 0, kind: "fill" });
    else cells.push(trackCell(column, trackWidth, max, bands, glyphs));
  }
  return cells;
}

function labelRun(label, width) {
  return { text: ` ${padTo(truncate(label, width), width)}  `, slice: -1, kind: "axis" };
}

/**
 * The value column is text, not a chip: pinning the chart background stops a
 * series colour there reading as one more mark.
 */
function valueRun(text, width, theme) {
  return {
    text: ` ${padStart(truncate(text, width), width)}`,
    slice: -1,
    kind: "label",
    background: theme.background,
  };
}

/** One row: the label gutter, the track, the value column. */
function itemRow(item, geometry, theme) {
  const runs = [];
  if (geometry.labelWidth > 0) runs.push(labelRun(item.label, geometry.labelWidth));
  runs.push(...cellsToRuns(itemCells(item, geometry, theme)));
  runs.push(valueRun(item.text, geometry.valueWidth, theme));
  return { width: geometry.width, runs };
}

/** How many marks sat above the scale, by kind, for one note. */
function clampCounts(items, max) {
  return items.reduce(
    (counts, item) => ({
      values: counts.values + (item.value > max ? 1 : 0),
      targets: counts.targets + (item.target !== null && item.target > max ? 1 : 0),
    }),
    { values: 0, targets: 0 },
  );
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The sentence for clamped marks, or null when every mark fits the scale. */
function clampNote(counts, max) {
  const parts = [];
  if (counts.values > 0) parts.push(plural(counts.values, "value"));
  if (counts.targets > 0) parts.push(plural(counts.targets, "target"));
  if (parts.length === 0) return null;
  return `${parts.join(" and ")} clamped to max ${formatNumber(max)}`;
}

/** One note row, indented and cut to the row width. */
function noteRows(note, width) {
  if (!note) return [];
  return [{ width, runs: [{ text: truncate(`  ${note}`, width), slice: -1, kind: "legend" }] }];
}

/** A chart with no rows to draw says so instead of drawing nothing. */
function emptyRows(title, width) {
  return [...(title ? [title] : []), { width, runs: [{ text: "  no data", slice: -1, kind: "legend" }] }];
}

export function renderBulletRows(spec = {}) {
  const width = readWidth(spec);
  const title = spec.title ? titleRow(String(spec.title), width) : null;
  const items = readItems(spec);
  if (items.length === 0) return emptyRows(title, width);

  const bands = readRanges(spec);
  const max = readMax(spec, items, bands);
  const note = clampNote(clampCounts(items, max), max);
  // The note is data loss, so the ledger pays for it before the plot: a clamp
  // note never pushes a row past the height the fence asked for.
  const plotRows = layoutFor(spec, {
    title: title ? 1 : 0,
    labels: 0,
    notes: note ? 1 : 0,
    fallback: items.length,
    min: 2,
    max: 30,
  }).plotRows;

  const drawn = items.slice(0, plotRows).map((item) => ({ ...item, text: valueTextOf(item) }));
  const { labelWidth, valueWidth } = fitColumns(width, drawn);
  const geometry = {
    width,
    trackWidth: Math.max(1, trackCells(width, labelWidth, valueWidth)),
    max,
    bands,
    glyphs: bandGlyphs(bands.length),
    labelWidth,
    valueWidth,
  };

  const theme = themeOf(spec);
  return [
    ...(title ? [title] : []),
    ...drawn.map((item) => itemRow(item, geometry, theme)),
    ...noteRows(note, width),
  ];
}
