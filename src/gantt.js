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

import { blankGrid, cellsToRuns, cols, formatNumber, stampText, titleRow, truncate } from "./core.js";
import { glyphFor, modeName, modeShape } from "./mosaic.js";
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
function taskMilestone(task) {
  return task.milestone === true || task.at !== undefined || task.date !== undefined;
}

function taskFrom(task) {
  return parseWhen(task.start ?? task.from ?? task.at ?? task.date);
}

function taskTo(task) {
  return parseWhen(task.end ?? task.to ?? task.finish ?? task.start ?? task.from ?? task.at ?? task.date);
}

/** One task's two times, or null when it cannot be placed. */
function readTask(task) {
  if (!task || typeof task !== "object") return null;
  const from = taskFrom(task);
  const to = taskTo(task);
  if (!from || !to) return null;
  return { task, milestone: taskMilestone(task), from, to };
}

function parseTaskRows(raw) {
  const rows = [];
  let base = null;
  // A task without a usable time cannot be placed on the timeline, so it is left
  // out. The count travels with the tasks: the footer says how many are missing
  // instead of the row disappearing without a word.
  let dropped = 0;

  for (const task of raw) {
    const row = readTask(task);
    if (!row) {
      dropped += 1;
      continue;
    }
    if (row.from.date || row.to.date) {
      base = base === null ? Math.min(row.from.value, row.to.value) : Math.min(base, row.from.value, row.to.value);
    }
    rows.push(row);
  }
  return { rows, base, dropped };
}

function groupOf(task) {
  const group = task.group ?? task.section ?? null;
  return group === null ? null : String(group);
}

function taskLabel(task, index) {
  return String(task.label ?? task.name ?? `task ${index + 1}`);
}

function taskColor(task) {
  return typeof task.color === "string" ? task.color : null;
}

function buildTask(task, milestone, from, to, index, at, names) {
  const start = at(from);
  const end = at(to);
  const group = groupOf(task);
  if (group !== null && !names.includes(group)) names.push(group);
  return {
    label: taskLabel(task, index),
    group,
    milestone: milestone === true,
    from: Math.min(start, end),
    to: Math.max(start, end),
    color: taskColor(task),
  };
}

function scaleTasks(rows, base) {
  const dated = base !== null;
  const names = [];
  const at = (entry) => (dated && entry.date ? (entry.value - base) / MS_DAY : entry.value);
  const tasks = rows.map(({ task, milestone, from, to }, index) =>
    buildTask(task, milestone, from, to, index, at, names),
  );
  return { tasks, names, dated };
}

function taskRange(tasks, spec) {
  const ends = tasks.flatMap((task) => [task.from, task.to]);
  // The domain is the data, not zero. Forcing zero made tasks 100..200 draw from
  // the left edge with a bar that says nothing about their own span. A caller can
  // still ask for zero (or any range) with `min`/`max`. Dates are day offsets
  // from the earliest date, so their data min is already zero.
  let dataMin = 0;
  let dataMax = 1;
  if (ends.length > 0) {
    dataMin = ends[0];
    dataMax = ends[0];
    // A loop, not a spread: the spread overflows the stack on a large series.
    for (const value of ends) {
      if (value < dataMin) dataMin = value;
      if (value > dataMax) dataMax = value;
    }
  }
  const min = Number.isFinite(Number(spec.min)) ? Number(spec.min) : dataMin;
  const max = Number.isFinite(Number(spec.max)) ? Number(spec.max) : Math.max(dataMax, min + 1);
  return { min, max: max > min ? max : min + 1 };
}

function todayOffset(spec, base, dated) {
  const today = parseWhen(spec.today);
  return today ? (dated && today.date ? (today.value - base) / MS_DAY : today.value) : null;
}

export function normalizeTasks(spec) {
  const raw = Array.isArray(spec.tasks) ? spec.tasks : [];
  const { rows, base, dropped } = parseTaskRows(raw);
  const { tasks, names, dated } = scaleTasks(rows, base);
  const { min, max } = taskRange(tasks, spec);
  return { tasks, names, dated, base, min, max, todayAt: todayOffset(spec, base, dated), dropped };
}

/** The row budget for the whole chart, or Infinity when none was asked. */
function heightLimit(spec) {
  return Number.isFinite(Number(spec.height)) ? Math.max(3, Math.floor(Number(spec.height))) : Infinity;
}

/** The rule is decoration, so it is the first fixed row to go. */
function showRuleFor(limit, spec) {
  return limit === Infinity || limit - (spec.title ? 1 : 0) >= 3;
}

/** Running cost of the first k tasks, with one extra row per group header. */
function taskRowCosts(tasks, headerAt) {
  let seen = 0;
  return tasks.map((_, index) => (seen += headerAt[index] ? 2 : 1));
}

/** How many tasks fit, and what the cut costs in rows. */
function visibleTasks(tasks, rowCost, room) {
  let shown = tasks.length;
  if (room !== Infinity && rowCost[tasks.length - 1] > room) {
    // One of the rows left is the admission itself.
    let count = 0;
    while (count < tasks.length && rowCost[count] + 1 <= room) count += 1;
    shown = count;
  }
  const truncated = shown < tasks.length;
  return {
    shown,
    truncated,
    missing: tasks.length - shown,
    bodyRows: shown > 0 ? rowCost[shown - 1] : 0,
  };
}

/** The legend is a key, not data, so it goes before a task does. */
function legendCountFor(spec, names, truncated, spare) {
  const room = spec.legend === false || truncated ? 0 : names.length;
  return spare >= room ? room : 0;
}

/** A note costs a row, so it is dropped when no task could follow it. */
function noteBudget(limit, notes, room) {
  if (limit !== Infinity && notes.length > 0 && room < notes.length + 1) return [];
  return notes;
}

/** The rows the height budget leaves for tasks, notes and the legend. */
function ganttWindow(spec, tasks, names, headerAt, notes) {
  // `height` is the row budget for the whole chart, not for the plot: the title,
  // the scale, the rule, the task rows, the admission that some are missing, the
  // note, and the legend all spend from it.
  const limit = heightLimit(spec);
  const showRule = showRuleFor(limit, spec);
  const fixed = (spec.title ? 1 : 0) + 1 + (showRule ? 1 : 0);
  const rowCost = taskRowCosts(tasks, headerAt);

  let room = limit === Infinity ? Infinity : Math.max(0, limit - fixed);
  const noteRows = noteBudget(limit, notes, room);
  room = limit === Infinity ? Infinity : room - noteRows.length;

  const { shown, truncated, missing, bodyRows } = visibleTasks(tasks, rowCost, room);
  const spare = room === Infinity ? Infinity : room - bodyRows - (truncated ? 1 : 0);
  const legendCount = legendCountFor(spec, names, truncated, spare);
  return { limit, showRule, fixed, rowCost, noteRows, shown, truncated, missing, spare, legendCount };
}

/** Label column, plot width and the value-to-cell mapping. */
function ganttGeometry(spec, width, tasks, shown, min, max) {
  // Display width, not code points: a CJK label is two cells per glyph.
  let widest = 4;
  for (const task of tasks.slice(0, shown)) widest = Math.max(widest, cols(task.label));
  const labelWidth = Math.min(Math.max(8, widest), Math.max(8, Math.floor(width * 0.3)));
  const plot = Math.max(6, width - labelWidth - 1);
  const left = labelWidth + 1;
  const span = max - min;
  // Positions run over the last cell, not past it, so a task that ends exactly at
  // the range's end (a milestone on the last day) still lands on a column.
  const posOf = (value) => ((value - min) / span) * (plot - 1);
  // A typo is a fallback, not a crash: every other family reads its mosaic the
  // same way, and this runs inside the TUI measure callback.
  const mode = modeName(spec.mosaic === false ? "quadrant" : spec.mosaic);
  const shape = modeShape(mode);
  return {
    labelWidth,
    plot,
    left,
    span,
    posOf,
    mode,
    shape,
    subColumns: shape.columns,
    solidMask: 2 ** (shape.columns * shape.rows) - 1,
    palette: paletteOf(spec),
  };
}

/** Ticks that fit the plot, with the column each one lands on. */
function ganttTicks(min, max, plot) {
  const span = max - min;
  const step = tickStep(span, plot);
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    const column = Math.round(((value - min) / span) * (plot - 1));
    if (column >= 0 && column < plot) ticks.push({ value, column });
  }
  return ticks;
}

/** Grid writes, clipped to the chart. */
function ganttCanvas(grid, width) {
  const cell = (x, y, char, kind, color) => {
    if (x < 0 || x >= width || y < 0 || y >= grid.length) return;
    grid[y][x] = { slice: -1, char, kind, mask: 0, color };
  };
  const text = (x, y, value, kind) => stampText(grid, x, y, value, { slice: -1, kind, mask: 0 });
  const label = (row, value, kind, labelWidth) => {
    const text0 = truncate(value, labelWidth);
    // Right-align by display width, so the separator lands in the same column.
    stampText(grid, labelWidth - cols(text0), row, text0, { slice: -1, kind, mask: 0 });
    cell(labelWidth, row, "│", "axis");
  };
  const at = (row, column) => grid[row]?.[column];
  return { cell, text, label, at };
}

/** Scale row: one label per tick, skipping a label that would touch the next. */
function drawGanttScale(canvas, { left, plot, labelWidth, ticks, dated, base, y }) {
  for (const [index, tick] of ticks.entries()) {
    const next = ticks[index + 1]?.column ?? plot;
    const label = dated ? dayLabel(base, tick.value) : formatNumber(tick.value);
    if (cols(label) > next - tick.column - 1) continue;
    canvas.text(left + tick.column, y, label, "axis");
  }
  canvas.label(y, "task", "axis", labelWidth);
  return y + 1;
}

/** The rule under the scale, with a tick mark under every label. */
function drawGanttRule(canvas, { left, plot, ticks, labelWidth, y }) {
  for (let x = 0; x < plot; x++) canvas.cell(left + x, y, "─", "axis");
  for (const tick of ticks) canvas.cell(left + tick.column, y, "┬", "axis");
  canvas.label(y, "", "axis", labelWidth);
  return y + 1;
}

/** One task row: a milestone diamond or a sub-cell bar. */
function drawGanttTask(canvas, task, index, state) {
  const { left, plot, labelWidth, posOf, shape, subColumns, solidMask, mode, colorOf, y } = state;
  const color = colorOf(task, index);
  canvas.label(y, task.label, "text", labelWidth);

  if (task.milestone) {
    canvas.cell(left + Math.round(posOf(task.from)), y, "◆", "fill", color);
    return;
  }

  const from = posOf(task.from);
  const to = Math.max(posOf(task.to), from + 1 / subColumns);
  for (let x = 0; x < plot; x++) {
    // One mask per cell: every sub-row of a covered sub-column is filled.
    let mask = 0;
    for (let sub = 0; sub < subColumns; sub++) {
      const centre = x + (sub + 0.5) / subColumns;
      if (!(centre >= from && centre < to)) continue;
      for (let row = 0; row < shape.rows; row++) mask |= 1 << (row * shape.columns + sub);
    }
    if (mask !== 0) canvas.cell(left + x, y, glyphFor(mask === solidMask ? solidMask : mask, mode), "fill", color);
  }
}

/** Task rows, with a group header before the first task of each group. */
function drawGanttTasks(canvas, tasks, state) {
  let y = state.y;
  let currentGroup = null;
  let lastRow = y;
  for (const [index, task] of tasks.slice(0, state.shown).entries()) {
    if (task.group !== null && task.group !== currentGroup) {
      currentGroup = task.group;
      canvas.label(y, currentGroup, "title", state.labelWidth);
      y += 1;
    }
    drawGanttTask(canvas, task, index, { ...state, y });
    lastRow = y;
    y += 1;
  }
  return { y, lastRow };
}

function todayVisible(todayAt, min, max, spec) {
  return todayAt !== null && todayAt >= min && todayAt <= max && spec.today !== false;
}

/** Today line, only in cells nothing else owns. */
function drawGanttToday(canvas, { todayAt, min, max, spec, showRule, lastRow, left, plot, posOf, palette }) {
  if (!todayVisible(todayAt, min, max, spec)) return;
  const column = left + Math.round(posOf(todayAt));
  const color = spec.todayColor ?? palette[3];
  // Start at the rule when there is one, so the marker can use its empty cells.
  for (let row = showRule ? 1 : 0; row <= lastRow; row++) {
    const existing = canvas.at(row, column);
    if (existing && existing.char !== " ") continue;
    canvas.cell(column, row, "┊", "fill", color);
  }
}

/** The whole grid: scale, rule, tasks, today marker. */
function buildGanttGrid(spec, width, tasks, names, window, geometry, headerAt, dated, base, min, max, todayAt) {
  // One row per group header, so the grid is measured before it is built.
  let headers = 0;
  for (let index = 0; index < window.shown; index++) if (headerAt[index]) headers += 1;
  const grid = blankGrid(width, 1 + (window.showRule ? 1 : 0) + window.shown + headers);
  const canvas = ganttCanvas(grid, width);

  const ticks = ganttTicks(min, max, geometry.plot);
  let y = 0;
  y = drawGanttScale(canvas, { ...geometry, ticks, dated, base, y });
  if (window.showRule) y = drawGanttRule(canvas, { ...geometry, ticks, y });

  const colorOf = (task, index) => {
    if (task.color) return task.color;
    const slot = task.group === null ? names.length + index : names.indexOf(task.group);
    return geometry.palette[((slot % geometry.palette.length) + geometry.palette.length) % geometry.palette.length];
  };

  const painted = drawGanttTasks(canvas, tasks, {
    ...geometry,
    colorOf,
    y,
    shown: window.shown,
  });
  drawGanttToday(canvas, {
    todayAt,
    min,
    max,
    spec,
    showRule: window.showRule,
    lastRow: painted.lastRow,
    ...geometry,
  });
  return grid;
}

/** The non-empty rows of a grid, as styled rows. */
function ganttRowsFromGrid(grid, width) {
  const rows = [];
  for (const row of grid) {
    if (row.every((entry) => entry.char === " ")) continue;
    rows.push({ width, runs: cellsToRuns(row) });
  }
  return rows;
}

/**
 * What the picture could not show, in the order a reader needs it: the cut,
 * then the reason a task was invalid, then the colour key.
 */
function ganttFooter(rows, width, window, names, palette) {
  if (window.truncated) {
    const text = truncate(`  … ${window.missing} more ${window.missing === 1 ? "task" : "tasks"}`, width);
    rows.push({ width, runs: [{ text, slice: -1, kind: "legend" }] });
  }
  for (const note of window.noteRows) {
    rows.push({ width, runs: [{ text: truncate(note, width), slice: -1, kind: "legend" }] });
  }
  for (const [index, name] of names.slice(0, window.legendCount).entries()) {
    rows.push({
      width,
      runs: [
        { text: "● ", slice: index % palette.length, kind: "legend-mark" },
        { text: truncate(name, width - 2), slice: -1, kind: "legend" },
      ],
    });
  }
}

/** The rows a Gantt draws: title, scale, one row per task, then the legend. */
export function renderGanttRows(spec) {
  const width = Math.max(24, Math.floor(spec.width ?? 80));
  const rows = [];
  if (spec.title) rows.push(titleRow(spec.title, width));

  const { tasks, names, dated, base, min, max, todayAt, dropped } = normalizeTasks(spec);
  if (tasks.length === 0) {
    rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });
    return rows;
  }

  const headerAt = tasks.map((task, index) => task.group !== null && task.group !== (tasks[index - 1]?.group ?? null));
  const notes = [];
  if (dropped > 0) notes.push(`  ${dropped} ${dropped === 1 ? "task" : "tasks"} omitted (no usable time)`);
  const window = ganttWindow(spec, tasks, names, headerAt, notes);
  const geometry = ganttGeometry(spec, width, tasks, window.shown, min, max);
  const grid = buildGanttGrid(spec, width, tasks, names, window, geometry, headerAt, dated, base, min, max, todayAt);

  rows.push(...ganttRowsFromGrid(grid, width));
  ganttFooter(rows, width, window, names, geometry.palette);
  return rows;
}
