// Vertical bars (grouped, stacked or 100%) and horizontal bars, in plain text
// or in colour.
//
// Bars are sampled by value rather than by row: for every cell, the sub-cells
// of the bar's own sub-grid are translated back into values, and the series that
// owns each value is the one drawn there. That one idea gives:
//
//   1. partial cells at eighth-of-a-cell precision, upward and downward, so a
//      bar can grow away from the zero line in both directions;
//   2. stacked bars whose internal boundary is a partial block over the colour
//      of the series behind it, the same two-colour trick the pie uses;
//   3. negative values, drawn below the zero line without a second code path.
//
// Horizontal bars keep the cheaper geometry: a bar is a run of full cells plus
// one left block, which is exact enough and needs no sub-cells.
//
// Every step is a small function that returns data: the column plan, the stack
// ranges, the cells, the labels. A reader can check one rule at a time, and a
// test can call the rule without drawing a chart.

import {
  BLANK,
  SOLID,
  cellsToRuns,
  cols,
  formatNumber,
  formatPercent,
  legendRowRuns,
  makeSampler,
  normalizeSeries,
  padTo,
  paintCell,
  seriesGlyphs,
  showPercentOf,
  titleRow,
  truncate,
} from "./core.js";
import { axisRow, baseline, buildAxis, categoryRow, pointLabelRow, valueAtRow } from "./axis.js";
import { themeOf } from "./theme.js";
import { layoutFor } from "./layout.js";

const LEFT = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"]; // filled from the left
const TRACK = "░";

/** At most this many cells of bar for one category, so wide charts stay readable. */
const MAX_BAR_WIDTH = 12;
/** At most this many blank columns between two bar groups. */
const MAX_GAP = 4;

/** The block that fills the left `fraction` of a cell, empty when there is none. */
function leftGlyph(fraction) {
  const step = Math.round(Math.max(0, Math.min(1, fraction)) * 8);
  return step >= 8 ? SOLID : step <= 0 ? "" : LEFT[step - 1];
}

function seriesTotals(series, count) {
  return Array.from({ length: count }, (_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
}

/** Each value as a percentage of its label's total, for a 100% chart. */
function toPercent(series, count) {
  const totals = seriesTotals(series, count);
  return series.map((item) => ({
    name: item.name,
    values: item.values.map((value, index) => (totals[index] > 0 ? (value / totals[index]) * 100 : 0)),
  }));
}

/** A 100% chart draws percentages; any other chart draws the values as given. */
function shownSeries(spec, series, count) {
  return spec.normalized === true ? toPercent(series, count) : series;
}

/** A 100% chart is a stack by definition. */
function isStacked(spec) {
  return spec.stacked === true || spec.normalized === true;
}

function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

/**
 * The blank columns between two groups. A gap that grows with the bar, so four
 * wide bars are not four planks with a hairline between them.
 */
function gapFor(perLabel, stacked, seriesCount) {
  if (perLabel <= (stacked ? 1 : seriesCount)) return 0;
  return Math.max(1, Math.min(MAX_GAP, Math.round(perLabel * 0.25)));
}

/** The columns one series gets inside one label's group. */
function barWidthFor(perLabel, gap, stacked, seriesCount) {
  const room = stacked ? perLabel - gap : Math.floor((perLabel - gap) / seriesCount);
  return Math.max(1, Math.min(MAX_BAR_WIDTH, room));
}

/** Which series owns a slot inside one group; -1 for a stack. */
function slotSeries(slot, barWidth, stacked) {
  return stacked ? -1 : Math.floor(slot / barWidth);
}

/** Every plot column: its label and its series, or null for a group gap. */
function columnSlots(labelCount, groupWidth, gap, leftPad, barWidth, stacked) {
  const blanks = (count) => Array.from({ length: count }, () => null);
  const group = (index) =>
    Array.from({ length: groupWidth }, (_, slot) => ({ label: index, series: slotSeries(slot, barWidth, stacked) }));
  const columns = blanks(leftPad);
  const starts = [];
  for (let index = 0; index < labelCount; index++) {
    starts.push(columns.length);
    columns.push(...group(index), ...blanks(gap));
  }
  return { columns, starts };
}

/**
 * The column plan: which label and which series owns each plot column, plus the
 * blank columns between groups and the group starts.
 *
 * `used` is the plan's own width, which is what the caller compares against the
 * space it has. It counts the gaps between groups, never the trailing one.
 */
function planColumns(labels, seriesCount, stacked, available) {
  const perLabel = Math.max(1, Math.min(MAX_BAR_WIDTH * seriesCount, Math.floor(available / labels.length)));
  const gap = gapFor(perLabel, stacked, seriesCount);
  const barWidth = barWidthFor(perLabel, gap, stacked, seriesCount);
  const groupWidth = stacked ? barWidth : barWidth * seriesCount;
  const used = labels.length * (groupWidth + gap) - gap;
  // Marks start at the axis, not centred in the leftover space. Centring reads
  // as "the chart begins halfway across", and at 160 columns a three-category
  // chart floated away from its own axis.
  const leftPad = 0;
  const { columns, starts } = columnSlots(labels.length, groupWidth, gap, leftPad, barWidth, stacked);
  return { columns, starts, barWidth, groupWidth, gap, leftPad, used };
}

/** One legend row per series, when the chart has more than one and shows it. */
function legendRowsFor(spec, seriesCount) {
  if (seriesCount <= 1) return 0;
  return spec.legend === false ? 0 : seriesCount;
}

/** The axis a stack covers by its totals, otherwise every bar on its own. */
function axisFor(spec, shown, totals, stacked, plotRows) {
  const flat = shown.flatMap((item) => item.values);
  return buildAxis({
    min: stacked ? Math.min(0, ...totals) : Math.min(0, ...flat),
    max: stacked ? Math.max(0, ...totals) : Math.max(0, ...flat),
    plotRows,
    ticks: spec.ticks ?? 4,
  });
}

/**
 * As many categories as fit one column each. A category needs at least one
 * column, so when there are more categories than columns the first ones that
 * fit are kept and the loss is named; drawing past the plot is what made a
 * 20-bin histogram 23 cells wide at width 16.
 */
function fitVisible(labels, seriesCount, stacked, available) {
  let visible = labels.length;
  let plan = planColumns(labels.slice(0, visible), seriesCount, stacked, available);
  while (visible > 1 && plan.used > available) {
    visible -= 1;
    plan = planColumns(labels.slice(0, visible), seriesCount, stacked, available);
  }
  return { visible, plan };
}

/**
 * The column plan and axis a vertical layout will use, computed without drawing.
 * The bars and their label row both read their positions from here, so a caller
 * that asks whether its labels fit measures the geometry the bars really use.
 */
function verticalPlan(spec, width, labels, series, noteRow = false) {
  // Title, the label row under the bars, and one legend row per series when the
  // chart has more than one. `height` is the whole block; `plotRows` is the bars.
  // `noteRow` is the caller's second pass, when the first pass found categories
  // the width cannot hold. The note is a row too, so it is reserved here rather
  // than read from the spec: a fence key must never change the plot.
  const legendRows = legendRowsFor(spec, series.length);
  const plotRows = layoutFor(spec, {
    title: spec.title ? 1 : 0,
    labels: 1,
    legend: legendRows,
    notes: noteRow ? 1 : 0,
    fallback: 9,
  }).plotRows;
  const normalized = spec.normalized === true;
  const shown = shownSeries(spec, series, labels.length);
  const stacked = isStacked(spec);
  const totals = seriesTotals(shown, labels.length);
  const axis = axisFor(spec, shown, totals, stacked, plotRows);
  // One cell of slack: a bar may paint its last cell one past the plan, and a
  // row that is longer than the chart wraps in the terminal.
  const available = Math.max(1, width - axis.gutter - 1);
  const { visible, plan } = fitVisible(labels, series.length, stacked, available);
  return {
    plotRows,
    normalized,
    shown,
    stacked,
    totals,
    axis,
    ...plan,
    labels: labels.slice(0, visible),
    hidden: labels.length - visible,
  };
}

function labelRow(spec, plan, labels) {
  const { columns, starts, groupWidth, gap, leftPad, labels: visibleLabels } = plan;
  const shownLabels = visibleLabels ?? labels;
  return spec.slotLabels === false
    ? // Labels longer than a bar slot (bin edges, dates) are thinned instead
      // of being cut down to one letter, and each one is centred on the bar
      // it belongs to rather than spread over the whole row.
      pointLabelRow(
        shownLabels,
        columns.length,
        starts.map((start) => start + (groupWidth - 1) / 2),
      )
    : // The labels start where the bars start: `slotOffset` is the padding
      // `planColumns` added in front of the first group.
      categoryRow(shownLabels, { groupWidth, gap, width: columns.length, slotOffset: leftPad });
}

/**
 * The bar fence a caller's own series is drawn with: no title (the caller
 * prints its own), no legend, no percentages, and labels thinned rather than cut
 * down to a slot. A fresh object, so nothing the caller's fence carries (its
 * `series`, a `stacked`) leaks into the bar chart of its values.
 */
function suppliedSeriesSpec(spec, plotHeight) {
  return {
    type: "bar",
    width: Math.max(16, Math.floor(spec.width ?? 48)),
    plotHeight,
    ticks: spec.ticks,
    mosaic: spec.mosaic,
    textured: spec.textured,
    gap: spec.gap,
    showPercent: false,
    legend: false,
    valueLabels: spec.valueLabels === true,
    slotLabels: false,
  };
}

/**
 * How a vertical bar chart would draw `values` under `labels`, measured without
 * drawing it: the label row as text, how many labels the width hides, and the
 * fence to draw them with. This is the one query a caller with its own series
 * (the histogram) needs, so it never assembles a bar spec just to measure it.
 *
 * `notes` is the rows the caller prints around the plot besides the title (its
 * footer). The ledger pays for the title, the label row and those rows before
 * the plot, so the whole block keeps the height it promised. A note the width
 * forces out is a row too: the fence comes back with a plot one row shorter, so
 * the caller's block still fits.
 *
 * With no `height` or `plotHeight` the plot falls back to 8 rows.
 */
export function measureVerticalBars(spec, labels, values, { notes = 0 } = {}) {
  const counts = { title: spec.title ? 1 : 0, labels: 1, notes, fallback: 8 };
  const plot = layoutFor(spec, counts).plotRows;
  const fence = suppliedSeriesSpec(spec, plot);
  const plan = verticalPlan(fence, fence.width, labels, [{ name: "count", values }]);
  const noteCostsARow = plan.hidden > 0 && Number(spec.height) > 0 && spec.plotHeight == null;
  // Retry with the hidden-category note reserved, so its row comes out of the
  // same ledger and the caller prints exactly `height` rows.
  const fitted = noteCostsARow ? layoutFor(spec, { ...counts, notes: notes + 1 }).plotRows : plot;
  return {
    labelRow: labelRow(fence, plan, labels),
    hidden: plan.hidden,
    spec: { ...fence, plotHeight: fitted },
  };
}

/**
 * The value range each series covers inside one label. A stack runs the totals
 * up; a grouped group gives every series its own bar, from zero to its value.
 */
function stackRanges(shown, index, stacked) {
  if (!stacked) return shown.map((item, seriesIndex) => ({ series: seriesIndex, from: 0, to: item.values[index] }));
  let running = 0;
  return shown.map((item, seriesIndex) => {
    const from = running;
    running += item.values[index];
    return { series: seriesIndex, from, to: running };
  });
}

/** Whether one range covers a value, on either side of zero. */
function covers(part, value) {
  return value >= Math.min(part.from, part.to) && value < Math.max(part.from, part.to);
}

/** The series index that owns a value inside one label's stack, or -1. */
function stackIndexAt(stack, value) {
  for (const part of stack) {
    if (covers(part, value)) return part.series;
  }
  return -1;
}

/**
 * The series a cell draws at `value`: the whole stack when stacked, otherwise
 * only the column's own bar, from zero to its own value, so a grouped bar
 * ignores its neighbours instead of standing on their total.
 */
function barOwner(stack, value, stacked, columnSeries) {
  if (stacked) return stackIndexAt(stack, value);
  const own = stack[columnSeries];
  return own && covers(own, value) ? own.series : -1;
}

/** Add one sub-row of a cell's sub-grid to the tally, and return its bits. */
function addSubRow(masks, tally, index, subRow, columns) {
  let bits = 0;
  for (let subColumn = 0; subColumn < columns; subColumn++) bits |= 1 << (subRow * columns + subColumn);
  masks.set(index, (masks.get(index) ?? 0) | bits);
  tally.set(index, (tally.get(index) ?? 0) + columns);
  return bits;
}

/** Sample one cell of a vertical plot as sub-cells, by value. */
function sampleBar(sampler, axis, row, owner) {
  const { shape } = sampler;
  let mask = 0;
  const tally = new Map();
  const masks = new Map();
  for (let subRow = 0; subRow < shape.rows; subRow++) {
    const index = owner(valueAtRow(axis, row + (subRow + 0.5) / shape.rows));
    if (index < 0) continue;
    mask |= addSubRow(masks, tally, index, subRow, shape.columns);
  }
  return { mask, tally, masks };
}

function cellCount(tally) {
  let total = 0;
  for (const count of tally.values()) total += count;
  return total;
}

/** The painted cell, or null when the bar is too thin for this mode. */
function paintPlotCell(sampler, axis, row, column, stack, stacked, glyphs) {
  const owner = (value) => barOwner(stack, value, stacked, column.series);
  const { mask, tally, masks } = sampleBar(sampler, axis, row, owner);
  if (cellCount(tally) < sampler.minimum) return null;
  return paintCell({ sampler, mask, tally, masks, glyphs });
}

/** The plot grid: one row of cells per row, null where nothing is drawn. */
function paintPlot(spec, plan, series, stacks) {
  const sampler = makeSampler(spec.mosaic);
  const glyphs = series.map(() => SOLID);
  return Array.from({ length: plan.plotRows }, (_, row) =>
    plan.columns.map((column) =>
      column ? paintPlotCell(sampler, plan.axis, row, column, stacks[column.label], plan.stacked, glyphs) : null,
    ),
  );
}

/** One bar's value as its label: the share for a 100% chart, the number otherwise. */
function valueText(shown, raw, index, normalized) {
  return normalized ? `${Math.round(shown.values[index])}%` : formatNumber(raw.values[index]);
}

/** Write one value into the top cell of a bar, centred, when it fits the bar. */
function stampOneValue(cells, text, start, barWidth) {
  if (cols(text) > barWidth) return;
  const row = cells.findIndex((line) => line[start]);
  if (row < 0) return;
  const from = start + Math.floor((barWidth - cols(text)) / 2);
  [...text].forEach((char, offset) => {
    cells[row][from + offset] = { slice: 0, char, kind: "label" };
  });
}

/** A single series with room for its number can afford it; a stack cannot. */
function stampable(series, spec, barWidth) {
  return series.length === 1 && spec.valueLabels !== false && barWidth >= 2;
}

function stampBarValues(cells, plan, series) {
  for (const [index, start] of plan.starts.entries()) {
    const text = valueText(plan.shown[0], series[0], index, plan.normalized);
    stampOneValue(cells, text, start, plan.barWidth);
  }
}

/** The zero row is a data row too: a bar under one row tall lives here. */
function zeroRowRuns(axis, cells, above, below) {
  const line = baseline(axis, cells.length);
  const mark = line.line[0] ?? "─";
  // The axis line runs through the middle of this row, so a bar that rises from
  // zero owns the upper half of the cell and one that falls owns the lower half.
  // A full block here hung half a cell below the line, which reads as "the bar
  // starts under zero".
  const filled = cells.map((cell, column) => {
    if (!cell) return { slice: -1, char: mark, kind: "axis", mask: 0 };
    const up = Boolean(above?.[column]);
    const down = Boolean(below?.[column]);
    const char = up && down ? "█" : down ? "▄" : "▀";
    return { ...cell, char };
  });
  return [axisRun(`${line.text}${line.mark}`), ...cellsToRuns(filled)];
}

function dataRowRuns(axis, cells, row) {
  const gutter = axisRow(axis, row);
  const filled = cells.map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
  return [axisRun(`${gutter.text}${gutter.mark}`), ...cellsToRuns(filled)];
}

function verticalRows(axis, cells, width) {
  return cells.map((line, row) => ({
    width,
    runs:
      row === axis.zeroRow
        ? zeroRowRuns(axis, line, cells[row - 1], cells[row + 1])
        : dataRowRuns(axis, line, row),
  }));
}

/**
 * Vertical bars: one column group per label, growing away from the zero line.
 * `stacked` puts the series on top of each other, `normalized` makes every stack
 * 100% of its label.
 */
export function layoutVerticalBars(spec, width, labels, series, noteRow = false) {
  const plan = verticalPlan(spec, width, labels, series, noteRow);
  const stacks = plan.labels.map((_, index) => stackRanges(plan.shown, index, plan.stacked));
  const cells = paintPlot(spec, plan, series, stacks);
  if (stampable(series, spec, plan.barWidth)) stampBarValues(cells, plan, series);

  const rows = verticalRows(plan.axis, cells, width);
  rows.push({
    width,
    runs: [axisRun(BLANK.repeat(plan.axis.gutter)), axisRun(labelRow(spec, plan, labels))],
  });

  return { width, rows, barWidth: plan.barWidth, groupWidth: plan.groupWidth, hidden: plan.hidden };
}

/** The order to print in: by value for a single-series ranking, else as given. */
function rankingOrder(spec, labels, series) {
  const order = labels.map((_, index) => index);
  if (spec.sort !== true || series.length !== 1) return order;
  return order.sort((a, b) => series[0].values[b] - series[0].values[a]);
}

/** The largest bar: a stack's total, or one series value, never zero. */
function barMaximum(shown, totals, stacked) {
  const values = stacked ? totals : shown.flatMap((item) => item.values);
  return Math.max(...values, 0) || 1;
}

/** Space for the category names: their widest, at most 40% of the chart. */
function labelWidthFor(labels, width) {
  const widest = Math.max(...labels.map((text) => cols(text)), 1);
  return Math.max(1, Math.min(widest, Math.max(4, Math.floor(width * 0.4))));
}

/** A share column only makes sense for one plain series. */
function percentColumn(spec, stacked, seriesCount) {
  return showPercentOf(spec) && !stacked && seriesCount === 1;
}

/** The value a stack row reports: its own for one series, else the label's total. */
function stackValue(series, totals, index) {
  return series.length === 1 ? series[0].values[index] : totals[index];
}

/** One entry per printed row, so the value column can be measured first. */
function horizontalLines(order, shown, series, totals, stacked, grand) {
  const lines = [];
  for (const index of order) {
    if (stacked) {
      lines.push({ index, series: -1, value: stackValue(series, totals, index), total: totals[index] });
      continue;
    }
    for (const [seriesIndex, item] of shown.entries()) {
      lines.push({ index, series: seriesIndex, value: item.values[index], total: grand });
    }
  }
  return lines;
}

/** The value column, and the share after it when the chart asks for one. */
function valueSuffix(line, geometry) {
  const value = ` ${formatNumber(line.value).padStart(geometry.valueWidth)}`;
  if (!geometry.showPercent) return value;
  return `${value} ${formatPercent(line.value, line.total).padStart(geometry.percentWidth)}`;
}

/** The category name, blank on the continuation rows of a group or a stack. */
function nameRun(line, geometry) {
  if (!geometry.stacked && line.series !== 0) return BLANK.repeat(geometry.prefix);
  const name = truncate(geometry.labels[line.index], geometry.labelWidth);
  return ` ${padTo(name, geometry.labelWidth)}  `;
}

function trackRuns(remaining) {
  return remaining > 0 ? [{ text: TRACK.repeat(remaining), slice: -1, kind: "track" }] : [];
}

/** A plain row: whole cells, one left block for the fraction, then the track. */
function plainBarRuns(line, geometry) {
  const exact = (line.value / geometry.max) * geometry.barWidth;
  const whole = Math.max(0, Math.floor(exact));
  const edge = leftGlyph(exact - whole);
  const runs = [];
  if (whole > 0) runs.push({ text: SOLID.repeat(whole), slice: line.series, kind: "fill" });
  if (edge) runs.push({ text: edge, slice: line.series, kind: "fill" });
  if (geometry.track) runs.push(...trackRuns(geometry.barWidth - whole - cols(edge)));
  return runs;
}

/** The stack parts one column touches, bottom first. */
function stackEnds(ranges, low, high) {
  const parts = ranges
    .filter((part) => part.to > low && part.from < high && part.to > 0)
    .sort((a, b) => a.from - b.from);
  return { parts, bottom: parts[0], top: parts[parts.length - 1] };
}

/** One column of a stack, or null where the stack has not reached. */
function stackedColumnRun(ranges, low, high) {
  const { bottom, top } = stackEnds(ranges, low, high);
  if (!bottom) return null;
  const filled = (Math.min(bottom.to, high) - Math.max(bottom.from, low)) / (high - low);
  const whole = top === bottom;
  return {
    text: leftGlyph(filled),
    slice: bottom.series,
    kind: whole ? "fill" : "edge",
    other: whole ? -1 : top.series,
  };
}

/** A stacked row: each column keeps the series of the lowest stack it touches. */
function stackedBarRuns(shown, line, geometry) {
  // A normalized bar divides its own label's total, so every bar is full.
  const scale = geometry.normalized ? geometry.totals[line.index] || 1 : geometry.max;
  let running = 0;
  const ranges = shown.map((item, index) => {
    const from = running;
    running += item.values[line.index];
    return { series: index, from, to: running };
  });

  const runs = [];
  for (let column = 0; column < geometry.barWidth; column++) {
    const low = (column / geometry.barWidth) * scale;
    const run = stackedColumnRun(ranges, low, ((column + 1) / geometry.barWidth) * scale);
    if (run) runs.push(run);
  }
  return runs;
}

/** Blank cells after the bar, when the chart is wider than the bar's value. */
function paddingRuns(runs, barWidth) {
  const used = runs.reduce((sum, run) => sum + cols(run.text), 0);
  if (barWidth - used <= 0) return [];
  return [{ text: BLANK.repeat(barWidth - used), slice: -1, kind: "outside" }];
}

/**
 * The suffix that carries the value. It sits outside the bar, so a series
 * background there looks like another bar segment; the chart background and the
 * theme foreground keep it a label.
 */
function valueRun(line, geometry, theme) {
  return {
    text: valueSuffix(line, geometry),
    slice: -1,
    kind: "label",
    color: theme.foreground,
    background: theme.background,
  };
}

function horizontalRow(line, geometry, theme) {
  const runs = geometry.stacked ? stackedBarRuns(geometry.shown, line, geometry) : plainBarRuns(line, geometry);
  return {
    width: geometry.width,
    runs: [
      axisRun(nameRun(line, geometry)),
      ...runs,
      ...paddingRuns(runs, geometry.barWidth),
      valueRun(line, geometry, theme),
    ],
  };
}

/**
 * Horizontal bars: one row per label for a single series, one row per series per
 * label otherwise. This is the shape a ranking wants, and `sort` orders it.
 */
export function layoutHorizontalBars(spec, width, labels, series) {
  const normalized = spec.normalized === true;
  const shown = shownSeries(spec, series, labels.length);
  const stacked = isStacked(spec);
  const totals = seriesTotals(shown, labels.length);
  const order = rankingOrder(spec, labels, series);
  const grand = shown.reduce((sum, item) => sum + item.values.reduce((a, b) => a + b, 0), 0);
  const lines = horizontalLines(order, shown, series, totals, stacked, grand);

  const valueWidth = Math.max(...lines.map((line) => cols(formatNumber(line.value))), 1);
  const labelWidth = labelWidthFor(labels, width);
  const prefix = labelWidth + 3;
  const showPercent = percentColumn(spec, stacked, series.length);
  const percentWidth = showPercent ? 7 : 0;
  const suffix = 1 + valueWidth + (showPercent ? 1 + percentWidth : 0);

  const geometry = {
    labels,
    shown,
    totals,
    stacked,
    normalized,
    width,
    max: barMaximum(shown, totals, stacked),
    labelWidth,
    prefix,
    valueWidth,
    percentWidth,
    showPercent,
    track: spec.track === true,
    barWidth: Math.max(3, width - prefix - suffix),
  };
  const theme = themeOf(spec);
  return { width, rows: lines.map((line) => horizontalRow(line, geometry, theme)) };
}

/** A chart with no rows to draw says so instead of drawing nothing. */
function emptyRows(spec, width) {
  const title = spec.title ? [titleRow(String(spec.title), width)] : [];
  return [...title, { width, runs: [{ text: "no data", slice: -1, kind: "legend" }] }];
}

function hiddenRow(width, hidden) {
  // A horizontal layout never hides a category, so it reports no count at all.
  if (!(hidden > 0)) return [];
  const label = `${hidden} ${hidden === 1 ? "category" : "categories"} hidden`;
  const short = `${hidden} cats hidden`;
  return [{ width, runs: [{ text: cols(label) <= width ? label : short, slice: -1, kind: "legend" }] }];
}

function legendRows(spec, width, series) {
  if (series.length <= 1 || spec.legend === false) return [];
  const entries = series.map((item) => ({
    label: item.name,
    value: item.values.reduce((sum, value) => sum + value, 0),
  }));
  // A 100% chart shows the real total per series, so the reader can see how much
  // the shares are shares of. Everything else lists names only.
  return legendRowRuns(entries, spec.normalized === true ? { width, percent: false } : { width, values: false });
}

function barLayout(spec, width, labels, series, noteRow = false) {
  const horizontal = spec.type === "hbar" || spec.horizontal === true;
  return horizontal
    ? layoutHorizontalBars(spec, width, labels, series)
    : layoutVerticalBars(spec, width, labels, series, noteRow);
}

/** Title, the chart, and its notes: the rows a bar fence prints. */
function chartRows(spec, width, labels, series) {
  const title = spec.title ? [titleRow(String(spec.title), width)] : [];
  let layout = barLayout(spec, width, labels, series);
  // The hidden-category note costs a row. A shorter plot can change the gutter
  // through the tick count, so the second pass may hide a different number; the
  // note printed is always the second pass's own count.
  if (layout.hidden > 0 && Number(spec.height) > 0) {
    layout = barLayout(spec, width, labels, series, true);
  }
  return [...title, ...layout.rows, ...hiddenRow(width, layout.hidden), ...legendRows(spec, width, series)];
}

function texturedRun(run) {
  return run.kind === "fill" && run.slice >= 0;
}

function textureRun(run, glyphs) {
  run.text = [...run.text]
    .map((char) => (char === SOLID ? glyphs[run.slice % glyphs.length] : char))
    .join("");
}

/** Plain-text callers still need the textured fills to tell series apart. */
function textureRows(rows, seriesCount) {
  const glyphs = seriesGlyphs(seriesCount);
  for (const row of rows) {
    for (const run of row.runs) {
      if (texturedRun(run)) textureRun(run, glyphs);
    }
  }
  return rows;
}

export function renderBarRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const { labels, series } = normalizeSeries(spec);
  if (labels.length === 0 || series.length === 0) return emptyRows(spec, width);
  const rows = chartRows(spec, width, labels, series);
  return spec.textured === true ? textureRows(rows, series.length) : rows;
}
