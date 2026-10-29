// One rule for a fence value: what it becomes, and what the footer may say.
//
// Why: before this module the same value was judged up to three times — by the
// family's normalizer, by the dispatcher's tally, and sometimes by a family note
// — and the judges disagreed. A `null` was drawn as 0 by a bar, kept as a hole by
// a heat map and dropped by a candle, while the footer called all three "treated
// as 0". Two lookup tables in `chart.js` existed only to paper over that.
//
// A family declares a *fate* for each kind of unreadable value, and both the
// drawing and the sentence come from the same declaration:
//
//   zero  draw it as 0 and say so
//   hole  keep the slot empty and keep alignment
//   drop  remove the point and report the loss
//
// A blank (`null`, `undefined`, `""`) and an unreadable value (`"x"`, `NaN`) are
// separate decisions, because `Number(null)` is 0 while `Number("x")` is NaN.

export const ZERO = "zero";
export const HOLE = "hole";
export const DROP = "drop";

/**
 * Per family: the fate of a blank and of an unreadable value. `selfReports`
 * means the family prints its own loss note, so the dispatcher must stay quiet.
 */
export const VALUE_POLICY = {
  bar: { null: ZERO, invalid: ZERO },
  column: { null: ZERO, invalid: ZERO },
  hbar: { null: ZERO, invalid: ZERO },
  line: { null: ZERO, invalid: ZERO },
  area: { null: ZERO, invalid: ZERO },
  sparkline: { null: ZERO, invalid: ZERO },
  radar: { null: ZERO, invalid: ZERO },
  gauge: { null: ZERO, invalid: ZERO },
  progress: { null: ZERO, invalid: ZERO },
  scatter: { null: ZERO, invalid: ZERO },
  histogram: { null: ZERO, invalid: DROP },
  waterfall: { null: ZERO, invalid: DROP },
  pie: { null: DROP, invalid: DROP },
  donut: { null: DROP, invalid: DROP },
  treemap: { null: DROP, invalid: DROP, selfReports: true },
  sankey: { null: DROP, invalid: DROP },
  candle: { null: DROP, invalid: DROP, selfReports: true },
  candlestick: { null: DROP, invalid: DROP, selfReports: true },
  ohlc: { null: DROP, invalid: DROP, selfReports: true },
  heatmap: { null: HOLE, invalid: HOLE, selfReports: true },
  // New families (0.3): a sample, a stage and a pair are all dropped when they
  // cannot be read; a count and a magnitude read as zero.
  box: { null: DROP, invalid: DROP },
  funnel: { null: DROP, invalid: DROP },
  calendar: { null: ZERO, invalid: DROP },
  bullet: { null: ZERO, invalid: ZERO },
  slope: { null: ZERO, invalid: ZERO },
  dot: { null: ZERO, invalid: ZERO },
  combo: { null: ZERO, invalid: ZERO },
};

/** Scatter points are a different list from series values: both ends are strict. */
export const POINTS_POLICY = { null: DROP, invalid: DROP };

/** The policy for a family; an unknown type is strict, because silence is worse. */
export function policyFor(family) {
  return VALUE_POLICY[family] ?? { null: DROP, invalid: DROP };
}

/** Nothing to read: no value at all, not a zero. */
export function isBlank(value) {
  return value === null || value === undefined || value === "";
}

function outcome(fate) {
  if (fate === ZERO) return { value: 0, fate: ZERO };
  if (fate === HOLE) return { value: null, fate: HOLE };
  return { value: null, fate: DROP };
}

/**
 * One value under a policy.
 * @returns {{value: number|null, fate: "ok"|"zero"|"hole"|"drop"}}
 */
export function coerce(raw, policy) {
  if (!isBlank(raw)) {
    const number = Number(raw);
    if (Number.isFinite(number)) return { value: number, fate: "ok" };
    return outcome(policy.invalid);
  }
  return outcome(policy.null);
}

/**
 * A list of values under one policy, with a tally the footer can print.
 *
 * `compact` removes dropped entries instead of keeping a `null` placeholder.
 * Use it where the array position is not an axis (pie slices, sankey links);
 * leave it off where index alignment matters (a heat map column).
 */
export function coerceList(list, policy, { compact = false } = {}) {
  const values = [];
  const tally = { zeroed: 0, holes: 0, dropped: 0 };
  for (const raw of list ?? []) {
    const { value, fate } = coerce(raw, policy);
    if (fate === ZERO) tally.zeroed += 1;
    else if (fate === HOLE) tally.holes += 1;
    else if (fate === DROP) {
      tally.dropped += 1;
      if (compact) continue;
    }
    values.push(value);
  }
  return { values, ...tally };
}

/** True when the tally has nothing to report. */
export function tallyIsQuiet(tally) {
  return tally.zeroed === 0 && tally.holes === 0 && tally.dropped === 0;
}
