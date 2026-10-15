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
  titleRow,
  truncate,
} from "./core.js";
import { axisRow, baseline, buildAxis, categoryRow, pointLabelRow, valueAtRow } from "./axis.js";

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

function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

/**
 * The column plan: which label and which series owns each plot column, plus the
 * blank columns between groups and the group starts.
 */
function planColumns(labels, seriesCount, stacked, available) {
  const perLabel = Math.max(1, Math.min(MAX_BAR_WIDTH * seriesCount, Math.floor(available / labels.length)));
  // A gap that grows with the bar, so four wide bars are not four planks with a
  // hairline between them.
  const gap = perLabel > (stacked ? 1 : seriesCount) ? Math.max(1, Math.min(MAX_GAP, Math.round(perLabel * 0.25))) : 0;
  const barWidth = stacked
    ? Math.max(1, Math.min(MAX_BAR_WIDTH, perLabel - gap))
    : Math.max(1, Math.min(MAX_BAR_WIDTH, Math.floor((perLabel - gap) / seriesCount)));
  const groupWidth = stacked ? barWidth : barWidth * seriesCount;
  const stride = groupWidth + gap;
  const used = labels.length * stride - gap;
  const leftPad = Math.max(0, Math.floor((available - used) / 2));

  const columns = [];
  const starts = [];
  for (let slot = 0; slot < leftPad; slot++) columns.push(null);
  for (const [index] of labels.entries()) {
    starts.push(columns.length);
    for (let slot = 0; slot < groupWidth; slot++) {
      columns.push({ label: index, series: stacked ? -1 : Math.floor(slot / barWidth) });
    }
    for (let slot = 0; slot < gap; slot++) columns.push(null);
  }
  return { columns, starts, barWidth, groupWidth, gap, leftPad };
}

/**
 * Vertical bars: one column group per label, growing away from the zero line.
 * `stacked` puts the series on top of each other, `normalized` makes every stack
 * 100% of its label.
 */
export function layoutVerticalBars(spec, width, labels, series) {
  const plotRows = Math.max(3, Math.min(30, Math.floor(spec.height ?? 9)));
  const normalized = spec.normalized === true;
  const shown = normalized ? toPercent(series, labels.length) : series;
  const stacked = spec.stacked === true || normalized;

  const totals = seriesTotals(shown, labels.length);
  const flat = shown.flatMap((item) => item.values);
  const axis = buildAxis({
    min: stacked ? Math.min(0, ...totals) : Math.min(0, ...flat),
    max: stacked ? Math.max(0, ...totals) : Math.max(0, ...flat),
    plotRows,
    ticks: spec.ticks ?? 4,
  });
  // One cell of slack: a bar may paint its last cell one past the plan, and a
  // row that is longer than the chart wraps in the terminal.
  const available = Math.max(1, width - axis.gutter - 1);
  const { columns, starts, barWidth, groupWidth, gap, leftPad } = planColumns(labels, series.length, stacked, available);

  // The value range each label's stack covers, in series order.
  const stacks = labels.map((_, index) => {
    let running = 0;
    return shown.map((item, seriesIndex) => {
      const from = running;
      running += item.values[index];
      return { series: seriesIndex, from, to: running };
    });
  });

  const sampler = makeSampler(spec.mosaic);
  const shape = sampler.shape;
  const glyphs = series.map(() => SOLID);
  const cells = Array.from({ length: plotRows }, () =>
    Array.from({ length: columns.length }, () => null),
  );

  for (let row = 0; row < plotRows; row++) {
    for (const [columnIndex, column] of columns.entries()) {
      if (!column) continue;
      const stack = stacks[column.label];
      const inStack = (value) => {
        for (const part of stack) {
          if (value >= Math.min(part.from, part.to) && value < Math.max(part.from, part.to)) return part.series;
        }
        return -1;
      };
      const owner = (value) => {
        const found = inStack(value);
        if (found < 0) return -1;
        return stacked ? found : found === column.series ? found : -1;
      };

      // Sample the cell as the mode's sub-cell grid, by value.
      let mask = 0;
      const tally = new Map();
      const masks = new Map();
      for (let subRow = 0; subRow < shape.rows; subRow++) {
        const y = row + (subRow + 0.5) / shape.rows;
        const index = owner(valueAtRow(axis, y));
        if (index < 0) continue;
        for (let subColumn = 0; subColumn < shape.columns; subColumn++) {
          const bit = 1 << (subRow * shape.columns + subColumn);
          mask |= bit;
          masks.set(index, (masks.get(index) ?? 0) | bit);
          tally.set(index, (tally.get(index) ?? 0) + 1);
        }
      }

      let inside = 0;
      for (const count of tally.values()) inside += count;
      if (inside < sampler.minimum) continue;
      cells[row][columnIndex] = paintCell({ sampler, mask, tally, masks, glyphs });
    }
  }

  // A single series can afford its value written into the top cell of each bar.
  if (series.length === 1 && spec.valueLabels !== false && barWidth >= 2) {
    for (const [index, start] of starts.entries()) {
      const text = normalized ? `${Math.round(shown[0].values[index])}%` : formatNumber(series[0].values[index]);
      if (cols(text) > barWidth) continue;
      const row = cells.findIndex((line) => line[start]);
      if (row < 0) continue;
      const from = start + Math.floor((barWidth - cols(text)) / 2);
      const glyphs_ = [...text];
      for (let offset = 0; offset < glyphs_.length; offset++) {
        cells[row][from + offset] = { slice: 0, char: glyphs_[offset], kind: "label" };
      }
    }
  }

  const rows = [];
  for (let row = 0; row < plotRows; row++) {
    if (row === axis.zeroRow) {
      // The zero row is a data row too: a bar under one row tall lives here, so
      // the axis line is drawn only where nothing was painted.
      const line = baseline(axis, columns.length);
      const mark = line.line[0] ?? "─";
      const zeroRow = cells[row].map((cell) => cell ?? { slice: -1, char: mark, kind: "axis", mask: 0 });
      rows.push({ width, runs: [axisRun(`${line.text}${line.mark}`), ...cellsToRuns(zeroRow)] });
      continue;
    }
    const gutter = axisRow(axis, row);
    const cellsRow = cells[row].map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
    rows.push({ width, runs: [axisRun(`${gutter.text}${gutter.mark}`), ...cellsToRuns(cellsRow)] });
  }

  rows.push({
    width,
    runs: [
      axisRun(BLANK.repeat(axis.gutter)),
      axisRun(
        spec.slotLabels === false
          ? // Labels longer than a bar slot (bin edges, dates) are thinned instead
            // of being cut down to one letter, and each one is centred on the bar
            // it belongs to rather than spread over the whole row.
            pointLabelRow(
              labels,
              columns.length,
              starts.map((start) => start + (groupWidth - 1) / 2),
            )
          : // The labels start where the bars start: `slotOffset` is the padding
            // `planColumns` added in front of the first group.
            categoryRow(labels, { groupWidth, gap, width: columns.length, slotOffset: leftPad }),
      ),
    ],
  });

  return { width, rows, barWidth, groupWidth };
}

/**
 * Horizontal bars: one row per label for a single series, one row per series per
 * label otherwise. This is the shape a ranking wants, and `sort` orders it.
 */
export function layoutHorizontalBars(spec, width, labels, series) {
  const normalized = spec.normalized === true;
  const shown = normalized ? toPercent(series, labels.length) : series;
  const stacked = spec.stacked === true || normalized;
  const totals = seriesTotals(shown, labels.length);
  const order = labels.map((_, index) => index);
  if (spec.sort === true && series.length === 1) {
    order.sort((a, b) => series[0].values[b] - series[0].values[a]);
  }

  const max = Math.max(...(stacked ? totals : shown.flatMap((item) => item.values)), 0) || 1;
  const labelWidth = Math.max(
    1,
    Math.min(Math.max(...labels.map((text) => cols(text)), 1), Math.max(4, Math.floor(width * 0.4))),
  );
  const showPercent = spec.percent !== false && !stacked && series.length === 1;
  const percentWidth = showPercent ? 7 : 0;

  // One entry per printed row, so the value column can be measured first.
  const grand = shown.reduce((sum, item) => sum + item.values.reduce((a, b) => a + b, 0), 0);
  const lines = [];
  for (const index of order) {
    if (stacked) {
      lines.push({ index, series: -1, value: series.length === 1 ? series[0].values[index] : totals[index], total: totals[index] });
      continue;
    }
    for (const [seriesIndex, item] of shown.entries()) {
      lines.push({ index, series: seriesIndex, value: item.values[index], total: grand });
    }
  }

  const valueWidth = Math.max(...lines.map((line) => cols(formatNumber(line.value))), 1);
  const prefix = labelWidth + 3;
  const suffix = 1 + valueWidth + (showPercent ? 1 + percentWidth : 0);
  const barWidth = Math.max(3, width - prefix - suffix);

  const rows = [];
  for (const line of lines) {
    const first = stacked || line.series === 0;
    const name = first ? ` ${padTo(truncate(labels[line.index], labelWidth), labelWidth)}  ` : BLANK.repeat(prefix);
    const runs = [];

    if (stacked) {
      // A normalized bar divides its own label's total, so every bar is full.
      const scale = normalized ? totals[line.index] || 1 : max;
      let running = 0;
      const ranges = shown.map((item, index) => {
        const from = running;
        running += item.values[line.index];
        return { series: index, from, to: running };
      });

      for (let column = 0; column < barWidth; column++) {
        const low = (column / barWidth) * scale;
        const high = ((column + 1) / barWidth) * scale;
        const parts = ranges
          .filter((part) => part.to > low && part.from < high && part.to > 0)
          .sort((a, b) => a.from - b.from);
        if (parts.length === 0) continue;
        const bottom = parts[0];
        const top = parts[parts.length - 1];
        const filled = (Math.min(bottom.to, high) - Math.max(bottom.from, low)) / (high - low);
        runs.push({
          text: leftGlyph(filled),
          slice: bottom.series,
          kind: top === bottom ? "fill" : "edge",
          other: top === bottom ? -1 : top.series,
        });
      }
    } else {
      const exact = (line.value / max) * barWidth;
      const whole = Math.max(0, Math.floor(exact));
      const edge = leftGlyph(exact - whole);
      if (whole > 0) runs.push({ text: SOLID.repeat(whole), slice: line.series, kind: "fill" });
      if (edge) runs.push({ text: edge, slice: line.series, kind: "fill" });
      if (spec.track === true) {
        const used = whole + (edge ? 1 : 0);
        if (used < barWidth) runs.push({ text: TRACK.repeat(barWidth - used), slice: -1, kind: "track" });
      }
    }

    const padding = Math.max(0, barWidth - runs.reduce((sum, run) => sum + cols(run.text), 0));
    if (padding > 0) runs.push({ text: BLANK.repeat(padding), slice: -1, kind: "outside" });
    runs.push({
      text: ` ${formatNumber(line.value).padStart(valueWidth)}${
        showPercent ? ` ${formatPercent(line.value, line.total).padStart(percentWidth)}` : ""
      }`,
      slice: line.series >= 0 ? line.series : -1,
      kind: "fill",
    });

    rows.push({ width, runs: [axisRun(name), ...runs] });
  }

  return { width, rows };
}

export function renderBarRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const { labels, series } = normalizeSeries(spec);
  const rows = [];

  if (spec.title) rows.push(titleRow(String(spec.title), width));

  if (labels.length === 0 || series.length === 0) {
    rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  const horizontal = spec.type === "hbar" || spec.horizontal === true;
  const layout = horizontal
    ? layoutHorizontalBars(spec, width, labels, series)
    : layoutVerticalBars(spec, width, labels, series);
  rows.push(...layout.rows);

  if (series.length > 1 && spec.legend !== false) {
    const normalized = spec.normalized === true;
    rows.push(
      ...legendRowRuns(
        series.map((item) => ({
          label: item.name,
          value: item.values.reduce((sum, value) => sum + value, 0),
        })),
        // A 100% chart shows the real total per series, so the reader can see how
        // much the shares are shares of. Everything else lists names only.
        normalized ? { width, percent: false } : { width, values: false },
      ),
    );
  }

  // Plain-text callers still need the textured fills to tell series apart.
  if (spec.textured === true) {
    const glyphs = seriesGlyphs(series.length);
    for (const row of rows) {
      for (const run of row.runs) {
        if (run.kind !== "fill" || !(run.slice >= 0)) continue;
        run.text = [...run.text]
          .map((char) => (char === SOLID ? glyphs[run.slice % glyphs.length] : char))
          .join("");
      }
    }
  }

  return rows;
}
