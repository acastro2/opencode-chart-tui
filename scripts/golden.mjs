// Golden frames: the exact text every family draws at a fixed matrix of widths,
// themes and mosaic modes, plus one run-level frame per family and variant at a
// fixed width and theme.
//
// Why: the property tests prove invariants, not the picture. A label can move one
// column, a rim can lose a glyph, and every assertion still passes. A golden file
// makes that change visible in review. `--update` is a human decision, never a
// blind refresh: read the diff before you keep it.
//
// The text grid catches a missing glyph. The run grid catches what text cannot:
// a kind demoted from `fill` to `outside`, a slice on the wrong series, or a
// palette swap. Neither replaces the other.
//
// Usage:
//   node scripts/golden.mjs --check     compare (default; exits 1 on drift)
//   node scripts/golden.mjs --update    rewrite test/golden/*.json
//   node scripts/golden.mjs --family pie

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SAMPLES, VARIANTS } from "./corpus.mjs";
import { rowsFrames } from "./frames.mjs";
import { renderChart } from "../src/chart.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, "test", "golden");
const WIDTHS = [20, 40, 56, 80, 120];
const THEMES = ["dark", "light"];
const MOSAICS = ["quadrant", "sextant", "octant"];
const VARIANT_WIDTHS = [20, 40, 56, 80];
const VARIANTS_FILE = "_variants.json";
const RUNS_FILE = "_runs.json";
// One width and one theme on purpose: the run frames exist to catch a kind,
// slice or colour mistake, not to re-test the width/theme matrix (the text
// goldens do that). A fixed pair keeps _runs.json small enough to review.
const RUN_WIDTH = 56;
const RUN_THEME = "dark";

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

/**
 * Every family and every variant at one width and theme, as styled runs. Keyed
 * like the variants file: a family by its name, a variant by its variant name.
 */
export function runFrames(only = null) {
  const frames = {};
  for (const [type, sample] of Object.entries(SAMPLES)) {
    if (only && type !== only) continue;
    frames[type] = rowsFrames({ ...sample, type, width: RUN_WIDTH, theme: RUN_THEME });
  }
  if (only) return frames;
  for (const [name, spec] of Object.entries(VARIANTS)) {
    frames[name] = rowsFrames({ ...spec, width: RUN_WIDTH, theme: RUN_THEME });
  }
  return frames;
}

/** Why a run frame differs, or null when it matches. The first run, named. */
function runDifference(want, got) {
  if (!Array.isArray(want)) return "missing frame";
  if (want.length !== got.length) return `${got.length} row(s), expected ${want.length}`;
  for (let row = 0; row < want.length; row += 1) {
    if (!Array.isArray(want[row])) return `row ${row + 1} is not a run list`;
    if (want[row].length !== got[row].length) {
      return `row ${row + 1}: ${got[row].length} run(s), expected ${want[row].length}`;
    }
    for (let index = 0; index < want[row].length; index += 1) {
      for (const key of ["text", "kind", "slice", "fg", "bg"]) {
        const before = JSON.stringify(want[row][index]?.[key]);
        const after = JSON.stringify(got[row][index]?.[key]);
        if (before !== after) return `row ${row + 1} run ${index + 1} ${key}: ${after}, expected ${before}`;
      }
    }
  }
  return null;
}

/** Write or compare all golden files. Returns counts; throws on drift. */
export function checkGoldens({ update = false, family = null } = {}) {
  mkdirSync(DIR, { recursive: true });
  // A typo used to match nothing and pass with "0/0 frames match".
  if (family && !Object.hasOwn(SAMPLES, family)) {
    return { checked: 0, runChecked: 0, failures: [`unknown family: ${family}`], updated: false };
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

  // Run-level goldens: one width, one theme, every family plus every variant.
  // This is the gate a text frame cannot be: a wrong kind, slice or colour is a
  // drift even when every character stays in place.
  const runFile = join(DIR, RUNS_FILE);
  const wanted = runFrames(family);
  let runChecked = 0;
  if (update) {
    // A family update keeps the other families' frames; a full update replaces
    // the file so a removed spec cannot leave a stale key behind.
    const existing = family && existsSync(runFile) ? JSON.parse(readFileSync(runFile, "utf8")) : {};
    writeFileSync(runFile, `${JSON.stringify({ ...existing, ...wanted })}\n`);
    runChecked = Object.keys(wanted).length;
  } else if (!existsSync(runFile)) {
    failures.push(`runs/${RUNS_FILE}: missing ${runFile}`);
  } else {
    const expected = JSON.parse(readFileSync(runFile, "utf8"));
    for (const [key, rows] of Object.entries(wanted)) {
      runChecked += 1;
      const reason = runDifference(expected[key], rows);
      if (reason) failures.push(`runs/${key}: ${reason}`);
    }
    if (!family) {
      for (const key of Object.keys(expected)) {
        if (!(key in wanted)) failures.push(`runs/${key}: stale frame (no longer generated)`);
      }
    }
  }

  if (update) return { checked, runChecked, failures, updated: true };
  return { checked, runChecked, failures, updated: false };
}

/** The files in test/golden that no longer belong to a family. */
export function extraGoldenFiles() {
  if (!existsSync(DIR)) return [];
  const types = new Set(Object.keys(SAMPLES));
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".json") && name !== VARIANTS_FILE && name !== RUNS_FILE && !types.has(name.slice(0, -5)))
    .map((name) => join(DIR, name));
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const familyAt = args.indexOf("--family");
  const family = familyAt >= 0 ? args[familyAt + 1] : null;
  const result = checkGoldens({ update, family });
  if (update) {
    console.log(`golden: wrote ${result.checked} text frames and ${result.runChecked} run frames for ${family ?? "all families"}`);
    return;
  }
  for (const failure of result.failures) console.error(`golden: ${failure}`);
  for (const extra of extraGoldenFiles()) console.error(`golden: stale file ${extra}`);
  const runFailures = result.failures.filter((failure) => failure.startsWith("runs/")).length;
  const textFailures = result.failures.length - runFailures;
  console.log(`golden: ${Math.max(0, result.checked - textFailures)}/${result.checked} text frames match`);
  console.log(`golden: ${Math.max(0, result.runChecked - runFailures)}/${result.runChecked} run frames match`);
  if (result.failures.length > 0 || extraGoldenFiles().length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
