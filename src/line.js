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
  runsText,
  tallyFromGrid,
  titleRow,
  truncate,
} from "./core.js";
import { axisRow, baseline, buildAxis, pointLabelRow, subRowOf, subRowValue, valueAtRow } from "./axis.js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

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

/** Label the last point of each series, when the row has room after it. */
function stampEndLabels(cells, series, axis, available) {
  for (const [index] of series.entries()) {
    const last = series[index].values[series[index].values.length - 1];
    const text = formatNumber(last);
    // The label belongs beside the *last* point, not beside the series' highest
    // row: a series that peaks in the middle would print its end value at the peak.
    const row = Math.max(0, Math.min(cells.length - 1, axis.rowOf(last)));
    if (row < 0) continue;
    let column = -1;
    for (let x = available - 1; x >= 0; x--) {
      const cell = cells[row][x];
      if (cell && cell.slice === index) {
        column = x;
        break;
      }
    }
    if (column < 0 || column + 1 + cols(text) > available) continue;
    const glyphs = [...text];
    for (let offset = 0; offset < glyphs.length; offset++) {
      cells[row][column + 1 + offset] = { slice: index, char: glyphs[offset], kind: "fill" };
    }
  }
  return cells;
}

/** Value at fractional position t along a series, linear between points. */
function valueAt(values, t) {
  if (values.length === 1) return values[0];
  const position = Math.max(0, Math.min(values.length - 1, t * (values.length - 1)));
  const index = Math.floor(position);
  const next = Math.min(values.length - 1, index + 1);
  return values[index] + (values[next] - values[index]) * (position - index);
}

/**
 * The sub-cell grid a line plot is drawn from: -1 is empty, otherwise the index
 * of the series that owns that sub-cell.
 *
 * `bands` is a stacked area, where every sub-cell between two cumulative lines
 * belongs to a series and is found by value.
 */
function buildGrid({ series, bands, axis, subColumns, subRows, fill }) {
  const grid = new Int8Array(subColumns * subRows).fill(-1);
  const mark = (x, y, index) => {
    if (x < 0 || y < 0 || x >= subColumns || y >= subRows) return;
    grid[y * subColumns + x] = index;
  };

  if (bands) {
    // Bands never overlap, so the owner of a value is the band that covers it.
    const tops = cumulative(series, series[0]?.values.length ?? 0);
    const bandsOf = series.map((_, index) => ({
      series: index,
      from: index === 0 ? 0 : tops[index - 1].values,
      to: tops[index].values,
    }));

    for (let column = 0; column < subColumns; column++) {
      const t = subColumns === 1 ? 0 : column / (subColumns - 1);
      for (let row = 0; row < subRows; row++) {
        const value = subRowValue(axis, row, subRows);
        for (const band of bandsOf) {
          const from = valueAt(band.from, t);
          const to = valueAt(band.to, t);
          if (value >= Math.min(from, to) && value <= Math.max(from, to)) {
            mark(column, row, band.series);
            break;
          }
        }
      }
    }
    return grid;
  }

  for (const [index, item] of series.entries()) {
    let previous = null;
    for (let column = 0; column < subColumns; column++) {
      const value = valueAt(item.values, subColumns === 1 ? 0 : column / (subColumns - 1));
      const y = subRowOf(axis, value, subRows);
      const from = previous === null ? y : Math.min(previous, y);
      const to = previous === null ? y : Math.max(previous, y);
      for (let row = from; row <= to; row++) mark(column, row, index);
      if (fill) for (let row = y; row < subRows; row++) mark(column, row, index);
      previous = y;
    }
  }

  return grid;
}

function sparklineRows(spec, width, labels, series) {
  const values = series.flatMap((item) => item.values);
  const min = spec.zero === true ? Math.min(0, ...values) : Math.min(...values);
  const max = Math.max(...values, spec.zero === true ? 0 : -Infinity);
  const span = max - min || 1;

  const rows = [];
  for (const [index, item] of series.entries()) {
    const blocks = item.values
      .map((value) => BLOCKS[Math.max(0, Math.min(7, Math.round(((value - min) / span) * 7)))])
      .join("");
    const last = formatNumber(item.values[item.values.length - 1]);
    const label = series.length > 1 ? `${padTo(truncate(item.name, width - 6), 5)} ` : "";
    rows.push({
      width: Math.min(width, cols(label) + cols(blocks) + cols(last) + 1),
      runs: [
        ...(label ? [{ text: label, slice: -1, kind: "axis" }] : []),
        { text: blocks, slice: index, kind: "fill" },
        { text: ` ${last}`, slice: index, kind: "fill" },
      ],
    });
  }
  return rows;
}

/**
 * Rows for a plot area drawn from a sub-cell grid: the gutter, the plot, the
 * zero line where the plot is empty, and the category labels.
 */
function plotRowsFromGrid({ spec, width, axis, available, sampler, grid, series, labels }) {
  const plotRows = axis.plotRows;
  const cells = Array.from({ length: plotRows }, () => Array.from({ length: available }, () => null));
  const seriesAt = (x, y) => grid[y * (available * sampler.shape.columns) + x] ?? -1;

  for (let y = 0; y < plotRows; y++) {
    for (let x = 0; x < available; x++) {
      const { mask, tally, masks } = tallyFromGrid(seriesAt, x, y, sampler);
      if (tally.size === 0) continue;
      cells[y][x] = paintCell({ sampler, mask, tally, masks, glyphs: series.map(() => SOLID) });
    }
  }

  if (spec.valueLabels !== false && series.length > 0) {
    stampEndLabels(cells, series, axis, available);
  }

  // The zero line is drawn under the data, so a chart of differences still shows
  // where zero is; a filled area covers it where it has content.
  for (let x = 0; x < available && axis.zeroRow >= 0; x++) {
    if (!cells[axis.zeroRow][x]) cells[axis.zeroRow][x] = { slice: -1, char: "─", kind: "axis" };
  }

  const rows = [];
  for (let row = 0; row < plotRows; row++) {
    const gutter = axisRow(axis, row);
    const cellsRow = cells[row].map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
    rows.push({ width, runs: [axisRun(`${gutter.text}${gutter.mark}`), ...cellsToRuns(cellsRow)] });
  }

  if (labels.length > 0) {
    rows.push({
      width,
      runs: [axisRun(BLANK.repeat(axis.gutter)), axisRun(pointLabelRow(labels, available))],
    });
  }

  return rows;
}

function scatterRows(spec, width, labels, series, given) {
  const plotRows = Math.max(3, Math.min(30, Math.floor(spec.height ?? 10)));
  const points = given.length > 0
    ? given.map((point) => ({ x: Number(point[0]) || 0, y: Number(point[1]) || 0 }))
    : series.flatMap((item) => item.values.map((value, index) => ({ x: index, y: value })));

  const ys = points.map((point) => point.y);
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const minX = Math.min(...points.map((point) => point.x), 0);
  // A scatter of prices or scores has no business touching zero unless it asks.
  const withZero = spec.zero !== false;
  const axis = buildAxis({
    min: withZero ? Math.min(0, ...ys) : Math.min(...ys),
    max: withZero ? Math.max(0, ...ys) : Math.max(...ys),
    plotRows,
    ticks: spec.ticks ?? 4,
    zero: withZero,
  });
  const available = Math.max(1, width - axis.gutter);
  const sampler = makeSampler(spec.mosaic);
  const { columns, rows: subRowsPerCell } = sampler.shape;
  const subColumns = available * columns;
  const subRows = axis.plotRows * subRowsPerCell;
  const span = axis.top - axis.bottom || 1;

  const grid = new Int8Array(subColumns * subRows).fill(-1);
  for (const point of points) {
    const x = Math.round(((point.x - minX) / (maxX - minX || 1)) * (subColumns - 1));
    const y = subRowOf(axis, point.y, subRows);
    if (x < 0 || y < 0 || x >= subColumns || y >= subRows) continue;
    // A single sub-cell is two and a half cells of nothing on screen, so a point
    // takes the sub-cell beside it too and reads as a small square.
    grid[y * subColumns + x] = 0;
    if (x + 1 < subColumns) grid[y * subColumns + x + 1] = 0;
    if (spec.big === true && y + 1 < subRows) {
      grid[(y + 1) * subColumns + x] = 0;
      if (x + 1 < subColumns) grid[(y + 1) * subColumns + x + 1] = 0;
    }
  }

  return plotRowsFromGrid({
    spec,
    width,
    axis,
    available,
    sampler,
    grid,
    series,
    labels: labels.length > 0 ? labels : points.map((point) => formatNumber(point.x)),
  });
}

export function renderLineRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const type = String(spec.type ?? "line").toLowerCase();
  const { labels, series } = normalizeSeries(spec);
  const points = Array.isArray(spec.points)
    ? spec.points.filter((point) => Array.isArray(point) && point.length >= 2)
    : [];
  const rows = [];

  if (spec.title) rows.push(titleRow(String(spec.title), width));
  if (series.length === 0 && (points.length === 0 || type !== "scatter")) {
    rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  const normalized = spec.normalized === true;
  const bands = spec.stacked === true && type === "area";
  const shown = normalized ? toPercent(series, labels.length) : series;

  if (type === "sparkline") {
    rows.push(...sparklineRows(spec, width, labels, shown));
  } else if (type === "scatter") {
    rows.push(...scatterRows(spec, width, labels, series, points));
  } else {
    const plotRows = Math.max(3, Math.min(30, Math.floor(spec.height ?? 10)));
    const flat = shown.flatMap((item) => item.values);
    // A stacked area is as tall as its tallest total, not its tallest series.
    const maxima = bands ? totalsOf(shown, labels.length) : flat;
    const lows = bands ? maxima : flat;
    const withZero = spec.zero !== false;
    const axis = buildAxis({
      min: withZero ? Math.min(0, ...lows) : Math.min(...lows),
      max: withZero ? Math.max(0, ...lows) : Math.max(...lows),
      plotRows,
      ticks: spec.ticks ?? 4,
      zero: withZero,
    });
    const available = Math.max(1, width - axis.gutter);
    const sampler = makeSampler(spec.mosaic);
    const grid = buildGrid({
      series: shown,
      bands,
      axis,
      subColumns: available * sampler.shape.columns,
      subRows: axis.plotRows * sampler.shape.rows,
      fill: type === "area" && !bands,
    });
    rows.push(...plotRowsFromGrid({ spec, width, axis, available, sampler, grid, series: shown, labels }));
  }

  if (series.length > 1 && spec.legend !== false) {
    rows.push(
      ...legendRowRuns(
        series.map((item) => ({ label: item.name, value: item.values.reduce((sum, value) => sum + value, 0) })),
        { width, values: false },
      ),
    );
  }

  return rows;
}

export { BLOCKS };
