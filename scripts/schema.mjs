#!/usr/bin/env node
// The fence contract, checked against the code instead of trusted.
//
// Two things drift apart as families are added: the `type` enum, which must name
// every family the dispatcher knows, and the key list, which is the schema's
// promise about what a fence may say. A key the schema documents that nothing
// reads is a lie in the docs; a key the code reads that the schema omits is a
// gap a reader cannot discover.
//
//   node scripts/schema.mjs --check      # exits 1 on any drift
//
// test/schema.test.js calls checkContract() directly, so the gate also runs with
// `npm test` even though package.json has no schema:check script.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHART_TYPES } from "../src/chart.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, "..", "schema", "chart.schema.json");
const SRC = join(HERE, "..", "src");

/**
 * Keys a family reads that are deliberately not properties: `markers` is only
 * read by the plain-text pie wrapper, never on the fence path.
 */
export const INTERNAL_KEYS = Object.freeze(["markers"]);

/**
 * Every `spec.<key>` a source file reads. This is what makes the check a check
 * of the code, not a comparison of two hand-written lists: a family that starts
 * reading a new key fails until the schema documents it.
 */
export function readSpecKeys(dir = SRC) {
  const keys = new Set();
  const files = [
    ...readdirSync(dir).filter((name) => name.endsWith(".js")).map((name) => join(dir, name)),
    // The plugin half reads the fence too: `themeFor` takes boundaryColor and the
    // renderable injects width, theme and cellAspect.
    join(HERE, "..", "tui.js"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bspec\??\.([A-Za-z_$][\w$]*)/g)) keys.add(match[1]);
  }
  return [...keys].sort();
}

// Keys that are front matter: they sit above the data and mean the same thing in
// every family. `type` is the one the renderer dispatches on.
export const FRONT_MATTER_KEYS = Object.freeze([
  "type",
  "title",
  "width",
  "height",
  "plotHeight",
  "theme",
  "palette",
  "mosaic",
  "legend",
  "valueLabels",
  "note",
  "max",
  "zero",
]);

// Every other key a family reads, in schema order. Together with the front
// matter this is the allow-list: a property outside it is a key no renderer
// reads, and a key outside the schema is one a reader cannot find.
export const FAMILY_KEYS = Object.freeze([
  "cellAspect",
  "labels",
  "name",
  "values",
  "series",
  "slices",
  "points",
  "stacked",
  "normalized",
  "showPercent",
  "boundaryColor",
  "ticks",
  "textured",
  "bins",
  "data",
  "dates",
  "targets",
  "ranges",
  "start",
  "total",
  "totalLabel",
  "totalColor",
  "up",
  "down",
  "candles",
  "headers",
  "rows",
  "cellWidth",
  "low",
  "high",
  "from",
  "to",
  "min",
  "scale",
  "columns",
  "rules",
  "items",
  "children",
  "nodes",
  "links",
  "cards",
  "order",
  "columnWidth",
  "titleLines",
  "metaLines",
  "filled",
  "axes",
  "spokes",
  "target",
  "track",
  "sort",
  "slotLabels",
  "horizontal",
  "big",
  "donut",
  "margin",
  "glyphs",
  "plainLegend",
  "value",
  "label",
  "tasks",
  "today",
  "todayColor",
]);

/** Every key the schema may document. */
export const DOCUMENTED_KEYS = Object.freeze([...FRONT_MATTER_KEYS, ...FAMILY_KEYS]);

// Old names that still draw. They are named in the canonical key's description,
// never given a property of their own, because a property claims a shape the
// renderer does not honour.
export const RENAMED_KEYS = Object.freeze({
  percent: "showPercent",
  gap: "boundaryColor",
});

// Properties that are an alias for another property, with the canonical key.
export const ALIAS_KEYS = Object.freeze({
  from: "low",
  to: "high",
  axes: "labels",
  children: "items",
  data: "values",
});

/** The schema as written, so a caller can change a copy and ask what breaks. */
export function readSchema(path = SCHEMA) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The names in `wanted` that `found` does not hold. */
function missingFrom(wanted, found) {
  const have = new Set(found);
  return wanted.filter((name) => !have.has(name));
}

/** `a` is every family and the enum names exactly those. */
function typeProblems(schema, types) {
  const enumValues = schema?.properties?.type?.enum;
  if (!Array.isArray(enumValues)) return ["the schema has no type enum"];

  const problems = [];
  for (const type of missingFrom(types, enumValues)) {
    problems.push(`type enum is missing "${type}"`);
  }
  const known = new Set(types);
  for (const type of enumValues) {
    if (!known.has(type)) problems.push(`type enum has "${type}", which is not a chart family`);
  }
  return problems;
}

/** Every documented key is in the allow-list, and the allow-list is in the schema. */
function keyProblems(schema) {
  const problems = [];
  const properties = Object.keys(schema?.properties ?? {});
  const allowed = new Set(DOCUMENTED_KEYS);
  const seen = new Set();

  for (const key of DOCUMENTED_KEYS) {
    if (seen.has(key)) problems.push(`"${key}" is in the allow-list twice`);
    seen.add(key);
  }
  for (const key of properties) {
    if (!allowed.has(key)) problems.push(`the schema documents "${key}", which is not in the fence allow-list`);
  }
  for (const key of missingFrom(DOCUMENTED_KEYS, properties)) {
    problems.push(`the allow-list names "${key}", which the schema does not document`);
  }
  return problems;
}

/** An alias property names its canonical key; a renamed key is named by its replacement. */
function aliasProblems(schema) {
  const properties = schema?.properties ?? {};
  const problems = [];

  for (const [alias, canonical] of Object.entries(ALIAS_KEYS)) {
    if (!properties[alias]) {
      problems.push(`alias "${alias}" is not in the schema`);
      continue;
    }
    if (!properties[canonical]) problems.push(`alias "${alias}" points at "${canonical}", which is not in the schema`);
    const description = String(properties[alias]?.description ?? "");
    if (!new RegExp(`\\balias for ${canonical}\\b`).test(description)) {
      problems.push(`alias "${alias}" does not name "${canonical}" as its canonical key`);
    }
  }

  for (const [old, canonical] of Object.entries(RENAMED_KEYS)) {
    const description = String(properties[canonical]?.description ?? "");
    if (!description.includes(old)) problems.push(`the old key "${old}" is not named in "${canonical}"`);
  }
  return problems;
}

/** Every key the code reads is documented, and every documented key is read. */
function sourceProblems(schema, readKeys) {
  const properties = schema?.properties ?? {};
  const documented = new Set(Object.keys(properties));
  const renamed = new Set(Object.keys(RENAMED_KEYS));
  const internal = new Set(INTERNAL_KEYS);
  const problems = [];

  for (const key of readKeys) {
    if (documented.has(key) || renamed.has(key) || internal.has(key)) continue;
    problems.push(`the code reads "${key}", which the schema does not document`);
  }
  const read = new Set(readKeys);
  for (const key of documented) {
    if (!read.has(key)) problems.push(`the schema documents "${key}", which no family reads`);
  }
  return problems;
}

/**
 * Every way the schema and the code disagree, as plain sentences. An empty list
 * is the contract holding. `schema`, `types` and `readKeys` can be replaced so a
 * test can prove a broken copy is caught instead of only checking that the real
 * one is not.
 */
export function contractProblems(
  schema = readSchema(),
  types = Object.keys(CHART_TYPES),
  readKeys = readSpecKeys(),
) {
  return [
    ...typeProblems(schema, types),
    ...keyProblems(schema),
    ...aliasProblems(schema),
    ...sourceProblems(schema, readKeys),
  ];
}

/** The check, with everything it looked at, for a caller that wants counts. */
export function checkContract(options = {}) {
  const schema = options.schema ?? readSchema(options.path);
  const types = options.types ?? Object.keys(CHART_TYPES);
  return {
    problems: contractProblems(schema, types),
    types: types.length,
    keys: Object.keys(schema?.properties ?? {}).length,
  };
}

function main() {
  if (!process.argv.slice(2).includes("--check")) {
    console.log("usage: node scripts/schema.mjs --check");
    return;
  }

  const { problems, types, keys } = checkContract();
  for (const problem of problems) console.error(`schema: ${problem}`);
  const verdict = problems.length === 0 ? "no drift" : `${problems.length} problems`;
  console.log(`schema: ${types} types, ${keys} keys, ${verdict}`);
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
