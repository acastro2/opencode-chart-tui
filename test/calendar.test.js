import assert from "node:assert/strict";

import { cols, mixOklab, runsText } from "../src/core.js";
import { normalizeCalendar, parseDay, renderCalendarRows } from "../src/calendar.js";
import { THEMES } from "../src/theme.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellRuns = (rows) => rows.flatMap((row) => row.runs).filter((run) => run.kind === "fill");
const assertFits = (rows, width) => {
  for (const row of rows) assert.ok(cols(runsText(row.runs)) <= width, `${width}: "${runsText(row.runs)}"`);
};

/** Every ISO day from one date to another, so a test can fill a year. */
function eachDay(from, to) {
  const days = [];
  for (let stamp = Date.parse(from); stamp <= Date.parse(to); stamp += 86_400_000) {
    days.push(new Date(stamp).toISOString().slice(0, 10));
  }
  return days;
}

check("2026-01-01 lands on the Thursday row", () => {
  const spec = { width: 40, dates: ["2026-01-01"], values: [1] };
  const plan = normalizeCalendar(spec);
  assert.equal(plan.days[0].weekday, 3, "Monday is 0, so Thursday is 3");

  const rows = renderCalendarRows(spec);
  const text = textRows(rows);
  assert.deepEqual(rows[0].runs.map((run) => run.kind), ["outside", "axis"], "the month label is axis furniture");
  assert.equal(text[0].trim(), "Jan", "the month row is above the weekdays");
  assert.equal(text[1].trim(), "Mon", "row 1 is Monday");
  assert.equal(text[3].trim(), "Wed", "row 3 is Wednesday");
  assert.equal(text[4], "    ▀", "the half block is on row 4: Thursday, under the month row");
  assert.equal(text[5].trim(), "Fri", "row 5 is Friday");
});

check("dates a week apart land in adjacent columns", () => {
  const spec = { width: 40, dates: ["2026-01-05", "2026-01-12"], values: [1, 2] };
  const plan = normalizeCalendar(spec);
  assert.deepEqual(plan.days.map((day) => day.column), [0, 1]);
  assert.deepEqual(plan.days.map((day) => day.weekday), [0, 0], "both are Mondays");
  assert.equal(plan.weeks, 2, "two ISO weeks, so two columns");

  const monday = textRows(renderCalendarRows(spec)).find((row) => row.startsWith("Mon"));
  assert.equal(monday, "Mon ▀ ▀", "one clear cell between weeks, so days never merge");
  assert.equal(cols(monday), 7, "three letters, one space, two week columns with a gap");
});

check("the ramp runs from the low colour at zero to the high colour at the peak", () => {
  const dates = ["2026-01-05", "2026-01-12", "2026-01-19"];
  const rows = renderCalendarRows({ width: 40, dates, values: [0, 5, 10] });
  const colours = cellRuns(rows).map((run) => run.color);
  const { low, high } = THEMES.dark.heat;
  assert.equal(colours[0], low, "a zero day is exactly the ramp's floor");
  assert.equal(colours[1], mixOklab(low, high, 0.5), "half the peak is half the ramp");
  assert.equal(colours[2], mixOklab(low, high, 1), "the peak is the top of the ramp");
  assert.notEqual(colours[0], colours[1], "a bigger value is a different colour");
  assert.notEqual(colours[1], colours[2], "and a bigger one still is warmer");

  const light = cellRuns(renderCalendarRows({ width: 40, dates, values: [0, 5, 10], theme: "light" })).map(
    (run) => run.color,
  );
  assert.equal(light[0], THEMES.light.heat.low, "the light theme has its own floor");
  assert.notEqual(light[0], colours[0], "and it is not the dark floor");
});

check("a bad date is skipped and counted", () => {
  const spec = {
    width: 40,
    dates: ["2026-01-01", "not-a-date", "2026-02-30"],
    values: [1, 2, 3],
  };
  const plan = normalizeCalendar(spec);
  assert.equal(plan.skipped, 2, "an unreadable string and a day that does not exist");
  assert.equal(plan.days.length, 1, "the real date is still drawn");
  assert.equal(parseDay("2026-02-30"), null, "February has no 30th");
  assert.equal(parseDay("2026-02-29"), null, "2026 is not a leap year");

  const rows = renderCalendarRows(spec);
  assert.ok(textRows(rows).some((row) => row.trim() === "2 dates skipped"), textRows(rows).join(" | "));
  assertFits(rows, 40);
});

check("no dates prints no data", () => {
  const rows = renderCalendarRows({ width: 40, dates: [], values: [] });
  assert.deepEqual(textRows(rows), ["  no data"]);
  assert.equal(rows[0].runs[0].kind, "legend");
  assert.equal(renderCalendarRows({ width: 40 }).length, 1, "a missing dates key is the same empty chart");

  const titled = renderCalendarRows({ width: 40, title: "Commits", dates: [], values: [] });
  assert.equal(titled.length, 2, "the title stays above the no-data line");
  assert.equal(titled[0].runs[0].kind, "title");
});

check("a range wider than the chart keeps the newest weeks and says so", () => {
  const spec = { width: 24, dates: ["2025-01-01", "2025-12-31"], values: [1, 2] };
  const plan = normalizeCalendar(spec);
  assert.equal(plan.capacity, 10, "ten week columns after the four-cell gutter, one gap each");
  assert.equal(plan.weeks, 53, "2025 spans 53 ISO weeks");
  assert.equal(plan.hidden, 43, "the oldest 43 go first");
  assert.equal(plan.drawn, 10);
  assert.equal(plan.days.at(-1).slot, 9, "the last date keeps the last column");
  assert.ok(plan.days[0].slot < 0, "the first date is hidden");

  const rows = renderCalendarRows(spec);
  assert.ok(textRows(rows).some((row) => row.trim() === "43 weeks hidden"), textRows(rows).join(" | "));
  assertFits(rows, 24);
  const last = textRows(rows).find((row) => row.includes("▀"));
  assert.equal(last.trimEnd().at(-1), "▀", "the newest week is drawn at the right edge");
});

check("the gutter names Monday, Wednesday and Friday", () => {
  const rows = renderCalendarRows({ width: 40, dates: ["2026-01-01", "2026-01-05"], values: [1, 2] });
  const text = textRows(rows);
  assert.equal(text[1], "Mon   ▀", "Monday's label and its day, in the second week");
  assert.equal(text[2], "", "Tuesday has no label and no day in range");
  assert.equal(text[3], "Wed", "Wednesday is labelled");
  assert.equal(text[4], "    ▀", "Thursday keeps the gutter blank and carries its day");
  assert.equal(text[5], "Fri ▀");
  assert.equal(text[6], "    ▀", "Saturday and Sunday are rows, not gaps");
  assert.equal(text[7], "    ▀");
});

check("every painted day is a half block, so a week column never reads as a bar", () => {
  const dates = eachDay("2026-01-01", "2026-12-31");
  const values = dates.map((_, index) => index % 5);
  const rows = renderCalendarRows({ width: 60, dates, values });
  const painted = cellRuns(rows).flatMap((run) => [...run.text]);
  assert.ok(painted.length > 0, "the year paints days");
  assert.ok(
    painted.every((char) => char === "▀"),
    `every painted cell is an upper half block: ${[...new Set(painted)].join("")}`,
  );
  assert.ok(!textRows(rows).some((row) => row.includes("█")), "no full block anywhere, so no column is a bar");
  const paintedRows = textRows(rows).filter((row) => row.includes("▀")).length;
  assert.equal(paintedRows, 7, "all seven weekday rows carry days, so the grid reads as a grid");
});

check("month labels sit over the week of the 1st and never collide", () => {
  const dates = eachDay("2026-01-01", "2026-12-31");
  const rows = renderCalendarRows({ width: 120, dates, values: dates.map((_, index) => index % 5) });
  const monthRow = textRows(rows)[0];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const positions = months.map((month) => monthRow.indexOf(month));
  assert.ok(positions.every((position) => position >= 0), `all twelve months are named: "${monthRow}"`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "in calendar order");
  assert.equal(positions[0], 4, "Jan sits over the first week, after the gutter");
  for (let index = 1; index < positions.length; index++) {
    assert.ok(positions[index] >= positions[index - 1] + 4, `${months[index]} does not touch ${months[index - 1]}`);
  }
  assertFits(rows, 120);
});

check("a year is one column per week and the grid stays inside every width", () => {
  const dates = eachDay("2026-01-01", "2026-12-31");
  const values = dates.map((_, index) => index % 11);
  const plan = normalizeCalendar({ width: 120, dates, values });
  assert.equal(plan.weeks, 53, "2026 starts on a Thursday and ends on a Thursday, 53 ISO weeks");
  assert.equal(plan.days.at(-1).slot, 52, "the last date is the last column");
  assert.equal(new Date(plan.firstMonday).getUTCDay(), 1, "the first column starts on a Monday");

  for (let width = 16; width <= 80; width += 4) {
    const rows = renderCalendarRows({ width, dates, values });
    assertFits(rows, width);
    const fitted = normalizeCalendar({ width, dates, values });
    assert.equal(fitted.drawn, Math.min(fitted.weeks, fitted.capacity), "as many weeks as fit, never more");
    for (const row of textRows(rows)) {
      const blocks = [...row].filter((char) => char === "▀").length;
      assert.ok(blocks <= fitted.capacity, `${width}: ${blocks} days in a week row of at most ${fitted.capacity}`);
    }
  }
});

check("height keeps the whole block inside the budget", () => {
  const dates = eachDay("2026-01-01", "2026-12-31");
  const values = dates.map((_, index) => index % 4);
  const rows = renderCalendarRows({ width: 20, height: 9, title: "Commits", dates, values });
  assert.ok(rows.length <= 9, `${rows.length} rows in a budget of nine`);
  assert.equal(rows[0].runs[0].kind, "title");
  assert.ok(textRows(rows).some((row) => row.includes("weeks hidden")), "the loss note survives the squeeze");
  assert.ok(textRows(rows).some((row) => row.startsWith("Mon")), "the weekday rows are still there");
  assert.ok(textRows(rows)[1].startsWith("Mon"), "the month row is the row that goes");

  const roomy = renderCalendarRows({ width: 120, height: 12, dates, values });
  assert.ok(roomy.length <= 12);
  assert.ok(textRows(roomy)[0].includes("Jan"), "a taller fence keeps the month labels");
});

check("a blank value is a zero, an unreadable one drops its day", () => {
  const plan = normalizeCalendar({ width: 40, dates: ["2026-01-05", "2026-01-06"], values: [null, "x"] });
  assert.equal(plan.days.length, 1, "the unreadable value leaves no cell to paint");
  assert.equal(plan.days[0].value, 0, "the blank reads as zero");

  const missing = normalizeCalendar({ width: 40, dates: ["2026-01-05"] });
  assert.equal(missing.days[0].value, 0, "a missing value list is all blanks, so zero");

  const rows = renderCalendarRows({ width: 40, dates: ["2026-01-05"], values: [null] });
  const cell = cellRuns(rows)[0];
  assert.equal(cell.text, "▀", "a zero day is still a half block");
  assert.equal(cell.color, THEMES.dark.heat.low, "painted at the floor of the ramp");
});

check("the month row is the row a tight height spends", () => {
  const spec = { width: 40, dates: ["2026-01-01"], values: [1] };
  const roomy = textRows(renderCalendarRows(spec));
  assert.equal(roomy[0].trim(), "Jan", "a month label is drawn when the whole block fits");

  // A height of zero, or less, declares no height: it leaves no budget to keep,
  // so the optional month row keeps its place.
  for (const height of [0, -2]) {
    assert.deepEqual(textRows(renderCalendarRows({ ...spec, height })), roomy, `height ${height} draws the whole block`);
  }

  // A height that cannot pay for the title, the eight body rows and the notes
  // drops the month row rather than a weekday.
  const tight = textRows(renderCalendarRows({ ...spec, height: 8, title: "T" }));
  assert.equal(tight[0], "T", "the title keeps its row");
  assert.ok(tight[1].startsWith("Mon"), "and the month row goes");

  // A range whose weeks hold no 1st has no label to place.
  const midMonth = textRows(renderCalendarRows({ width: 40, dates: ["2026-01-15"], values: [1] }));
  assert.ok(midMonth[0].startsWith("Mon"), "no month starts in the range, so no month row");
  assert.equal(normalizeCalendar({ dates: ["2026-01-15"] }).width, 48, "an unset width is 48 cells");
});

check("the same fence draws the same picture", () => {
  const dates = eachDay("2026-01-01", "2026-06-30");
  const spec = { width: 60, title: "Commits", dates, values: dates.map((_, index) => index % 7) };
  assert.deepEqual(renderCalendarRows(spec), renderCalendarRows(spec));
  assert.deepEqual(
    renderCalendarRows({ ...spec, width: 80 }),
    renderCalendarRows({ ...spec, width: 80 }),
  );
});

console.log(`\n${checks}/${checks} checks passed`);
