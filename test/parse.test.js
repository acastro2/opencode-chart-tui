// The reader: a fence written by hand (or by a model) is not strict JSON, and a
// chart that fails to parse must say why instead of showing nothing.

import assert from "node:assert/strict";
import { parseChart, readableJson, renderChart, renderChartRows } from "../src/chart.js";
import { runsText } from "../src/core.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};
const textRows = (rows) => rows.map((row) => runsText(row.runs));

check("comments and trailing commas are allowed", () => {
  const source = `{
    // a bar of monthly bookings
    "type": "bar",
    "labels": ["Jul", "Aug"],
    "values": [118, 132,],
  }`;
  const { spec, error } = parseChart(source);
  assert.equal(error, null);
  assert.equal(spec.type, "bar");
  assert.deepEqual(spec.values, [118, 132]);
});

check("a block comment and a comment inside a string both survive", () => {
  const source = '{ "type": "bar", "title": "a // b /* c */", /* drop */ "values": [1, 2] }';
  const { spec, error } = parseChart(source);
  assert.equal(error, null);
  assert.equal(spec.title, "a // b /* c */");
  // A trailing comma before a closing bracket goes, a comment becomes a space,
  // and the text inside a string is left exactly as it was.
  assert.equal(
    readableJson('{ "a": [1, 2,], /* x */ "b": 3 }').replace(/\s+/g, " ").trim(),
    '{ "a": [1, 2], "b": 3 }',
  );
});

check("a bad body comes back as a reason, not a stack", () => {
  const { spec, error } = parseChart('{\n  "type": "bar",\n  "values": [1, 2\n}');
  assert.equal(spec, null);
  assert.ok(/line \d+/.test(error), `the reason names the line (${error})`);
  assert.ok(!/at JSON.parse|node:internal/.test(error), "no stack in the message");
});

check("an empty body and a non-object body are refused", () => {
  assert.match(parseChart("   ").error, /empty/);
  assert.match(parseChart("[1, 2]").error, /object/);
});

check("values that are not numbers are reported under the chart", () => {
  const rows = textRows(renderChartRows({ type: "bar", width: 40, values: [1, "n/a", 3] }));
  const last = rows[rows.length - 1];
  assert.ok(last.includes("1 non-numeric value treated as 0"), last);
});

check("renamed keys say so", () => {
  const percent = textRows(renderChartRows({ type: "gauge", width: 40, value: 50, max: 100, percent: false }));
  assert.ok(percent.some((row) => row.includes("percent is now showPercent")), percent.join(" | "));
  const gap = textRows(renderChartRows({ type: "pie", width: 40, slices: [["a", 2], ["b", 1]], gap: "#000000" }));
  assert.ok(gap.some((row) => row.includes("boundaryColor")), gap.join(" | "));
  const heat = textRows(renderChartRows({ type: "heatmap", width: 40, columns: ["a"], rows: [{ label: "r", values: [1] }] }));
  assert.ok(heat.some((row) => row.includes("headers")), heat.join(" | "));
});

check("a guessed type says which one it read", () => {
  const rows = textRows(renderChartRows({ width: 40, values: [1, 2, 3] }));
  assert.ok(rows.some((row) => row.includes("no type, read as bar")), rows.join(" | "));
});

check("a clean fence gets no footer", () => {
  // renderChart is the plain-text path, so this also proves the footer would
  // show up there too.
  const rows = renderChart({ type: "bar", width: 40, labels: ["a", "b"], values: [1, 2] }).split("\n");
  assert.ok(
    !rows.some((row) => row.includes("non-numeric") || row.includes(" now ") || row.includes("no type")),
    "no notes for a clean spec",
  );
});

check("an unknown type names itself instead of drawing nothing", () => {
  const rows = textRows(renderChartRows({ type: "donut-hole", width: 40, values: [1] }));
  assert.ok(rows[0].includes('unknown chart type "donut-hole"'), rows[0]);
});

check("the plain-text path takes a fence body as a string", () => {
  // The plugin parses the fence and the tests hand over objects; both must land
  // on the same picture, and a broken body must say why in plain text too.
  const body = `{\n  // a comment and a trailing comma survive\n  "type": "bar",\n  "values": [1, 2, 3],\n}`;
  const fromText = renderChart(body);
  const fromObject = renderChart(parseChart(body).spec);
  assert.equal(fromText, fromObject, "a string body and its parsed spec draw the same chart");
  assert.ok(fromText.includes("█"), "and it drew something");
  assert.match(renderChart("{ nope }"), /chart: /, "a broken body reports the reason");
  assert.match(renderChart(""), /chart: empty fence body/);
});

console.log(`\n${checks}/${checks} checks passed`);
