// Gantt rendering for a character grid, in plain text or in colour.
//
// A Gantt is a timeline: a label column, a scale, and one row per task whose bar
// covers the task's span. Three things make it work in a terminal:
//
// 1. The bar ends land between cells. Each cell is sampled as a sub-cell grid
//    (2x2, 2x3 or 2x4, the shared mosaic tables), so a bar that starts at 3.4
//    draws a partial block instead of snapping to a whole cell.
// 2. Times are read as raw numbers, or as ISO dates turned into day offsets from
//    the first date. Everything downstream works in one unit, so the axis, the
//    bars and the today marker cannot disagree about where a moment sits.
// 3. The scale picks its own step (1, 2, 5, 10, ...) so tick labels never
//    collide, the same rule the axis charts use for their gutter.

import { blankGrid, cellsToRuns, formatNumber, stampText, titleRow, truncate } from "./core.js";
import { glyphFor, modeShape } from "./mosaic.js";
import { paletteOf } from "./theme.js";

const MS_DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A time as an ISO date or a plain number. Returns `null` for anything else, so
 * a bad value drops its task instead of drawing the bar in the wrong place.
 */
export function parseWhen(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { value, date: null };
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  return { value: time, date: new Date(time) };
}

/** "Nov 2" for a day offset from the first date. */
export function dayLabel(base, day) {
  // A date-only ISO string parses as UTC midnight, so every part of the label has
  // to be read in UTC too: local getters would show the previous day anywhere
  // west of Greenwich.
  const date = new Date(base + Math.round(day) * MS_DAY);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** The first 1/2/5/10 step whose ticks are at least `gap` cells apart. */
export function tickStep(span, plot, gap = 10) {
  const rough = Math.max(span, 1e-9) / Math.max(1, Math.floor(plot / gap));
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  for (const factor of [1, 2, 5, 10]) if (rough <= factor * power) return factor * power;
  return 10 * power;
}

/**
 * Tasks in one unit, with the group each belongs to. Dates win over numbers: if
 * any task carries an ISO date, every value is read as days from the earliest
 * date, so a number mixed in is a day offset rather than a second unit.
 */
export function normalizeTasks(spec) {
  const raw = Array.isArray(spec.tasks) ? spec.tasks : [];
  const rows = [];
  const names = [];
  let base = null;

  for (const task of raw) {
    if (!task || typeof task !== "object") continue;
    const milestone = task.milestone === true || task.at !== undefined || task.date !== undefined;
    const from = parseWhen(task.start ?? task.from ?? task.at ?? task.date);
    const to = parseWhen(task.end ?? task.to ?? task.finish ?? task.start ?? task.from ?? task.at ?? task.date);
    if (!from || !to) continue;
    if (from.date || to.date) base = base === null ? Math.min(from.value, to.value) : Math.min(base, from.value, to.value);
    rows.push({ task, milestone, from, to });
  }

  const dated = base !== null;
  const tasks = rows.map(({ task, milestone, from, to }, index) => {
    const at = (entry) => (dated && entry.date ? (entry.value - base) / MS_DAY : entry.value);
    const start = at(from);
    const end = at(to);
    const group = task.group ?? task.section ?? null;
    if (group !== null && !names.includes(String(group))) names.push(String(group));
    return {
      label: String(task.label ?? task.name ?? `task ${index + 1}`),
      group: group === null ? null : String(group),
      milestone: milestone === true,
      from: Math.min(start, end),
      to: Math.max(start, end),
      color: typeof task.color === "string" ? task.color : null,
    };
  });

  const ends = tasks.flatMap((task) => [task.from, task.to]);
  const min = Number.isFinite(Number(spec.min)) ? Number(spec.min) : Math.min(...ends, 0);
  const max = Number.isFinite(Number(spec.max)) ? Number(spec.max) : Math.max(...ends, min + 1);
  const today = parseWhen(spec.today);
  const todayAt = today ? (dated && today.date ? (today.value - base) / MS_DAY : today.value) : null;

  return { tasks, names, dated, base, min, max: max > min ? max : min + 1, todayAt };
}

/** The rows a Gantt draws: title, scale, one row per task, then the legend. */
export function renderGanttRows(spec) {
  const width = Math.max(24, Math.floor(spec.width ?? 80));
  const rows = [];
  if (spec.title) rows.push(titleRow(spec.title, width));

  const { tasks, names, dated, base, min, max, todayAt } = normalizeTasks(spec);
  if (tasks.length === 0) {
    rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });
    return rows;
  }

  const palette = paletteOf(spec);
  const mode = spec.mosaic === false ? "quadrant" : (spec.mosaic ?? "sextant");
  const shape = modeShape(mode);
  const subColumns = shape.columns;
  const solidMask = 2 ** (shape.columns * shape.rows) - 1;

  // The label column is as wide as the longest task name, within reason.
  const widest = Math.max(...tasks.map((task) => task.label.length), 4);
  const labelWidth = Math.min(Math.max(8, widest), Math.max(8, Math.floor(width * 0.3)));
  const plot = Math.max(6, width - labelWidth - 1);
  // Where the plot area starts: the label column plus its separator.
  const left = labelWidth + 1;
  const span = max - min;
  // Positions run over the last cell, not past it, so a task that ends exactly at
  // the range's end (a milestone on the last day) still lands on a column.
  const posOf = (value) => ((value - min) / span) * (plot - 1);

  // One row per group header, so the grid is measured before it is built.
  let headers = 0;
  let previous = null;
  for (const task of tasks) {
    if (task.group !== null && task.group !== previous) headers += 1;
    previous = task.group;
  }
  const grid = blankGrid(width, 2 + tasks.length + headers);
  const cell = (x, y, char, kind, color) => {
    if (x < 0 || x >= width || y < 0 || y >= grid.length) return;
    grid[y][x] = { slice: -1, char, kind, mask: 0, color };
  };

  // Group colours: one palette entry per group, in the order they appear.
  const colorOf = (task, index) => {
    if (task.color) return task.color;
    const slot = task.group === null ? names.length + index : names.indexOf(task.group);
    return palette[((slot % palette.length) + palette.length) % palette.length];
  };

  // Scale: ticks at a step that keeps their labels apart.
  const step = tickStep(span, plot);
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    const column = Math.round(posOf(value));
    if (column >= 0 && column < plot) ticks.push({ value, column });
  }

  let y = 0;
  const labelCell = (row, text, kind) => {
    const text0 = truncate(text, labelWidth);
    stampText(grid, labelWidth - text0.length, row, text0, { slice: -1, kind, mask: 0 });
    cell(labelWidth, row, "│", "axis");
  };

  // The scale row, then a rule with a tick mark under every label.
  for (const [index, tick] of ticks.entries()) {
    const next = ticks[index + 1]?.column ?? plot;
    const label = dated ? dayLabel(base, tick.value) : formatNumber(tick.value);
    // A label that does not fit is left out: "1" cut from "10" reads as a lie,
    // and a missing tick is easier to spot than a wrong one.
    if (label.length > next - tick.column - 1) continue;
    stampText(grid, left + tick.column, y, label, { slice: -1, kind: "axis", mask: 0 });
  }
  labelCell(y, "task", "axis");
  y += 1;
  for (let x = 0; x < plot; x++) cell(left + x, y, "─", "axis");
  for (const tick of ticks) cell(left + tick.column, y, "┬", "axis");
  labelCell(y, "", "axis");
  y += 1;

  let currentGroup = null;
  let lastRow = y;

  for (const [index, task] of tasks.entries()) {
    if (task.group !== null && task.group !== currentGroup) {
      currentGroup = task.group;
      labelCell(y, currentGroup, "title");
      y += 1;
    }

    const color = colorOf(task, index);
    labelCell(y, task.label, "text");

    if (task.milestone) {
      cell(left + Math.round(posOf(task.from)), y, "◆", "fill", color);
    } else {
      const from = posOf(task.from);
      const to = Math.max(posOf(task.to), from + 1 / subColumns);
      for (let x = 0; x < plot; x++) {
        // One mask per cell: every sub-row of a covered sub-column is filled. A
        // full mask is the solid block, a partial one follows the bar's edge.
        let mask = 0;
        for (let sub = 0; sub < subColumns; sub++) {
          const centre = x + (sub + 0.5) / subColumns;
          if (!(centre >= from && centre < to)) continue;
          for (let row = 0; row < shape.rows; row++) mask |= 1 << (row * shape.columns + sub);
        }
        if (mask !== 0) cell(left + x, y, glyphFor(mask === solidMask ? solidMask : mask, mode), "fill", color);
      }
    }

    lastRow = y;
    y += 1;
  }

  // The today marker runs down the plot area only where nothing else is drawn, so
  // it never paints over a bar.
  if (todayAt !== null && todayAt >= min && todayAt <= max && spec.today !== false) {
    const column = left + Math.round(posOf(todayAt));
    const color = spec.todayColor ?? palette[3];
    for (let row = 1; row <= lastRow; row++) {
      const existing = grid[row][column];
      if (existing && existing.char !== " ") continue;
      cell(column, row, "┊", "fill", color);
    }
  }

  for (const row of grid) {
    if (row.every((entry) => entry.char === " ")) continue;
    rows.push({ width, runs: cellsToRuns(row) });
  }

  if (names.length > 0 && spec.legend !== false) {
    rows.push(
      ...names.map((name, index) => ({
        width,
        runs: [
          { text: "● ", slice: index % palette.length, kind: "legend-mark" },
          { text: name, slice: -1, kind: "legend" },
        ],
      })),
    );
  }

  return rows;
}
