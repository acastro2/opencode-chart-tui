// Line, area, scatter and sparkline charts.
//
// A line is drawn in the same sub-cell grid as the pie rim: every sub-column is
// connected to the previous one and the cell shows the mosaic glyph for the
// sub-cells the line covers, so it never looks like a staircase. An area fills
// every sub-cell below the line.
//
// A stacked area is a different animal: the series are bands, not lines, so each
// band is sampled by value. The series that owns a sub-cell's value is the one
// drawn there, which also gives the boundaries for free.
//
// Scatter marks the sub-cell a point falls in. A sparkline is the whole series in
// one row of eighth blocks.

import {
  BLANK,
  SOLID,
  cellsToRuns,
  cols,
  formatNumber,
  legendRowRuns,
  makeSampler,
  normalizeSeries,
  padTo,
  paintCell,
  stampText,
  tallyFromGrid,
  titleRow,
  truncate,
} from "./core.js";
import { axisRow, buildAxis, pointLabelRow, subRowOf, subRowValue } from "./axis.js";
import { plotRows as plotRowsFor } from "./layout.js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** A run of axis furniture: tick text, the axis line, the blank gutter. */
function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

/** The last value of a series, the one its end label is drawn beside. */
function lastValue(values) {
  return values[values.length - 1];
}

// --- series maths ----------------------------------------------------------

function totalsOf(series, count) {
  return Array.from({ length: count }, (_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
}

/** Each value as a percentage of its label's total, for a 100% chart. */
function toPercent(series, count) {
  const totals = totalsOf(series, count);
  return series.map((item) => ({
    name: item.name,
    values: item.values.map((value, index) => (totals[index] > 0 ? (value / totals[index]) * 100 : 0)),
  }));
}

/** Cumulative values: the top of each stacked band. */
function cumulative(series, count) {
  const running = Array.from({ length: count }, () => 0);
  return series.map((item) => ({
    name: item.name,
    values: item.values.map((value, index) => (running[index] += value)),
  }));
}

// --- naming ----------------------------------------------------------------

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Whether one `series` entry carries its own name. */
function namedItem(item) {
  return Boolean(item) && !Array.isArray(item) && hasText(item.name);
}

/** Whether the fence named a series, rather than falling back to "value". */
function namesGiven(spec) {
  if (hasText(spec.name)) return true;
  return Array.isArray(spec.series) && spec.series.some(namedItem);
}

/**
 * The cells reserved on the right for the series names: the widest name plus a
 * gap, capped at a third of the chart so the plot keeps the majority. The last
 * term keeps the axis and one plot cell, so a narrow chart never loses its data.
 */
function labelGutterFor(spec, series, width, axis) {
  if (spec.valueLabels === false || !namesGiven(spec)) return 0;
  const widest = series.reduce((most, item) => Math.max(most, cols(item.name)), 0);
  if (widest === 0) return 0;
  return Math.max(0, Math.min(widest + 1, Math.floor(width * 0.3), width - axis.gutter - 1));
}

/** One legend entry: the name, and the total the legend row prints when asked. */
function legendEntry(item) {
  return { label: item.name, value: item.values.reduce((sum, value) => sum + value, 0) };
}

// --- end labels ------------------------------------------------------------

/** The row a name wants: the last point's row, kept inside the plot. */
function labelRowFor(values, axis) {
  return Math.max(0, Math.min(axis.plotRows - 1, axis.rowOf(lastValue(values))));
}

/** A stacked band ends at its cumulative top, not at its own value. */
function endValues(item, endTops, index) {
  return endTops ? endTops[index].values : item.values;
}

/** The nearest row to `want` that no other name owns, one step out at a time. */
function nearFreeRow(taken, want, step, count) {
  const lower = want + step;
  if (lower < count && !taken.has(lower)) return lower;
  const upper = want - step;
  if (upper >= 0 && !taken.has(upper)) return upper;
  return -1;
}

/** The nearest row that no other name owns, or -1 when every row is taken. */
function freeRow(taken, want, count) {
  if (!taken.has(want)) return want;
  for (let step = 1; step < count; step++) {
    const row = nearFreeRow(taken, want, step, count);
    if (row >= 0) return row;
  }
  return -1;
}

/**
 * Where each name goes: at the row of its own last point, moved to the nearest
 * free row when another name already owns that one. A name with no free row is
 * dropped, never written over another; the caller says so in a note.
 */
function planEndLabels(series, axis, gutter, endTops = null) {
  const wanted = series.map((item, index) => ({
    text: truncate(item.name, gutter),
    index,
    row: labelRowFor(endValues(item, endTops, index), axis),
  }));
  const rows = new Map();
  let dropped = 0;
  for (const plan of wanted) {
    if (cols(plan.text) === 0) {
      dropped += 1;
      continue;
    }
    const row = freeRow(rows, plan.row, axis.plotRows);
    if (row < 0) {
      dropped += 1;
      continue;
    }
    rows.set(row, { text: plan.text, index: plan.index });
  }
  return { rows, dropped };
}

/** The rightmost column of `row` the series owns, or -1 when it owns none. */
function ownedColumn(cells, row, index, available) {
  for (let column = available - 1; column >= 0; column--) {
    const cell = cells[row][column];
    if (cell && cell.slice === index) return column;
  }
  return -1;
}

/** Whether the `width` cells from `from` are all empty, so a label can go there. */
function rowIsClear(cells, row, from, width) {
  for (let offset = 0; offset < width; offset++) if (cells[row][from + offset]) return false;
  return true;
}

/** Write one label into a plot row, one grapheme per cell. */
function writeLabel(cells, row, from, glyphs, index) {
  for (const [offset, char] of glyphs.entries()) cells[row][from + offset] = { slice: index, char, kind: "fill" };
  return cells;
}

/** The value at the end of one series, when the row after it has room. */
function stampEndLabel(cells, series, axis, available, index) {
  const last = lastValue(series[index].values);
  const text = formatNumber(last);
  // The label belongs beside the *last* point, not beside the series' highest
  // row: a series that peaks in the middle would print its end value at the peak.
  const row = Math.max(0, Math.min(cells.length - 1, axis.rowOf(last)));
  const column = ownedColumn(cells, row, index, available);
  if (column < 0) return;
  const from = column + 1;
  const width = cols(text);
  // Only write into empty cells: a label over another series' mark, over the
  // zero line or over another label reads as data that is not there. Dropping
  // it loses a number; drawing it loses the truth.
  if (from + width > available) return;
  if (!rowIsClear(cells, row, from, width)) return;
  writeLabel(cells, row, from, [...text], index);
}

/** Label the last point of each series, when the row has room after it. */
function stampEndLabels(cells, series, axis, available) {
  for (const index of series.keys()) stampEndLabel(cells, series, axis, available, index);
  return cells;
}

// --- the sub-cell grid -----------------------------------------------------

/** Value at fractional position t along a series, linear between points. */
function valueAt(values, t) {
  if (values.length === 1) return values[0];
  const position = Math.max(0, Math.min(values.length - 1, t * (values.length - 1)));
  const index = Math.floor(position);
  const next = Math.min(values.length - 1, index + 1);
  return values[index] + (values[next] - values[index]) * (position - index);
}

/** Position along a series for a sub-column: 0 at the first point, 1 at the last. */
function columnFraction(column, subColumns) {
  return subColumns === 1 ? 0 : column / (subColumns - 1);
}

function blankSubGrid(columns, rows) {
  return new Int8Array(columns * rows).fill(-1);
}

function inSubGrid(x, y, columns, rows) {
  return x >= 0 && y >= 0 && x < columns && y < rows;
}

function markSubCell(grid, x, y, index, columns, rows) {
  if (!inSubGrid(x, y, columns, rows)) return;
  grid[y * columns + x] = index;
}

/** One entry per stacked band: the series it belongs to, and its floor and top. */
function bandOwners(series, count) {
  const tops = cumulative(series, count);
  return tops.map((top, index) => ({
    series: index,
    // A band floors on the previous band's top; the first band floors on zero.
    // It must be one zero per column, not the scalar 0: `valueAt` walks an
    // array, so a scalar yields NaN and the band never claims a sub-cell.
    from: index === 0 ? new Array(count).fill(0) : tops[index - 1].values,
    to: top.values,
  }));
}

function bandCovers(band, value, t) {
  const from = valueAt(band.from, t);
  const to = valueAt(band.to, t);
  return value >= Math.min(from, to) && value <= Math.max(from, to);
}

/** The series that owns a value in a stack, or -1 above the stack. */
function bandAt(bands, value, t) {
  for (const band of bands) if (bandCovers(band, value, t)) return band.series;
  return -1;
}

/**
 * A stacked area: the bands never overlap, so the owner of a value is simply
 * the band that covers it, and the boundaries come out with it.
 */
function paintBands(grid, bands, axis, subColumns, subRows) {
  for (let column = 0; column < subColumns; column++) {
    const t = columnFraction(column, subColumns);
    for (let row = 0; row < subRows; row++) {
      const owner = bandAt(bands, subRowValue(axis, row, subRows), t);
      if (owner >= 0) markSubCell(grid, column, row, owner, subColumns, subRows);
    }
  }
  return grid;
}

/** The vertical span a line covers between two neighbouring columns. */
function spanOf(previous, y) {
  return previous === null ? { from: y, to: y } : { from: Math.min(previous, y), to: Math.max(previous, y) };
}

function paintSpan(grid, column, from, to, index, subColumns, subRows) {
  for (let row = from; row <= to; row++) markSubCell(grid, column, row, index, subColumns, subRows);
}

/** An area fills every sub-cell below its line. */
function paintBelow(grid, column, from, index, subColumns, subRows) {
  for (let row = from; row < subRows; row++) markSubCell(grid, column, row, index, subColumns, subRows);
}

/** One series as a line: every column joined to the previous one. */
function paintLineSeries(grid, item, index, { axis, subColumns, subRows, fill }) {
  let previous = null;
  for (let column = 0; column < subColumns; column++) {
    const y = subRowOf(axis, valueAt(item.values, columnFraction(column, subColumns)), subRows);
    const span = spanOf(previous, y);
    paintSpan(grid, column, span.from, span.to, index, subColumns, subRows);
    if (fill) paintBelow(grid, column, y, index, subColumns, subRows);
    previous = y;
  }
  return grid;
}

/**
 * The sub-cell grid a plot is drawn from: -1 is empty, otherwise the index of
 * the series that owns that sub-cell. `bands` is a stacked area, where every
 * sub-cell between two cumulative lines belongs to a series and is found by
 * value.
 */
function buildPlotGrid({ series, bands, axis, subColumns, subRows, fill }) {
  const grid = blankSubGrid(subColumns, subRows);
  if (bands) return paintBands(grid, bandOwners(series, series[0]?.values.length ?? 0), axis, subColumns, subRows);
  for (const [index, item] of series.entries()) paintLineSeries(grid, item, index, { axis, subColumns, subRows, fill });
  return grid;
}

// --- sparkline -------------------------------------------------------------

/** The value range a sparkline maps to its eight blocks. */
function sparkRange(spec, values) {
  if (spec.zero === true) return { min: Math.min(0, ...values), max: Math.max(0, ...values) };
  return { min: Math.min(...values), max: Math.max(...values, -Infinity) };
}

/** A value as one of the eight eighth blocks. */
function sparkBlockOf(min, span) {
  return (value) => BLOCKS[Math.max(0, Math.min(7, Math.round(((value - min) / span) * 7)))];
}

/** The slice of values one block of a squeezed sparkline covers. */
function bucketRange(index, count, length) {
  const from = Math.floor((index * length) / count);
  const to = Math.min(length, Math.max(from + 1, Math.floor(((index + 1) * length) / count)));
  return { from, to };
}

/** The value in [from, to) that strays furthest from `previous`, so a spike survives. */
function furthestFrom(values, from, to, previous) {
  let chosen = from;
  let furthest = -1;
  for (let at = from; at < to; at++) {
    const distance = Math.abs(values[at] - previous);
    if (distance > furthest) {
      furthest = distance;
      chosen = at;
    }
  }
  return chosen;
}

/**
 * Which value a squeezed sparkline keeps for one block: the first and last
 * always, because where a sparkline starts and ends is half of what it says;
 * the rest the value that strays furthest from the previous block.
 */
function sparkPick(values, index, count, previous) {
  if (index === 0) return 0;
  if (index === count - 1) return values.length - 1;
  const { from, to } = bucketRange(index, count, values.length);
  return furthestFrom(values, from, to, previous);
}

/**
 * One block per plot column, never more. With more values than columns, a bucket
 * keeps the value that strays furthest from the previous block, so a spike
 * survives the squeeze.
 */
function sparkBlocks(values, columns, blockOf) {
  const count = Math.max(1, Math.min(values.length, columns));
  if (count >= values.length) return values.map(blockOf);
  const blocks = [];
  let previous = values[0];
  for (let index = 0; index < count; index++) {
    const at = sparkPick(values, index, count, previous);
    previous = values[at];
    blocks.push(blockOf(values[at]));
  }
  return blocks;
}

/** The last value, printed after the trace. */
function sparkTail(item) {
  return ` ${formatNumber(lastValue(item.values))}`;
}

/**
 * The series name, when there is more than one row to tell apart. It gives way
 * to the trace: it may take five cells and a gap, never the plot.
 */
function sparkLabel(item, width, tail, many) {
  if (!many) return "";
  const nameWidth = Math.max(0, Math.min(5, width - cols(tail) - 2));
  if (nameWidth === 0) return "";
  return `${padTo(truncate(item.name, nameWidth), nameWidth)} `;
}

function sparkRuns(label, index, blocks, tail) {
  const runs = [
    { text: blocks, slice: index, kind: "fill" },
    { text: tail, slice: index, kind: "fill" },
  ];
  if (label) runs.unshift({ text: label, slice: -1, kind: "axis" });
  return runs;
}

/** One series as a single row: the name, the blocks, the last value. */
function sparkRow(item, index, { width, many, blockOf }) {
  const full = sparkTail(item);
  let label = sparkLabel(item, width, full, many);
  if (cols(label) + cols(full) + 1 > width) label = "";
  // On a narrow row the blocks and the last value win over the name.
  const tail = cols(full) + 1 > width ? truncate(full, Math.max(1, width - 1)) : full;
  const room = Math.max(1, width - cols(label) - cols(tail));
  const blocks = sparkBlocks(item.values, room, blockOf).join("");
  return {
    width: Math.min(width, cols(label) + cols(blocks) + cols(tail)),
    runs: sparkRuns(label, index, blocks, tail),
  };
}

function sparklineRows(spec, width, series) {
  const values = series.flatMap((item) => item.values);
  const { min, max } = sparkRange(spec, values);
  const blockOf = sparkBlockOf(min, max - min || 1);
  const many = series.length > 1;
  return series.map((item, index) => sparkRow(item, index, { width, many, blockOf }));
}

// --- plot rows -------------------------------------------------------------

/** An empty plot: one row of nulls per data row. */
function blankCells(rows, columns) {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null));
}

/** The series that owns a sub-cell of the plot grid, or -1. */
function cellSeriesAt(grid, x, y, cellColumns) {
  return grid[y * cellColumns + x] ?? -1;
}

/** Paint every plot cell from the sub-cell grid the family built. */
function paintGridCells(cells, { axis, available, sampler, grid, series }) {
  const cellColumns = available * sampler.shape.columns;
  const glyphs = series.map(() => SOLID);
  const seriesAt = (x, y) => cellSeriesAt(grid, x, y, cellColumns);
  for (let y = 0; y < axis.plotRows; y++) {
    for (let x = 0; x < available; x++) {
      const { mask, tally, masks } = tallyFromGrid(seriesAt, x, y, sampler);
      if (tally.size === 0) continue;
      cells[y][x] = paintCell({ sampler, mask, tally, masks, glyphs });
    }
  }
  return cells;
}

/**
 * The zero line is drawn under the data, so a chart of differences still shows
 * where zero is; a filled area covers it where it has content.
 */
function paintZeroLine(cells, axis, available) {
  if (axis.zeroRow < 0) return cells;
  for (let x = 0; x < available; x++) {
    if (!cells[axis.zeroRow][x]) cells[axis.zeroRow][x] = { slice: -1, char: "─", kind: "axis" };
  }
  return cells;
}

/** One plot row: the axis gutter, the painted cells, and the name in its gutter. */
function plotRow(cells, axis, row, { width, available, labelGutter, endLabels }) {
  const gutter = axisRow(axis, row);
  const cellsRow = cells[row].map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
  const end = endLabels ? endLabels.rows.get(row) : null;
  if (end) {
    // Right-aligned in the gutter: the gap is the first cell the cap takes
    // away, so a narrow chart shows the whole name and a wide one shows the
    // gap too. Either way the name is flush with the chart's right edge.
    stampText([cellsRow], available + labelGutter - cols(end.text), 0, end.text, {
      slice: end.index,
      kind: "legend",
    });
  }
  return { width, runs: [axisRun(`${gutter.text}${gutter.mark}`), ...cellsToRuns(cellsRow)] };
}

function plotBodyRows(cells, axis, options) {
  const rows = [];
  for (let row = 0; row < axis.plotRows; row++) rows.push(plotRow(cells, axis, row, options));
  return rows;
}

/** The x label row, when the fence has labels to print. */
function xLabelRows(labels, available, positions, axis, width) {
  if (labels.length === 0) return [];
  return [
    {
      width,
      runs: [axisRun(BLANK.repeat(axis.gutter)), axisRun(pointLabelRow(labels, available, positions))],
    },
  ];
}

function droppedNote(hidden) {
  return `  ${hidden} end label${hidden === 1 ? "" : "s"} dropped: no room`;
}

/** The x labels are part of the chart, so a dropped name is said after them. */
function droppedRows(endLabels, width) {
  const hidden = endLabels ? endLabels.dropped : 0;
  if (hidden === 0) return [];
  return [{ width, runs: [{ text: truncate(droppedNote(hidden), width), slice: -1, kind: "legend" }] }];
}

/** Inline value labels only when there is no name gutter to carry the names. */
function inlineValuesWanted(spec, series, labelGutter) {
  return spec.valueLabels !== false && series.length > 0 && labelGutter === 0;
}

/**
 * Rows for a plot area drawn from a sub-cell grid: the gutter, the plot, the
 * zero line where the plot is empty, and the category labels.
 */
function plotRowsFromGrid(options) {
  const { spec, width, axis, available, sampler, grid, series, labels, positions, labelGutter = 0, endTops = null } =
    options;
  const cells = blankCells(axis.plotRows, available + labelGutter);
  paintGridCells(cells, options);
  if (inlineValuesWanted(spec, series, labelGutter)) stampEndLabels(cells, series, axis, available);
  paintZeroLine(cells, axis, available);

  // The names sit in their own gutter, so they can never take a data cell. The
  // last row is the x labels, so the whole plot is above it.
  const endLabels = labelGutter > 0 ? planEndLabels(series, axis, labelGutter, endTops) : null;

  const rows = plotBodyRows(cells, axis, { width, available, labelGutter, endLabels });
  rows.push(...xLabelRows(labels, available, positions, axis, width));
  rows.push(...droppedRows(endLabels, width));
  return rows;
}

// --- scatter ---------------------------------------------------------------

/** Points from the fence's `points`, or one per value when no points were given. */
function normalizePoints(given, series) {
  if (given.length > 0) {
    const points = [];
    let dropped = 0;
    for (const point of given) {
      // A pair like ["Jan", 5] used to become x=0 through `Number(...) || 0`,
      // which drew the point in the wrong place and said nothing.
      const x = Number(point?.[0]);
      const y = Number(point?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        dropped += 1;
        continue;
      }
      points.push({ x, y });
    }
    return { points, dropped };
  }
  return {
    points: series.flatMap((item) => item.values.map((value, index) => ({ x: index, y: value }))),
    dropped: 0,
  };
}

/** The x extent of the points: always at least through zero, and never zero-wide. */
function scatterBounds(points) {
  return {
    minX: Math.min(...points.map((point) => point.x), 0),
    maxX: Math.max(...points.map((point) => point.x), 1),
  };
}

/** Round bounds covering `values`, with zero inside when asked. */
function axisBounds(values, zero) {
  return zero
    ? { min: Math.min(0, ...values), max: Math.max(0, ...values) }
    : { min: Math.min(...values), max: Math.max(...values) };
}

/** The value axis. A scatter of prices or scores has no business touching zero unless it asks. */
function scatterAxis(spec, points, plotRows) {
  const withZero = spec.zero !== false;
  const { min, max } = axisBounds(
    points.map((point) => point.y),
    withZero,
  );
  return buildAxis({ min, max, plotRows, ticks: spec.ticks ?? 4, zero: withZero });
}

/** The sub-cell column a point's x lands on. */
function scatterColumn(point, minX, maxX, subColumns) {
  return Math.round(((point.x - minX) / (maxX - minX || 1)) * (subColumns - 1));
}

/** The sub-cell a point lands in, or null when it is off the grid. */
function scatterCell(point, { axis, minX, maxX, subColumns, subRows }) {
  const x = scatterColumn(point, minX, maxX, subColumns);
  const y = subRowOf(axis, point.y, subRows);
  if (!inSubGrid(x, y, subColumns, subRows)) return null;
  return { x, y };
}

/**
 * The sub-cells a point owns: itself and its right neighbour, and the row below
 * when the point is big. A single sub-cell is two and a half cells of nothing on
 * screen, so the neighbour makes it read as a small square rather than a dot.
 */
function pointCells(x, y, big, columns, rows) {
  const takeColumns = x + 1 < columns ? [x, x + 1] : [x];
  const takeRows = big && y + 1 < rows ? [y, y + 1] : [y];
  return takeRows.flatMap((row) => takeColumns.map((column) => ({ x: column, y: row })));
}

function paintPoints(grid, cells, columns, rows) {
  for (const cell of cells) markSubCell(grid, cell.x, cell.y, 0, columns, rows);
  return grid;
}

/** Every point as a sub-cell mark, so it reads as a small square rather than a dot. */
function scatterGrid({ points, axis, minX, maxX, subColumns, subRows, big }) {
  const grid = blankSubGrid(subColumns, subRows);
  for (const point of points) {
    const cell = scatterCell(point, { axis, minX, maxX, subColumns, subRows });
    if (cell) paintPoints(grid, pointCells(cell.x, cell.y, big, subColumns, subRows), subColumns, subRows);
  }
  return grid;
}

/**
 * The cell column each point's x lands on, for its label. The even spread put
 * "5" over x=2 and made the axis lie; with many points the label row thins them.
 */
function scatterPositions(points, minX, maxX, subColumns, columns) {
  return points.map((point) => ((point.x - minX) / (maxX - minX || 1)) * ((subColumns - 1) / columns));
}

/** The x labels: the fence's own, or the number of each point. */
function scatterPointLabels(labels, points) {
  return labels.length > 0 ? labels : points.map((point) => formatNumber(point.x));
}

/** Rows the legend takes, when the fence wants one. */
function legendStorage(spec, series) {
  return series.length > 1 && spec.legend !== false ? series.length : 0;
}

/** Rows taken by the scatter's own furniture: the title, the label row and the legend. */
function scatterChrome(spec, series) {
  const title = spec.title ? 1 : 0;
  return title + 1 + legendStorage(spec, series);
}

function scatterRows(spec, width, labels, series, given, alreadyDropped = 0) {
  const { points, dropped } = normalizePoints(given, series);
  const skipped = dropped + alreadyDropped;
  const note = skippedPointsNote(width, skipped);
  const plotRows = plotRowsFor(spec, {
    chrome: scatterChrome(spec, series) + (note ? 1 : 0),
    fallback: 10,
  });
  const { minX, maxX } = scatterBounds(points);
  const axis = scatterAxis(spec, points, plotRows);
  const available = Math.max(1, width - axis.gutter);
  const sampler = makeSampler(spec.mosaic);
  const { columns, rows: subRowsPerCell } = sampler.shape;
  const subColumns = available * columns;
  const subRows = axis.plotRows * subRowsPerCell;
  const grid = scatterGrid({ points, axis, minX, maxX, subColumns, subRows, big: spec.big === true });

  const positions = scatterPositions(points, minX, maxX, subColumns, columns);
  const pointLabels = scatterPointLabels(labels, points);
  const rows = plotRowsFromGrid({
    spec,
    width,
    axis,
    available,
    sampler,
    grid,
    series,
    labels: pointLabels,
    positions: pointLabels.length === points.length ? positions : undefined,
  });
  if (note) rows.push(note);
  return rows;
}

/** A point that cannot be drawn is counted, not dropped in silence. */
function skippedPointsNote(width, skipped) {
  if (skipped <= 0) return null;
  const text = `  ${skipped} ${skipped === 1 ? "point" : "points"} skipped`;
  return { width, runs: [{ text: truncate(text, width), slice: -1, kind: "legend" }] };
}

// --- the render ------------------------------------------------------------

function resolveWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/** The fence's `points`, and how many entries cannot be drawn at all. */
function pointsFrom(spec) {
  if (!Array.isArray(spec.points)) return { points: [], dropped: 0 };
  const points = [];
  let dropped = 0;
  for (const point of spec.points) {
    if (Array.isArray(point) && point.length >= 2) points.push(point);
    else dropped += 1;
  }
  return { points, dropped };
}

function hasData(series, points, type) {
  return series.length > 0 || (points.length > 0 && type === "scatter");
}

function noDataRow(width) {
  return { width, runs: [{ text: "no data", slice: -1, kind: "legend" }] };
}

function titleRows(spec, width) {
  return spec.title ? [titleRow(String(spec.title), width)] : [];
}

/** The legend only earns its rows when there is more than one series to tell apart. */
function legendRows(spec, width, series) {
  if (series.length <= 1 || spec.legend === false) return [];
  return legendRowRuns(series.map(legendEntry), { width, values: false });
}

/** A stacked area is bands, not lines; every other type draws lines. */
function isBandChart(spec, type) {
  return spec.stacked === true && type === "area";
}

/** Rows taken by the title, the x label row and the legend. */
function seriesChrome(spec, series, labels) {
  const title = spec.title ? 1 : 0;
  const labelRows = labels.length > 0 ? 1 : 0;
  return title + labelRows + legendStorage(spec, series);
}

function plotAxis(spec, series, labels, plotRows, bands) {
  const flat = series.flatMap((item) => item.values);
  // A stacked area is as tall as its tallest total, not its tallest series.
  const values = bands ? totalsOf(series, labels.length) : flat;
  const zero = spec.zero !== false;
  const { min, max } = axisBounds(values, zero);
  return buildAxis({ min, max, plotRows, ticks: spec.ticks ?? 4, zero });
}

function shownSeries(spec, series, labels) {
  return spec.normalized === true ? toPercent(series, labels.length) : series;
}

function linePlotRows(spec, width, labels, series, type) {
  const bands = isBandChart(spec, type);
  const plotRows = plotRowsFor(spec, { chrome: seriesChrome(spec, series, labels), fallback: 10 });
  const axis = plotAxis(spec, series, labels, plotRows, bands);
  // The series names get their own right gutter; the plot is what is left, so
  // the last point sits at the last column before the gutter.
  const labelGutter = labelGutterFor(spec, series, width, axis);
  const available = Math.max(1, width - axis.gutter - labelGutter);
  const endTops = bands ? cumulative(series, labels.length) : null;
  const sampler = makeSampler(spec.mosaic);
  const grid = buildPlotGrid({
    series,
    bands,
    axis,
    subColumns: available * sampler.shape.columns,
    subRows: axis.plotRows * sampler.shape.rows,
    fill: type === "area" && !bands,
  });
  return plotRowsFromGrid({ spec, width, axis, available, sampler, grid, series, labels, labelGutter, endTops });
}

/** The three plot families. Scatter and sparkline take their own path. */
function plotFamilyRows(spec, width, labels, series, points, type, dropped) {
  const shown = shownSeries(spec, series, labels);
  if (type === "sparkline") return sparklineRows(spec, width, shown);
  if (type === "scatter") return scatterRows(spec, width, labels, series, points, dropped);
  return linePlotRows(spec, width, labels, shown, type);
}

export function renderLineRows(spec) {
  const width = resolveWidth(spec);
  const type = String(spec.type ?? "line").toLowerCase();
  const { labels, series } = normalizeSeries(spec);
  const { points, dropped } = pointsFrom(spec);

  if (!hasData(series, points, type)) {
    const note = skippedPointsNote(width, dropped);
    return [...titleRows(spec, width), noDataRow(width), ...(note ? [note] : [])];
  }

  return [
    ...titleRows(spec, width),
    ...plotFamilyRows(spec, width, labels, series, points, type, dropped),
    // The legend names the raw series, not the percentages a 100% chart shows.
    ...legendRows(spec, width, series),
  ];
}

export { BLOCKS };
