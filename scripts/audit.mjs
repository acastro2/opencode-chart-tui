#!/usr/bin/env node
// Render the audit corpus and check the invariants that the visual tests cannot
// see. This is a gate, not a gallery: it fails on a thrown renderer, a row wider
// than its declared width, a non-deterministic frame, or a missing note.
//
//   npm run audit            # one line per failure, summary
//   npm run audit -- --verbose
//
// The corpus is JSON so a defect found in the wild can become a case without
// touching the runner.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderChartRows } from "../src/chart.js";
import { runsText } from "../src/core.js";
import { displayWidth } from "../src/text.js";
import { SAMPLES } from "./samples.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = join(ROOT, "test/fixtures/audit/cases.json");
const verbose = process.argv.includes("--verbose");

/** A compact, readable version of one row for a failure report. */
function describeRow(row, index, declared) {
  const text = runsText(row.runs ?? []);
  return `row ${index}: ${displayWidth(text)} cells, declared ${row.width ?? "?"}, spec ${declared}\n    ${JSON.stringify(text)}`;
}

/** Every row has a width, every run has text, and none is wider than it claims. */
function checkRows(name, rows, specWidth) {
  const failures = [];
  const limit = Math.max(16, Number(specWidth) || 48);

  if (!Array.isArray(rows) || rows.length === 0) {
    failures.push("renderer returned no rows");
    return failures;
  }

  for (const [index, row] of rows.entries()) {
    if (!row || !Array.isArray(row.runs)) {
      failures.push(`row ${index} has no runs`);
      continue;
    }
    if (!Number.isInteger(row.width) || row.width <= 0) {
      failures.push(`row ${index} has an invalid width ${row.width}`);
      continue;
    }
    if (row.width > limit) failures.push(`row ${index} declares ${row.width} > spec ${limit}`);
    const text = runsText(row.runs);
    const actual = displayWidth(text);
    if (actual > row.width) failures.push(`row ${index} is ${actual} cells but declares ${row.width}`);
    if (actual > limit) failures.push(`row ${index} is ${actual} cells > spec ${limit}`);
    if (text.includes("\n") || text.includes("\r")) failures.push(`row ${index} contains a newline`);
    if (row.runs.some((run) => typeof run?.text !== "string")) {
      failures.push(`row ${index} has a run without text`);
    }
  }

  return failures;
}

function main() {
  const corpus = JSON.parse(readFileSync(CASES, "utf8"));
  // `height` is a total-row contract. Generate the case for every family from
  // the canonical samples, so a new family cannot opt out by forgetting a
  // fixture.
  const heightCases = Object.entries(SAMPLES).map(([type, sample]) => ({
    name: `height-10-${type}`,
    spec: { ...sample, type, width: 56, height: 10 },
  }));
  const cases = [...corpus, ...heightCases];
  let passed = 0;
  const failures = [];

  for (const testCase of cases) {
    const name = testCase.name ?? "unnamed";
    let rows;
    try {
      rows = renderChartRows(testCase.spec);
    } catch (error) {
      failures.push({ name, reasons: [`threw: ${error?.stack ?? error}`], rows: [] });
      continue;
    }

    const reasons = checkRows(name, rows, testCase.spec?.width);

    const declaredHeight = Number(testCase.spec?.height);
    if (Number.isFinite(declaredHeight) && declaredHeight > 0) {
      const limit = Math.max(1, Math.floor(declaredHeight));
      if (rows.length > limit) reasons.push(`height ${limit}: ${rows.length} rows`);
    }

    // A chart that renders differently on the second call is not reproducible.
    try {
      const again = renderChartRows(testCase.spec);
      if (JSON.stringify(rows) !== JSON.stringify(again)) reasons.push("second render differs");
    } catch (error) {
      reasons.push(`second render threw: ${error?.message ?? error}`);
    }

    const all = rows.map((row) => runsText(row.runs ?? [])).join("\n");
    if (testCase.expectText && !new RegExp(testCase.expectText, "i").test(all)) {
      reasons.push(`missing text /${testCase.expectText}/`);
    }
    if (testCase.expectNote && !new RegExp(testCase.expectNote, "i").test(all)) {
      reasons.push(`missing note /${testCase.expectNote}/`);
    }

    if (reasons.length === 0) passed += 1;
    else failures.push({ name, reasons, rows });
  }

  for (const failure of failures) {
    console.log(`FAIL ${failure.name}`);
    for (const reason of failure.reasons) console.log(`  ${reason}`);
    if (verbose) {
      for (const [index, row] of failure.rows.entries()) {
        console.log(`  ${describeRow(row, index, "?")}`);
      }
    }
  }

  console.log(`\nchart audit: ${passed}/${cases.length} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

main();
