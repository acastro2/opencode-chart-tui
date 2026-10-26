// Golden frames: the exact text every family draws at a fixed matrix of widths,
// themes and mosaic modes.
//
// Why: the property tests prove invariants, not the picture. A label can move one
// column, a rim can lose a glyph, and every assertion still passes. A golden file
// makes that change visible in review. `--update` is a human decision, never a
// blind refresh: read the diff before you keep it.
//
// Usage:
//   node scripts/golden.mjs --check     compare (default; exits 1 on drift)
//   node scripts/golden.mjs --update    rewrite test/golden/*.json
//   node scripts/golden.mjs --family pie

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SAMPLES } from "./samples.mjs";
import { renderChart } from "../src/chart.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, "test", "golden");
const WIDTHS = [20, 40, 56, 80, 120];
const THEMES = ["dark", "light"];
const MOSAICS = ["quadrant", "sextant", "octant"];
const VARIANT_WIDTHS = [20, 40, 56, 80];
const VARIANTS_FILE = "_variants.json";

/**
 * Specs the one-sample-per-family grid cannot reach: grouped and stacked
 * series, multi-series lines, and the small-height paths where a note competes
 * with the plot for rows. Without these the grouped-bar floor bug drew for
 * months behind a green gate, because every sample had exactly one series.
 */
export const VARIANTS = {
  "bar-grouped": {
    type: "bar",
    title: "Bookings by state",
    labels: ["Jul", "Aug", "Sep"],
    series: [{ name: "Closed", values: [120, 90, 60] }, { name: "Open", values: [30, 60, 90] }],
    height: 9,
  },
  "bar-stacked": {
    type: "bar",
    title: "Bookings by state",
    labels: ["Jul", "Aug", "Sep"],
    series: [{ name: "Closed", values: [120, 90, 60] }, { name: "Open", values: [30, 60, 90] }],
    stacked: true,
    height: 9,
  },
  "hbar-grouped": {
    type: "hbar",
    title: "Accounts by region",
    labels: ["Globex", "Initech"],
    series: [{ name: "This year", values: [42, 31] }, { name: "Last year", values: [30, 44] }],
  },
  "line-multi": {
    type: "line",
    title: "Revenue and cost",
    labels: ["Jan", "Feb", "Mar", "Apr", "May"],
    series: [{ name: "Revenue", values: [12, 18, 15, 22, 26] }, { name: "Cost", values: [9, 11, 12, 13, 15] }],
    height: 9,
  },
  "area-stacked": {
    type: "area",
    title: "Traffic by source",
    labels: ["A", "B", "C", "D"],
    series: [{ name: "Base", values: [3, 4, 3, 5] }, { name: "Add-on", values: [2, 1, 2, 1] }],
    stacked: true,
    height: 9,
  },
  "area-stacked-single": {
    type: "area",
    title: "Traffic",
    labels: ["A", "B", "C"],
    series: [{ name: "Only", values: [3, 4, 3] }],
    stacked: true,
    height: 8,
  },
  "kanban-tight": {
    type: "kanban",
    title: "Sprint",
    height: 9,
    columns: [
      { title: "Todo", cards: [{ title: "a" }, { title: "b" }] },
      { title: "Doing", cards: [{ title: "c" }] },
    ],
  },
  "candle-many": {
    type: "candle",
    title: "ACME",
    labels: Array.from({ length: 12 }, (_, index) => `${index + 1}`),
    candles: Array.from({ length: 12 }, (_, index) => ({
      open: 10 + index, high: 12 + index, low: 9 + index, close: 11 + index,
    })),
    height: 8,
  },
  "bar-many": {
    type: "bar",
    title: "Thirty categories",
    labels: Array.from({ length: 30 }, (_, index) => `S${index}`),
    values: Array.from({ length: 30 }, (_, index) => index + 1),
    height: 8,
  },
  "histogram-many": {
    type: "histogram",
    title: "Many bins",
    values: Array.from({ length: 120 }, (_, index) => (index * 37) % 100),
    bins: 60,
    height: 12,
  },
  "candle-bad": {
    type: "candle",
    title: "One row missing a price",
    candles: [
      { open: 10, high: 12, low: 9, close: 11 },
      { open: 11, high: 13, low: 10 },
      { open: 12, high: 14, low: 11, close: 13 },
    ],
    height: 8,
  },
};

function frameKey(width, theme, mosaic) {
  return `${width}-${theme}-${mosaic}`;
}

/** Every frame for one family, keyed by width-theme-mosaic. */
export function familyFrames(type, sample, widths = WIDTHS) {
  const frames = {};
  for (const width of widths) {
    for (const theme of THEMES) {
      for (const mosaic of MOSAICS) {
        frames[frameKey(width, theme, mosaic)] = renderChart({
          ...sample,
          type,
          width,
          theme,
          mosaic,
        }).split("\n");
      }
    }
  }
  return frames;
}

/** Frames for the variant specs, keyed by `<name>/<width>-<theme>-<mosaic>`. */
export function variantFrames() {
  const frames = {};
  for (const [name, spec] of Object.entries(VARIANTS)) {
    const { type, ...rest } = spec;
    for (const [key, rows] of Object.entries(familyFrames(type, rest, VARIANT_WIDTHS))) {
      frames[`${name}/${key}`] = rows;
    }
  }
  return frames;
}

/** Write or compare all golden files. Returns counts; throws on drift. */
export function checkGoldens({ update = false, family = null } = {}) {
  mkdirSync(DIR, { recursive: true });
  // A typo used to match nothing and pass with "0/0 frames match".
  if (family && !Object.hasOwn(SAMPLES, family)) {
    return { checked: 0, failures: [`unknown family: ${family}`], updated: false };
  }
  const types = Object.keys(SAMPLES).filter((type) => !family || type === family);
  let checked = 0;
  const failures = [];

  for (const type of types) {
    const file = join(DIR, `${type}.json`);
    const frames = familyFrames(type, SAMPLES[type]);
    if (update) {
      writeFileSync(file, `${JSON.stringify(frames)}\n`);
      checked += Object.keys(frames).length;
      continue;
    }
    if (!existsSync(file)) {
      failures.push(`${type}: missing ${file}`);
      continue;
    }
    const expected = JSON.parse(readFileSync(file, "utf8"));
    for (const [key, rows] of Object.entries(frames)) {
      checked += 1;
      const want = expected[key];
      if (!Array.isArray(want)) {
        failures.push(`${type}/${key}: missing frame`);
        continue;
      }
      if (want.length !== rows.length || want.some((row, index) => row !== rows[index])) {
        const at = want.findIndex((row, index) => row !== rows[index]);
        failures.push(
          at < 0
            ? `${type}/${key}: ${rows.length - want.length} extra row(s) at the end`
            : `${type}/${key}: frame differs at row ${at + 1}`,
        );
      }
    }
    for (const key of Object.keys(expected)) {
      if (!(key in frames)) failures.push(`${type}/${key}: stale frame (no longer generated)`);
    }
  }

  // The variant grid: extra specs in one file, checked only on a full run.
  if (!family) {
    const file = join(DIR, VARIANTS_FILE);
    const frames = variantFrames();
    if (update) {
      writeFileSync(file, `${JSON.stringify(frames)}\n`);
      checked += Object.keys(frames).length;
    } else if (!existsSync(file)) {
      failures.push(`variants: missing ${file}`);
    } else {
      const expected = JSON.parse(readFileSync(file, "utf8"));
      for (const [key, rows] of Object.entries(frames)) {
        checked += 1;
        const want = expected[key];
        if (!Array.isArray(want)) {
          failures.push(`variants/${key}: missing frame`);
          continue;
        }
        if (want.length !== rows.length || want.some((row, index) => row !== rows[index])) {
          const at = want.findIndex((row, index) => row !== rows[index]);
          failures.push(
            at < 0
              ? `variants/${key}: ${rows.length - want.length} extra row(s) at the end`
              : `variants/${key}: frame differs at row ${at + 1}`,
          );
        }
      }
      for (const key of Object.keys(expected)) {
        if (!(key in frames)) failures.push(`variants/${key}: stale frame (no longer generated)`);
      }
    }
  }

  if (update) return { checked, failures, updated: true };
  return { checked, failures, updated: false };
}

/** The files in test/golden that no longer belong to a family. */
export function extraGoldenFiles() {
  if (!existsSync(DIR)) return [];
  const types = new Set(Object.keys(SAMPLES));
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".json") && name !== VARIANTS_FILE && !types.has(name.slice(0, -5)))
    .map((name) => join(DIR, name));
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const familyAt = args.indexOf("--family");
  const family = familyAt >= 0 ? args[familyAt + 1] : null;
  const result = checkGoldens({ update, family });
  if (update) {
    console.log(`golden: wrote ${result.checked} frames for ${family ?? "all families"}`);
    return;
  }
  for (const failure of result.failures) console.error(`golden: ${failure}`);
  for (const extra of extraGoldenFiles()) console.error(`golden: stale file ${extra}`);
  console.log(`golden: ${Math.max(0, result.checked - result.failures.length)}/${result.checked} frames match`);
  if (result.failures.length > 0 || extraGoldenFiles().length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
