// Height is a total, not a plot-only number. `plotHeight` is the exception: it
// names the rows the data may use, and the family adds its own chrome around it.
//
// Why a helper: every family used `height` for something different, so the same
// `height: 10` produced 10, 12 or 15 rows. One rule makes the schema true.
//
// The box a chart is drawn into lives here too: the width the TUI measured, and
// the cells of a row that actually fit inside it.

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** The narrowest a chart is drawn: every family's own floor is at most this. */
export const MIN_CHART_WIDTH = 16;

/** The width used when the box reports none: the widest a chart gets by default. */
export const DEFAULT_CHART_WIDTH = 160;

/** A value as a whole number of cells, or null when it is not a number at all. */
function wholeCells(value) {
  const width = Math.floor(Number(value));
  return Number.isFinite(width) ? Math.max(0, width) : null;
}

/**
 * The width to draw at: the fence's own `width` when it set one, otherwise the
 * box, never above `cap`.
 *
 * Why: Yoga reports an unmeasured box as NaN, and `Math.min(NaN, cap)` is NaN, so
 * `Math.max(16, NaN)` was NaN too and every row was drawn at NaN width. A missing
 * width now falls back to the default cap, so the answer is always a whole
 * number of cells, at least the floor.
 *
 * A box narrower than the floor is treated as unmeasured too: a pane that narrow
 * cannot show a chart, and a transient 0 from a re-layout used to redraw the
 * chart tiny and then back.
 *
 * @param {number} available cells the box offers
 * @param {object} [options]
 * @param {number} [options.cap] widest this family may draw
 * @param {number} [options.pinned] the fence's own `width`, which wins over the box
 */
export function measureWidth(available, { cap = DEFAULT_CHART_WIDTH, pinned } = {}) {
  const measured = wholeCells(available);
  const box = measured === null || measured < MIN_CHART_WIDTH ? DEFAULT_CHART_WIDTH : measured;
  const limit = Math.max(MIN_CHART_WIDTH, wholeCells(cap) ?? DEFAULT_CHART_WIDTH);
  const wanted = wholeCells(pinned);
  const target = wanted !== null && wanted > 0 ? wanted : Math.min(box, limit);
  return Math.max(MIN_CHART_WIDTH, Math.min(target, Math.max(MIN_CHART_WIDTH, box)));
}

/**
 * How many cells of a row may be written: the row's own width, clipped to the
 * box. A family may floor its width above the box (a radar starts at 20), and
 * this is what stops such a row writing past the block it measured.
 *
 * A box that reports no width clips nothing, and a row with no width takes the
 * box, so neither answer is ever NaN.
 */
export function clipWidth(rowWidth, boxWidth) {
  const box = wholeCells(boxWidth);
  const row = wholeCells(rowWidth) ?? box ?? DEFAULT_CHART_WIDTH;
  return box === null ? row : Math.min(row, box);
}

/**
 * The number of rows a plot may use.
 *
 * @param {object} spec the fence body
 * @param {object} options
 * @param {number} [options.chrome] rows the family adds around the plot
 * @param {number} [options.fallback] plot rows when neither height nor plotHeight is set
 * @param {number} [options.min] smallest plot the family can draw
 * @param {number} [options.max] largest plot the family will draw
 */
export function plotRows(spec, { chrome = 0, fallback = 10, min = 3, max = 30 } = {}) {
  const explicit = Number(spec?.plotHeight);
  if (Number.isFinite(explicit) && explicit > 0) return clamp(Math.floor(explicit), min, max);
  const total = Number(spec?.height);
  if (Number.isFinite(total) && total > 0) return clamp(Math.floor(total) - Math.max(0, chrome), min, max);
  return clamp(Math.floor(fallback), min, max);
}

/**
 * The row ledger: how many rows the plot gets, and how many the notes get.
 *
 * Families used to do this arithmetic themselves, each with its own `chrome`
 * formula, and the dispatcher subtracted chart-level notes on top — two ledgers
 * counting the same rows. This is the one ledger.
 *
 * A family states its chrome as counts. Notes are data-loss reports, so they are
 * paid for before the plot: a plot row that hides a warning is a bad trade. When
 * even that cannot fit, `truncated` says so instead of letting a family believe
 * it stayed inside the height.
 *
 * @param {object} spec the fence body
 * @param {object} counts
 * @param {number} [counts.title] title rows
 * @param {number} [counts.labels] axis or category label rows
 * @param {number} [counts.legend] legend rows
 * @param {number} [counts.notes] note rows the family will print
 * @param {number} [counts.fallback] plot rows when neither height nor plotHeight is set
 * @param {number} [counts.min] smallest plot the family can draw
 * @param {number} [counts.max] largest plot the family will draw
 * @returns {{plotRows: number, noteRows: number, chrome: number, total: number, truncated: boolean}}
 */
export function layoutFor(spec, { title = 0, labels = 0, legend = 0, notes = 0, fallback = 10, min = 3, max = 30 } = {}) {
  const chrome = Math.max(0, title) + Math.max(0, labels) + Math.max(0, legend);
  const noteRows = Math.max(0, notes);

  const explicit = Number(spec?.plotHeight);
  if (Number.isFinite(explicit) && explicit > 0) {
    const plot = clamp(Math.floor(explicit), min, max);
    return { plotRows: plot, noteRows, chrome, total: chrome + plot + noteRows, truncated: false };
  }

  const height = Number(spec?.height);
  if (!Number.isFinite(height) || height <= 0) {
    const plot = clamp(Math.floor(fallback), min, max);
    return { plotRows: plot, noteRows, chrome, total: chrome + plot + noteRows, truncated: false };
  }

  const limit = Math.floor(height);
  const budget = Math.max(0, limit - chrome);
  const plot = clamp(budget - noteRows, min, max);
  const total = chrome + plot + noteRows;
  return { plotRows: plot, noteRows, chrome, total, truncated: total > limit };
}
