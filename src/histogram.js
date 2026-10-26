// A histogram: a flat list of numbers binned into equal widths.
//
// The binning is the whole contribution. The drawing is the bar chart, so a
// histogram looks like the rest of the library and inherits its axis, its
// sub-cell sampling, its colours and its scaling.
//
//   { "type": "histogram", "values": [1.2, 3.4, 3.9, ...], "bins": 8 }

import { formatNumber, titleRow, wrapText } from "./core.js";
import { measureVerticalBars, renderBarRows } from "./bar.js";
import { coerce, coerceList, policyFor } from "./values.js";

/** The shared fate of a sample: a blank reads as 0, an unreadable one is dropped. */
const HISTOGRAM_POLICY = policyFor("histogram");

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
  const numbers = [];
  for (const raw of values ?? []) {
    const { value } = coerce(raw, HISTOGRAM_POLICY);
    if (value !== null) numbers.push(value);
  }
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

/** The samples under the shared policy, `values` or `data`, in order. */
function valuesOf(spec) {
  const raw = Array.isArray(spec.values) ? spec.values : Array.isArray(spec.data) ? spec.data : [];
  return coerceList(raw, HISTOGRAM_POLICY, { compact: true }).values;
}

function footerLinesFor(spec, note, width) {
  if (spec.note === false) return [];
  return wrapText(note, Math.max(8, width - 2)).slice(0, 2);
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

  // The bar layout owns the plot budget, the label row and the hidden-category
  // note, so ask it once for all three instead of building a bar spec to
  // measure. The histogram pays for the rows it prints around the plot (its
  // footers); the ledger pays for its title, the bar's label row and its own
  // notes before the plot, so the block adds up to `height`.
  const counts = bins.map((item) => item.count);
  const ranges = binLabels(bins);
  const layout = measureVerticalBars(spec, ranges, counts, { notes: footer.length });

  // A range is the label a reader wants ("0–82.5", not "0"), but it is about
  // twice as wide as the left edge it replaces. Show the ranges only when the
  // whole row fits; when two of them would collide, keep the short edges so the
  // axis still reads.
  const placed = layout.labelRow.split(/\s+/).filter(Boolean);
  const labels = placed.length === ranges.length ? ranges : bins.map((item) => formatNumber(item.from));

  rows.push(...renderBarRows({ ...layout.spec, labels, values: counts }));
  pushFooter(rows, width, footer);
  return rows;
}
