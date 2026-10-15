// Gantt: the timeline families, its scale, its bars and its markers.
//
// The checks read the plain-text render, so they prove what a reader sees: which
// columns a bar covers, where the scale's ticks are, and that the today marker
// never paints over a bar.

import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { dayLabel, normalizeTasks, parseWhen, renderGanttRows, tickStep } from "../src/gantt.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];
const drawn = (row) => cellsOf(row).filter((cell) => cell !== " ");

const dated = {
  type: "gantt",
  title: "Rollout plan",
  width: 96,
  today: "2026-11-14",
  tasks: [
    { label: "Design", group: "Discovery", start: "2026-11-02", end: "2026-11-13" },
    { label: "Stakeholder sign-off", group: "Discovery", start: "2026-11-13", end: "2026-11-16" },
    { label: "Build", group: "Delivery", start: "2026-11-16", end: "2026-12-11" },
    { label: "Test", group: "Delivery", start: "2026-12-07", end: "2026-12-18" },
    { label: "Launch", group: "Delivery", at: "2026-12-21", milestone: true },
    { label: "Hypercare", group: "Delivery", start: "2026-12-21", end: "2027-01-15" },
  ],
};

const numeric = {
  type: "gantt",
  width: 60,
  tasks: [
    { label: "Plan", start: 0, end: 1.5 },
    { label: "Build", start: 1, end: 7 },
    { label: "Demo", at: 10, milestone: true },
  ],
};

check("an ISO date becomes a day offset from the first date", () => {
  const { tasks, dated: isDated, base } = normalizeTasks(dated);
  assert.equal(isDated, true);
  assert.ok(base > 0, "the base date is set");
  assert.equal(tasks[0].from, 0, "the first task starts at day zero");
  assert.equal(tasks[0].to, 11);
  assert.equal(dayLabel(base, 11), "Nov 13");
});

check("plain numbers are used as they are", () => {
  const { tasks, dated: isDated, base } = normalizeTasks(numeric);
  assert.equal(isDated, false);
  assert.equal(base, null);
  assert.deepEqual(tasks.map((task) => [task.from, task.to]), [[0, 1.5], [1, 7], [10, 10]]);
});

check("a value that is not a time drops its task", () => {
  assert.equal(parseWhen("not a date"), null);
  assert.equal(parseWhen(""), null);
  assert.equal(parseWhen(null), null);
  const { tasks } = normalizeTasks({ tasks: [{ label: "bad", start: "nope", end: "nope" }, { label: "ok", start: 1, end: 2 }] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].label, "ok");
});

check("a task that names only one moment is a milestone", () => {
  const { tasks } = normalizeTasks({ tasks: [{ label: "Ship", at: 5 }, { label: "Build", start: 1, end: 4 }] });
  assert.equal(tasks[0].milestone, true);
  assert.equal(tasks[0].from, 5);
  assert.equal(tasks[1].milestone, false);
});

check("the scale step keeps its labels apart", () => {
  assert.equal(tickStep(100, 74), 20);
  const rows = textRows(renderGanttRows(dated));
  const scale = rows[1];
  const dates = scale.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}/g) ?? [];
  assert.ok(dates.length >= 3, `the scale carries several dates (${dates.length})`);
  // Two labels never run together: a label's day number is never followed by a
  // letter, which is what would happen if one bled into the next tick.
  assert.ok(!/[0-9][A-Za-z]/.test(scale), `no two labels run together: ${scale}`);
});

check("bars start after the label column", () => {
  const rows = textRows(renderGanttRows(dated));
  const first = rows.findIndex((row) => row.includes("█"));
  const bar = rows[first];
  const labelWidth = bar.indexOf("│");
  assert.ok(labelWidth >= 8, `the label column is drawn (${labelWidth})`);
  // Nothing before the separator may be canvas ink.
  assert.ok(!/[█▌▐◆┊]/.test(bar.slice(0, labelWidth)), "no bar inside the label column");
  for (const row of rows) {
    const edge = row.indexOf("│");
    if (edge < 0) continue;
    assert.ok(!/[█▌▐]/.test(row.slice(0, edge)), `no bar before the separator: ${row}`);
  }
});

check("a bar covers the columns of its own span", () => {
  const rows = textRows(renderGanttRows(dated));
  // Task rows are right-aligned in the label column, so a row does not *start*
  // with the label; it contains it.
  const rowOf = (label) => cellsOf(rows.find((row) => row.includes(label)) ?? "");
  const design = rowOf("Design");
  const build = rowOf("Build");
  const startOf = (row) => row.findIndex((cell) => "█▌▐".includes(cell));
  const endOf = (row) => row.length - 1 - [...row].reverse().findIndex((cell) => "█▌▐".includes(cell));
  assert.ok(startOf(build) > startOf(design), "Build starts after Design");
  assert.ok(endOf(build) - startOf(build) > endOf(design) - startOf(design), "and its bar is longer");
  assert.ok(startOf(design) > 0, "the bar starts inside the plot area");
});

check("a milestone draws a diamond and no bar", () => {
  const rows = textRows(renderGanttRows(dated));
  const launch = rows.find((row) => row.includes("Launch"));
  assert.ok(launch.includes("◆"), "the milestone is drawn");
  assert.ok(!/[█▌▐]/.test(launch), "and it has no bar");
});

check("a group heads its own rows and the legend names it", () => {
  const rows = textRows(renderGanttRows(dated));
  // The today marker can sit after the group name, so the row is not simply
  // "the row that ends with Discovery": it is the only row that names it.
  const discovery = rows.findIndex((row) => row.includes("Discovery"));
  const design = rows.findIndex((row) => row.includes("Design"));
  assert.ok(discovery >= 0 && design === discovery + 1, "the group header sits above its tasks");
  assert.ok(rows.some((row) => row === "● Discovery"));
  assert.ok(rows.some((row) => row === "● Delivery"));
});

check("the today marker never paints over a bar", () => {
  // Today sits inside Build's bar and outside Docs', so one row must show the
  // bar and the other the marker at the same column.
  const rows = renderGanttRows({ width: 60, today: 5, tasks: [{ label: "Build", start: 0, end: 10 }, { label: "Docs", start: 7, end: 9 }] });
  const text = rows.map((row) => runsText(row.runs));
  const build = text.find((row) => row.includes("Build"));
  const docs = text.find((row) => row.includes("Docs"));
  const column = cellsOf(docs).indexOf("┊");
  assert.ok(column > 0, "the today line is drawn");
  assert.ok("█▌▐".includes(cellsOf(build)[column]), "a bar crossing today keeps its own ink");
});

check("a bar end lands between cells", () => {
  const rows = renderGanttRows(numeric);
  const text = rows.map((row) => runsText(row.runs));
  const plan = text.find((row) => row.includes("Plan"));
  // 1.5 of 10 units over 49 columns is 7.35, so the bar ends inside a cell and
  // the last glyph is a partial block rather than a full one.
  const tail = [...plan.replace(/\s+$/, "")].pop() ?? "";
  const code = tail.codePointAt(0) ?? 0;
  const half = tail !== "█" && (
    (code >= 0x2589 && code <= 0x259f) ||
    (code >= 0x1cd00 && code <= 0x1cde5) ||
    (code >= 0x1fb00 && code <= 0x1fbff)
  );
  assert.ok(half, `a partial cell closes the bar: ${plan}`);
});

check("an empty gantt says so", () => {
  const rows = textRows(renderGanttRows({ width: 40, tasks: [] }));
  assert.ok(rows.some((row) => row.includes("no data")));
});

check("every row fits the chart and holds only canvas or text", () => {
  for (const spec of [dated, numeric]) {
    for (const row of textRows(renderGanttRows(spec))) {
      assert.ok(cols(row) <= spec.width, `row within ${spec.width}: ${cols(row)}`);
      for (const cell of cellsOf(row)) {
        // Plain text is the label column, the tick labels and the legend.
        if (cell === " " || /[0-9A-Za-z:+\-.]/.test(cell)) continue;
        if ("│┬─◆┊·●".includes(cell)) continue;
        // Block and mosaic ranges: the bar glyphs.
        const code = cell.codePointAt(0);
        const ok = (code >= 0x2580 && code <= 0x259f) || (code >= 0x1cd00 && code <= 0x1cde5) || (code >= 0x1fb00 && code <= 0x1fbff);
        assert.ok(ok, `unexpected glyph ${cell} (U+${code.toString(16)})`);
      }
    }
  }
});

console.log(`\n${checks}/${checks} checks passed`);
