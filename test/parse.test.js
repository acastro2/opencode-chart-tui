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

check("a string gap is the old colour key, a numeric gap is spacing", () => {
  // `gap` names two things: the colour between two shapes, and the blank
  // columns a board puts between its columns. A string is the colour, and the
  // key must not survive the rename; a number is spacing and passes untouched.
  const columns = [
    { title: "Todo", cards: [{ title: "Ship it" }] },
    { title: "Doing", cards: [{ title: "Review" }] },
  ];
  const board = (extra) => textRows(renderChartRows({ type: "kanban", width: 60, columns, ...extra }));

  const plain = board({});
  const renamed = board({ gap: "#333" });
  assert.ok(renamed.some((row) => row.includes("boundaryColor")), "the old key is reported");
  assert.deepEqual(
    renamed.filter((row) => !row.includes("boundaryColor")),
    plain,
    "the string is renamed away, not read as spacing",
  );

  const spacing = board({ gap: 3 });
  assert.ok(!spacing.some((row) => row.includes("boundaryColor")), "a numeric gap is not a colour");
  assert.notDeepEqual(spacing, plain, "a numeric gap still spaces the columns");

  // A numeric string is spacing too: `Math.floor` reads it as its number, so it
  // must not be renamed into a colour and lost.
  const numeric = board({ gap: "2" });
  assert.ok(!numeric.some((row) => row.includes("boundaryColor")), "a numeric string is not a colour");
  assert.deepEqual(numeric, board({ gap: 2 }), "a numeric string spaces like its number");
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

check("a bad body names the line and column of the mistake", () => {
  // The colon after "a" is missing on line 2, seven characters in.
  const { error } = parseChart('{\n  "a" 1\n}');
  assert.match(error, /\(line 2, column 7\)$/, error);
});

check("a failure that names no position keeps its own message", () => {
  // V8 words some syntax errors with a position and some without; the reader
  // must pass the second kind through instead of inventing a line for it.
  const body = '{\n  "a": }';
  let raw = "";
  try {
    JSON.parse(body);
  } catch (error) {
    raw = error.message;
  }
  const { spec, error } = parseChart(body);
  assert.equal(spec, null);
  assert.ok(raw.length > 0, "the body is invalid JSON");
  if (/position \d+/.test(raw)) {
    assert.match(error, /\(line \d+, column \d+\)$/);
  } else {
    assert.ok(!error.includes("(line "), `no position invented (${error})`);
    assert.ok(raw.startsWith(error), `${error} comes from ${raw}`);
  }
});

check("the reader survives the awkward edges of a hand-written body", () => {
  // A trailing comma goes and leaves its white space behind.
  assert.equal(readableJson('{"a": [1, 2 , ] }'), '{"a": [1, 2  ] }');
  // A string that never closes, one that ends on its escape, and a comment that
  // runs to the end of the source are copied through, not thrown on.
  assert.equal(readableJson('{"a": "open'), '{"a": "open');
  assert.equal(readableJson('{"a": "open\\'), '{"a": "open\\');
  assert.equal(readableJson('{"a": 1 /* open'), '{"a": 1  ');
  assert.equal(readableJson('{"a": 1} // tail'), '{"a": 1} \n');
  // A slash that starts no comment, an escaped quote, a comma that stays.
  assert.equal(readableJson('{"a": 1/2}'), '{"a": 1/2}');
  assert.equal(readableJson('{"a": "q\\"uote", "b": 3}'), '{"a": "q\\"uote", "b": 3}');
  assert.equal(readableJson("[1,2,3]"), "[1,2,3]");
});

check("every kind of non-numeric entry is counted once", () => {
  // A [label, value] pair only counts its value. A pie has no slice for it.
  const pair = textRows(renderChartRows({ type: "pie", width: 40, slices: [["a", "x"], ["b", 1]] }));
  assert.ok(pair.some((row) => row.includes("1 non-numeric value dropped")), pair.join(" | "));

  // An object counts the numeric fields it gets wrong, but a candle reports its
  // own skipped rows, so the chart footer stays out of it and says it once.
  const fields = textRows(
    renderChartRows({ type: "candle", width: 40, candles: [{ open: 1, high: 2, low: 0, close: "x" }] }),
  );
  assert.ok(fields.some((row) => row.includes("1 candle skipped")), fields.join(" | "));
  assert.ok(!fields.some((row) => row.includes("non-numeric")), fields.join(" | "));

  // A number that is not finite is not a number the chart can draw.
  const notFinite = textRows(renderChartRows({ type: "bar", width: 40, values: [1, Number.NaN, 3] }));
  assert.ok(notFinite.some((row) => row.includes("1 non-numeric value treated as 0")), notFinite.join(" | "));

  // A list that is not a list is not a mistake the reader can count.
  const notAList = textRows(renderChartRows({ type: "bar", width: 40, values: "nope" }));
  assert.ok(!notAList.some((row) => row.includes("non-numeric")), notAList.join(" | "));
});

check("a footer with more than three rows is cut and says so", () => {
  const many = Array.from({ length: 40 }, () => "x");
  const rows = textRows(
    renderChartRows({ type: "bar", width: 20, values: many, labels: many, percent: true, gap: "#000" }),
  );
  const last = rows[rows.length - 1];
  assert.ok(last.trimEnd().endsWith("…"), `the third row is cut (${JSON.stringify(last)})`);
  assert.ok(rows.some((row) => row.includes("percent is now")), "the renamed key is still named");
});

console.log(`\n${checks}/${checks} checks passed`);
