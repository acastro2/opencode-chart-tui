// Candlesticks: one period per column, the body from open to close, the wick
// from low to high, drawn in the same sub-cell grid as every other family.
//
// Up and down periods take different colours. A candle is the one chart where a
// colour change is information rather than decoration, so the two colours are
// explicit runs rather than palette entries, and they can be overridden.
//
//   { "type": "candle", "candles": [{ "label": "Jan", "open": 100, "high": 118,
//                                    "low": 96, "close": 112 }, ...] }
//   { "type": "candle", "values": [[100, 118, 96, 112], ...] }

import {
  BLANK,
  SOLID,
  cellsToRuns,
  makeSampler,
  normalizeEntries,
  padTo,
  paintCell,
  tallyFromGrid,
  titleRow,
} from "./core.js";
import { themeOf } from "./theme.js";
import { axisRow, baseline, buildAxis, pointLabelRow, subRowOf } from "./axis.js";

export const CANDLE_UP = "#57c98a";
export const CANDLE_DOWN = "#e5695f";

/** Accept { label, open, high, low, close } rows or [open, high, low, close]. */
export function normalizeCandles(spec) {
  const raw = Array.isArray(spec.candles) ? spec.candles : Array.isArray(spec.values) ? spec.values : [];
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const candles = [];

  for (const [index, item] of raw.entries()) {
    const row = Array.isArray(item)
      ? { open: item[0], high: item[1], low: item[2], close: item[3] }
      : item ?? {};
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    candles.push({
      // The high is the top and the low is the bottom, whatever the caller sent.
      label: String(row.label ?? labels[index] ?? index + 1),
      open,
      close,
      high: Math.max(high, open, close, low),
      low: Math.min(low, open, close, high),
    });
  }

  return candles;
}

function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

export function renderCandleRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const candles = normalizeCandles(spec);
  const plotRows = Math.max(3, Math.min(30, Math.floor(spec.height ?? 10)));
  // Green up, red down, taken from the theme so a light terminal gets a darker
  // pair. `spec.up` / `spec.down` still win.
  const theme = themeOf(spec);
  const up = typeof spec.up === "string" ? spec.up : theme.palette[1];
  const down = typeof spec.down === "string" ? spec.down : theme.palette[3];
  const rows = [];

  if (spec.title) rows.push(titleRow(String(spec.title), width));
  if (candles.length === 0) {
    rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  const axis = buildAxis({
    min: Math.min(...candles.map((candle) => candle.low)),
    max: Math.max(...candles.map((candle) => candle.high)),
    plotRows,
    ticks: spec.ticks ?? 4,
    zero: spec.zero !== false,
  });
  const available = Math.max(1, width - axis.gutter);
  const sampler = makeSampler(spec.mosaic);
  const { columns, rows: rowsPerCell } = sampler.shape;
  const subColumns = available * columns;
  const subRows = axis.plotRows * rowsPerCell;

  const periodWidth = Math.max(1, Math.min(3, Math.floor(available / Math.max(1, candles.length)) - (candles.length > 1 ? 1 : 0))) || 1;
  // One clear column between periods, and few candles in a wide chart sit in the
  // middle rather than hugging the axis.
  const stride = periodWidth + (candles.length > 1 ? 1 : 0);
  const leftPad = Math.max(0, Math.floor((available - (candles.length * stride - (candles.length > 1 ? 1 : 0))) / 2));
  // 0 is an up period, 1 is a down period, -1 is empty.
  const grid = new Int8Array(subColumns * subRows).fill(-1);
  const mark = (x, y, index) => {
    if (x >= 0 && y >= 0 && x < subColumns && y < subRows) grid[y * subColumns + x] = index;
  };

  for (const [index, candle] of candles.entries()) {
    const direction = candle.close >= candle.open ? 0 : 1;
    const start = (leftPad + index * stride) * columns;
    const end = start + periodWidth * columns;
    // The body is inset so neighbouring candles never touch.
    let left = start + 1;
    let right = end - 2;
    if (right < left) {
      left = start;
      right = end - 1;
    }
    const centre = Math.floor((left + right) / 2);
    const wickWidth = Math.max(1, Math.floor((right - left + 1) / 3));

    const bodyTop = subRowOf(axis, Math.max(candle.open, candle.close), subRows);
    const bodyBottom = subRowOf(axis, Math.min(candle.open, candle.close), subRows);
    for (let x = left; x <= right; x++) {
      for (let y = bodyTop; y <= bodyBottom; y++) mark(x, y, direction);
    }

    const wickTop = subRowOf(axis, candle.high, subRows);
    const wickBottom = subRowOf(axis, candle.low, subRows);
    const wickLeft = centre - Math.floor((wickWidth - 1) / 2);
    for (let x = wickLeft; x < wickLeft + wickWidth; x++) {
      for (let y = wickTop; y <= wickBottom; y++) mark(x, y, direction);
    }
  }

  const cells = Array.from({ length: axis.plotRows }, () =>
    Array.from({ length: available }, () => null),
  );
  const seriesAt = (x, y) => grid[y * subColumns + x] ?? -1;

  for (let y = 0; y < axis.plotRows; y++) {
    for (let x = 0; x < available; x++) {
      const { mask, tally, masks } = tallyFromGrid(seriesAt, x, y, sampler);
      if (tally.size === 0) continue;
      const cell = paintCell({ sampler, mask, tally, masks, glyphs: [SOLID, SOLID] });
      cells[y][x] = { ...cell, color: cell.slice === 0 ? up : down };
    }
  }

  for (let row = 0; row < axis.plotRows; row++) {
    if (row === axis.zeroRow && cells[row].every((cell) => cell === null)) {
      const line = baseline(axis, available);
      rows.push({ width, runs: [axisRun(`${line.text}${line.mark}`), axisRun(line.line)] });
      continue;
    }
    const gutter = axisRow(axis, row);
    const line = cells[row].map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
    rows.push({ width, runs: [axisRun(`${gutter.text}${gutter.mark}`), ...cellsToRuns(line)] });
  }

  rows.push({
    width,
    runs: [axisRun(BLANK.repeat(axis.gutter)), axisRun(pointLabelRow(candles.map((candle) => candle.label), available))],
  });

  if (spec.legend !== false) {
    rows.push({
      width,
      runs: [
        { text: "● ", slice: -1, kind: "legend-mark", color: up },
        { text: padTo("up", 5), slice: -1, kind: "legend" },
        { text: "● ", slice: -1, kind: "legend-mark", color: down },
        { text: "down", slice: -1, kind: "legend" },
      ],
    });
  }

  return rows;
}

export { normalizeEntries };
