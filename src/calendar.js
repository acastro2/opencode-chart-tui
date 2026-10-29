// Calendar heat map: one column per ISO week, one row per weekday, one half
// block per day, coloured by value. The GitHub contribution graph, in a
// terminal.
//
// Three decisions hold the picture together:
//
// 1. Weeks are ISO weeks (Monday first), and the columns run from the first
//    date's Monday to the last date's Monday. One column per week plus one
//    clear column: without the gap, neighbouring weeks touch and read as one
//    long bar. A range too wide for the chart loses its oldest weeks and says so.
// 2. The colour is the value against the largest value in the fence, not against
//    min..max. A zero day is the ramp's floor colour, which is what makes an
//    empty day read as empty; a fence of 5..10 must not paint 5 as a hole.
// 3. The width is a budget of weeks. When the range is wider than that, the
//    oldest weeks go first and the loss is printed; the newest weeks are the
//    ones a reader came for.
//
// The month row is the one piece of chrome with a rule: a label sits over the
// week that contains the 1st, and is dropped when it would touch the label
// before it. A dropped label is not data loss, so it is not reported.
//
// The day mark is `▀`, the upper half block, not `█`. A column of seven
// same-coloured full blocks reads as one vertical bar, not as seven days. The
// lower half of the cell stays background, so each weekday row is separate and
// the picture reads as a grid of small squares.
//
// A date is read as a civil date in UTC, never through the local timezone: a
// date-only string parses as UTC midnight, and local getters would show the
// previous day anywhere west of Greenwich.

import { blankGrid, cellsToRuns, cols, mixOklab, titleRow, truncate } from "./core.js";
import { layoutFor } from "./layout.js";
import { themeOf } from "./theme.js";
import { coerceList, policyFor } from "./values.js";

const MS_DAY = 86_400_000;
const WEEK = 7 * MS_DAY;
/** Monday first: seven rows, and only three are named. */
const DAYS_IN_WEEK = 7;
const GUTTER_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Three letters and one clear cell before the first week. */
const GUTTER = 4;
/** One cell for the day plus one clear cell, so neighbouring weeks never merge. */
const WEEK_STEP = 2;
const MIN_WIDTH = 16;
const DEFAULT_WIDTH = 48;
/** The month row plus the seven weekday rows. */
const BODY_ROWS = 8;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* -------------------------------------------------------------------------- */
/* Reading: a date string -> one civil day                                    */
/* -------------------------------------------------------------------------- */

/**
 * An ISO `YYYY-MM-DD` date as a UTC day stamp, or null when the text is not a
 * real date. The round trip is the check: `Date.UTC` rolls `2026-02-30` over
 * into March, so a day that comes back different was never a day.
 */
export function parseDay(text) {
  if (typeof text !== "string") return null;
  const match = ISO_DATE.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const dayOfMonth = Number(match[3]);
  const date = new Date(Date.UTC(year, month, dayOfMonth));
  const sameDay =
    date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === dayOfMonth;
  if (!sameDay) return null;
  return {
    stamp: date.getTime(),
    // `getUTCDay` is Sunday = 0; the grid is Monday = 0.
    weekday: (date.getUTCDay() + 6) % 7,
    month,
    dayOfMonth,
  };
}

/** The Monday of a day's ISO week, as a stamp. */
function mondayOf(day) {
  return day.stamp - day.weekday * MS_DAY;
}

/* -------------------------------------------------------------------------- */
/* Planning: the dates, the weeks, and how many of them fit                   */
/* -------------------------------------------------------------------------- */

function chartWidth(spec) {
  const asked = Number(spec?.width);
  return Number.isFinite(asked) ? Math.max(MIN_WIDTH, Math.floor(asked)) : DEFAULT_WIDTH;
}

/** The largest value, floored at zero: a ramp needs a positive peak. */
function peakOf(days) {
  let peak = 0;
  for (const day of days) if (day.value > peak) peak = day.value;
  return peak;
}

/** One day per date, sorted, with the dates that could not be read counted. */
function readDays(rawDates, rawValues) {
  // One value per date, so the two lists stay parallel even when a value is
  // unreadable: `coerceList` keeps a dropped entry as a `null` placeholder.
  const { values } = coerceList(
    rawDates.map((_, index) => rawValues[index]),
    policyFor("calendar"),
  );
  const byStamp = new Map();
  let skipped = 0;
  for (const [index, text] of rawDates.entries()) {
    const day = parseDay(text);
    if (!day) {
      skipped += 1;
      continue;
    }
    if (values[index] === null) continue;
    // The last value for one date wins, so a duplicated day draws once.
    byStamp.set(day.stamp, { ...day, value: values[index] });
  }
  const days = [...byStamp.values()].sort((left, right) => left.stamp - right.stamp);
  return { days, skipped };
}

/** The Monday of the first week and the number of ISO weeks the days span. */
function weekSpan(days) {
  let firstMonday = mondayOf(days[0]);
  let lastMonday = firstMonday;
  for (const day of days) {
    const monday = mondayOf(day);
    if (monday < firstMonday) firstMonday = monday;
    if (monday > lastMonday) lastMonday = monday;
  }
  return { firstMonday, weeks: Math.round((lastMonday - firstMonday) / WEEK) + 1 };
}

/** Each day's absolute column and the slot it takes in the visible window. */
function placeDays(days, firstMonday, hidden) {
  return days.map((day) => {
    const column = Math.round((mondayOf(day) - firstMonday) / WEEK);
    return { ...day, column, slot: column - hidden };
  });
}

/**
 * Days, weeks and the visible window, computed once so the drawing and a caller
 * that only measures agree.
 *
 * A date that cannot be read is counted, not drawn: the note says how many. A
 * value the calendar policy drops leaves its day without a cell, because a
 * dropped value must not be painted as a zero.
 */
export function normalizeCalendar(spec = {}) {
  const width = chartWidth(spec);
  const rawDates = Array.isArray(spec.dates) ? spec.dates : [];
  const rawValues = Array.isArray(spec.values) ? spec.values : [];
  const { days, skipped } = readDays(rawDates, rawValues);
  const capacity = Math.max(1, Math.floor((width - GUTTER + WEEK_STEP - 1) / WEEK_STEP));
  if (days.length === 0) {
    return { width, days, skipped, weeks: 0, capacity, hidden: 0, drawn: 0, firstMonday: 0, peak: 0, startStamp: 0, endStamp: -1 };
  }

  const { firstMonday, weeks } = weekSpan(days);
  const hidden = Math.max(0, weeks - capacity);
  const placed = placeDays(days, firstMonday, hidden);
  const stamps = placed.map((day) => day.stamp);
  return {
    width,
    days: placed,
    skipped,
    weeks,
    capacity,
    hidden,
    drawn: weeks - hidden,
    firstMonday,
    peak: peakOf(placed),
    startStamp: Math.min(...stamps),
    endStamp: Math.max(...stamps),
  };
}

/* -------------------------------------------------------------------------- */
/* The month row: a label over the week that holds the 1st                    */
/* -------------------------------------------------------------------------- */

/** The month whose 1st falls in a week, with its stamp, or null. */
function firstOfMonth(monday) {
  for (let offset = 0; offset < 7; offset++) {
    const stamp = monday + offset * MS_DAY;
    const date = new Date(stamp);
    if (date.getUTCDate() === 1) return { month: date.getUTCMonth(), stamp };
  }
  return null;
}

/**
 * The month labels that fit: one per month whose 1st is in a drawn week, never
 * past the chart edge, and never touching the label before it. A skipped label
 * keeps the row honest instead of printing "JaFeb".
 */
function monthMarks(plan) {
  const marks = [];
  let filled = -1;
  for (let slot = 0; slot < plan.drawn; slot++) {
    const monday = plan.firstMonday + (plan.hidden + slot) * WEEK;
    const first = firstOfMonth(monday);
    if (!first) continue;
    // The last week can end in the next month; that month has not started in the
    // data, so it does not get a label.
    if (first.stamp < plan.startStamp || first.stamp > plan.endStamp) continue;
    const text = MONTHS[first.month];
    if (GUTTER + slot * WEEK_STEP + cols(text) > plan.width) continue;
    if (filled >= 0 && slot <= filled + 1) continue;
    marks.push({ slot, text });
    filled = slot + cols(text) - 1;
  }
  return marks;
}

/* -------------------------------------------------------------------------- */
/* Painting: the plan -> one grid -> runs                                     */
/* -------------------------------------------------------------------------- */

/** Zero is the floor colour exactly; the peak is the top of the ramp. */
function cellColour(value, peak, low, high) {
  if (!(value > 0)) return low;
  if (value >= peak) return high;
  return mixOklab(low, high, value / peak);
}

function cellAt(colour) {
  // The upper half block: the lower half stays background, so seven days in a
  // column never merge into one bar.
  return { slice: -1, char: "▀", kind: "fill", color: colour, mask: 0 };
}

function paintDays(grid, plan, colours, top) {
  const valueAt = new Map(plan.days.map((day) => [day.stamp, day.value]));
  for (let slot = 0; slot < plan.drawn; slot++) {
    const monday = plan.firstMonday + (plan.hidden + slot) * WEEK;
    for (let weekday = 0; weekday < DAYS_IN_WEEK; weekday++) {
      const stamp = monday + weekday * MS_DAY;
      // Days outside the fence's own range stay blank; days inside it that carry
      // no value are zero, so weekends are rows rather than gaps.
      if (stamp < plan.startStamp || stamp > plan.endStamp) continue;
      const value = valueAt.get(stamp) ?? 0;
      const colour = cellColour(value, plan.peak, colours.low, colours.high);
      grid[top + weekday][GUTTER + slot * WEEK_STEP] = cellAt(colour);
    }
  }
}

function paintGutter(grid, top) {
  for (const [weekday, label] of GUTTER_LABELS.entries()) {
    const row = grid[top + weekday];
    for (const [offset, char] of [...label].entries()) {
      row[offset] = { slice: -1, char, kind: "axis", mask: 0 };
    }
  }
}

function paintMonths(grid, marks) {
  for (const mark of marks) {
    for (const [offset, char] of [...mark.text].entries()) {
      grid[0][GUTTER + mark.slot * WEEK_STEP + offset] = { slice: -1, char, kind: "axis", mask: 0 };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Notes and rows                                                             */
/* -------------------------------------------------------------------------- */

function noteRow(text, width) {
  // Two spaces read as a footer; a narrow chart spends them on the count
  // instead of cutting the last word off the sentence.
  const indented = `  ${text}`;
  const line = cols(indented) <= width ? indented : text;
  return { width, runs: [{ text: truncate(line, width), slice: -1, kind: "legend" }] };
}

/** The title row, when the fence asked for one. */
function titleRows(spec, width) {
  return spec.title ? [titleRow(String(spec.title), width)] : [];
}

function calendarNotes(plan) {
  const notes = [];
  if (plan.skipped > 0) notes.push(`${plan.skipped} ${plan.skipped === 1 ? "date" : "dates"} skipped`);
  if (plan.hidden > 0) notes.push(`${plan.hidden} ${plan.hidden === 1 ? "week" : "weeks"} hidden`);
  return notes;
}

function bodyRow(cells, width) {
  return { width, runs: cellsToRuns(cells) };
}

/** Nothing to draw: the title, the sentence, then the notes on what was lost. */
function emptyRows(spec, width, notes) {
  return [...titleRows(spec, width), noteRow("no data", width), ...notes.map((note) => noteRow(note, width))];
}

/** The height the block may spend, or Infinity when the fence declared none. */
function rowBudget(spec) {
  const limit = Number(spec.height);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
}

/**
 * The month row is the only row that can go: the seven weekdays are the data
 * and a note is a loss the reader must see, so a tight height spends the month
 * labels rather than a week. No labels to place, no ledger room, or a height
 * that cannot pay for the title, the body and the notes all drop the row.
 */
function monthsShown(spec, notes, marks, plotRows) {
  if (marks.length === 0) return false;
  if (plotRows < BODY_ROWS) return false;
  return (spec.title ? 1 : 0) + BODY_ROWS + notes.length <= rowBudget(spec);
}

/** The title, the calendar, then what the calendar could not show. */
export function renderCalendarRows(spec = {}) {
  const plan = normalizeCalendar(spec);
  const width = plan.width;
  const notes = calendarNotes(plan);
  if (plan.days.length === 0) return emptyRows(spec, width, notes);

  // The ledger owns the height. Its floor of nine rows is the month row, the
  // seven weekdays and one spare for day labels; the calendar itself never
  // needs more than eight, so a taller fence adds nothing to draw.
  const ledger = layoutFor(spec, {
    title: spec.title ? 1 : 0,
    labels: 9,
    notes: notes.length,
    fallback: 9,
    min: 9,
    max: 12,
  });

  const marks = monthMarks(plan);
  const top = monthsShown(spec, notes, marks, ledger.plotRows) ? 1 : 0;
  const grid = blankGrid(width, top + DAYS_IN_WEEK);
  const colours = themeOf(spec).heat;

  if (top > 0) paintMonths(grid, marks);
  paintGutter(grid, top);
  paintDays(grid, plan, colours, top);

  return [
    ...titleRows(spec, width),
    ...grid.map((cells) => bodyRow(cells, width)),
    ...notes.map((note) => noteRow(note, width)),
  ];
}
