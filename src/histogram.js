// A histogram: a flat list of numbers binned into equal widths.
//
// The binning is the whole contribution. The drawing is the bar chart, so a
// histogram looks like the rest of the library and inherits its axis, its
// sub-cell sampling, its colours and its scaling.
//
//   { "type": "histogram", "values": [1.2, 3.4, 3.9, ...], "bins": 8 }

import { formatNumber, titleRow, wrapText } from "./core.js";
import { hiddenCategoryCount, renderBarRows, verticalLabelRow } from "./bar.js";
import { plotRows as plotRowsFor } from "./layout.js";

/** Automatic bin count: the square-root rule, capped so the bars stay readable. */
export function binCount(samples, requested) {
  if (Number.isFinite(requested) && requested > 0) return Math.max(1, Math.min(60, Math.floor(requested)));
  return Math.max(1, Math.min(30, Math.ceil(Math.sqrt(Math.max(1, samples)))));
}

/**
 * Equal-width bins over the sample range. The last bin is closed at the top, so
 * the largest value lands somewhere rather than nowhere. A single repeated value
 * gets a bin of width one instead of a division by zero.
 *
 * @returns {{bins: {from: number, to: number, count: number}[], width: number, min: number, max: number, samples: number}}
 */
export function bin(values, requested) {
  const numbers = [...(values ?? [])].map(Number).filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return { bins: [], width: 0, min: 0, max: 0, samples: 0 };

  let min = Math.min(...numbers);
  let max = Math.max(...numbers);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }

  const count = binCount(numbers.length, requested);
  const width = (max - min) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    from: min + index * width,
    to: min + (index + 1) * width,
    count: 0,
  }));

  for (const value of numbers) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - min) / width)));
    bins[index].count += 1;
  }

  return { bins, width, min, max, samples: numbers.length };
}

/** Each bin as a range, for a caller that wants to show the edges. */
export function binLabels(bins) {
  return bins.map((item) => `${formatNumber(item.from)}–${formatNumber(item.to)}`);
}

function widthOf(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

function valuesOf(spec) {
  if (Array.isArray(spec.values)) return spec.values;
  return Array.isArray(spec.data) ? spec.data : [];
}

function footerLinesFor(spec, note, width) {
  if (spec.note === false) return [];
  return wrapText(note, Math.max(8, width - 2)).slice(0, 2);
}

/** The bar spec the bins are drawn with: no legend, no percent, thinned labels. */
function barSpecFor(spec, width, footerLines) {
  return {
    type: "bar",
    width,
    plotHeight: plotRowsFor(spec, {
      chrome: (spec.title ? 1 : 0) + 1 + footerLines.length,
      fallback: 8,
    }),
    ticks: spec.ticks,
    mosaic: spec.mosaic,
    textured: spec.textured,
    gap: spec.gap,
    showPercent: false,
    legend: false,
    valueLabels: spec.valueLabels === true,
    // Bin edges are longer than one bar slot, so they are thinned rather than cut.
    slotLabels: false,
  };
}

/**
 * A range is the label a reader wants ("0–82.5", not "0"), but it is about twice
 * as wide as the left edge it replaces. Show the ranges only when the whole row
 * fits; when two of them would collide, keep the short edges so the axis still
 * reads. The bar layout owns that row, so it answers with the real geometry
 * instead of an estimate.
 */
function labelsFor(bins, barSpec, width, counts) {
  const rangeLabels = binLabels(bins);
  const series = [{ name: "count", values: counts }];
  const placed = verticalLabelRow(barSpec, width, rangeLabels, series).split(/\s+/).filter(Boolean);
  return placed.length === rangeLabels.length ? rangeLabels : bins.map((item) => formatNumber(item.from));
}

function pushFooter(rows, width, lines) {
  for (const line of lines) {
    rows.push({ width, runs: [{ text: `  ${line}`, slice: -1, kind: "legend" }] });
  }
}

export function renderHistogramRows(spec) {
  const width = widthOf(spec);
  const rows = [];

  if (spec.title) rows.push(titleRow(String(spec.title), width));

  const { bins, width: binWidth, samples } = bin(valuesOf(spec), spec.bins);
  if (bins.length === 0) {
    rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  const note = `${samples} values, ${bins.length} bins of ${formatNumber(binWidth)}`;
  const footer = footerLinesFor(spec, note, width);

  // A fresh spec: normalizeSeries prefers series over values, so nothing that
  // arrived as series can leak into the bar chart. The bar keeps the plot area;
  // the histogram owns the title row and the footer, so it subtracts both before
  // it hands the plot height over.
  const counts = bins.map((item) => item.count);
  const barSpec = barSpecFor(spec, width, footer);
  const labels = labelsFor(bins, barSpec, width, counts);

  // Too many bins for the width costs the bar one row for its hidden-category
  // note. The bar layout owns that rule, so ask it for the count and take the row
  // out of the plot here: the block then stays inside `height` and the note is
  // the row the reader sees, not the generic height guard's replacement. With no
  // `height` there is no ceiling to protect, so the plot is left alone.
  const hidden = hiddenCategoryCount(barSpec, width, labels, [{ name: "count", values: counts }]);
  // `plotHeight` is an explicit plot size, so it wins over a budget adjustment.
  const budgeted = hidden > 0 && Number(spec.height) > 0 && spec.plotHeight == null;
  const plotHeight = budgeted ? Math.max(3, barSpec.plotHeight - 1) : barSpec.plotHeight;

  rows.push(...renderBarRows({ ...barSpec, plotHeight, labels, values: counts }));
  pushFooter(rows, width, footer);
  return rows;
}
