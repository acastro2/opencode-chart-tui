// A histogram: a flat list of numbers binned into equal widths.
//
// The binning is the whole contribution. The drawing is the bar chart, so a
// histogram looks like the rest of the library and inherits its axis, its
// sub-cell sampling, its colours and its scaling.
//
//   { "type": "histogram", "values": [1.2, 3.4, 3.9, ...], "bins": 8 }

import { formatNumber, titleRow } from "./core.js";
import { renderBarRows } from "./bar.js";

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

export function renderHistogramRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const values = Array.isArray(spec.values) ? spec.values : Array.isArray(spec.data) ? spec.data : [];
  const rows = [];

  if (spec.title) rows.push(titleRow(String(spec.title), width));

  const { bins, width: binWidth, samples } = bin(values, spec.bins);
  if (bins.length === 0) {
    rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  // A fresh spec: normalizeSeries prefers series over values, so nothing that
  // arrived as series can leak into the bar chart.
  rows.push(
    ...renderBarRows({
      type: "bar",
      width,
      height: spec.height ?? 8,
      labels: bins.map((item) => formatNumber(item.from)),
      values: bins.map((item) => item.count),
      ticks: spec.ticks,
      mosaic: spec.mosaic,
      textured: spec.textured,
      gap: spec.gap,
      percent: false,
      legend: false,
      valueLabels: spec.valueLabels === true,
      // Bin edges are longer than one bar slot, so they are thinned rather than cut.
      slotLabels: false,
    }),
  );

  if (spec.note !== false) {
    rows.push({
      width,
      runs: [
        {
          text: `${samples} values, ${bins.length} bins of ${formatNumber(binWidth)}`,
          slice: -1,
          kind: "legend",
        },
      ],
    });
  }

  return rows;
}
