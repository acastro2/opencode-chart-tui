// Analytical fidelity checks.
//
// The audit proves the frame cannot overflow. These checks prove the picture
// says what the data says, using an independent reference for the families where
// one is stable. A reference here must not call the family's own layout code:
// that would only prove the renderer agrees with itself.
//
// Families whose geometry is harder to reference analytically are covered by
// `npm run audit` (bounds, accounting, determinism) and `npm run golden` (the
// exact picture). The split is deliberate: a weak reference is worse than none.

import { SAMPLES } from "./samples.mjs";
import { renderChartRows } from "../src/chart.js";
import { displayWidth } from "../src/text.js";

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    const detail = fn();
    passed += 1;
    console.log(`ok ${name}${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function textOf(rows) {
  return rows.map((row) => row.runs.map((run) => run.text).join("")).join("\n");
}

function cellArea(rows, kinds, sliceMin = 0) {
  let area = 0;
  for (const row of rows) {
    for (const run of row.runs) {
      if (!kinds.has(run.kind)) continue;
      if ((run.slice ?? -1) < sliceMin) continue;
      area += displayWidth(run.text);
    }
  }
  return area;
}

// Pie: area against the analytic ellipse the layout is allowed to use. The
// label cells sit inside the wedge, so they count as occupied area.
for (const width of [44, 56, 80]) {
  check(`pie area at ${width}`, () => {
    const height = 22;
    const margin = 1;
    const rows = renderChartRows({ type: "pie", width, height, margin, legend: false, values: [62, 28, 10] });
    const radiusX = Math.max(2, Math.min((width - 2 * margin) / 2, height - 2));
    const radiusY = radiusX / 2;
    const ideal = Math.PI * radiusX * radiusY;
    const drawn = cellArea(rows, new Set(["fill", "label"]));
    const error = Math.abs(drawn - ideal) / ideal;
    assert(error <= 0.015, `${drawn.toFixed(1)} cells vs ${ideal.toFixed(1)} (${(error * 100).toFixed(2)}%)`);
    return `${drawn.toFixed(1)}/${ideal.toFixed(1)} cells, ${(error * 100).toFixed(2)}% off`;
  });
}

// Gauge and progress: the filled fraction against the value / max.
for (const type of ["gauge", "progress"]) {
  check(`${type} fill fraction`, () => {
    const value = 62;
    const max = 100;
    const rows = renderChartRows({ type, width: 40, label: "Coverage", value, max, showPercent: false });
    const filled = cellArea(rows, new Set(["fill"]), -1);
    const track = cellArea(rows, new Set(["track"]), -1);
    const total = filled + track;
    assert(total > 0, "no bar found");
    const ratio = filled / total;
    assert(Math.abs(ratio - value / max) <= 0.04, `filled ${filled}/${total} = ${ratio.toFixed(2)}`);
    return `${filled}/${total} = ${ratio.toFixed(2)}`;
  });
}

check("heatmap cell count", () => {
  const rows = renderChartRows({
    type: "heatmap",
    width: 40,
    headers: ["a", "b", "c"],
    rows: [
      { label: "r1", values: [1, 2, 3] },
      { label: "r2", values: [4, 5, 6] },
    ],
  });
  let cells = 0;
  for (const row of rows) for (const run of row.runs) if (run.kind === "label" && run.slice === -1) cells += 1;
  assert(cells === 6, `drew ${cells} cells for 2 rows of 3`);
  return `${cells} cells`;
});

check("table keeps every row", () => {
  const rows = renderChartRows({
    type: "table",
    width: 40,
    columns: ["Account", { label: "ARR", type: "number" }],
    rows: [["Globex", 4200], ["Initech", 3100], ["Umbrella", 2900]],
  });
  const text = textOf(rows);
  for (const word of ["Globex", "Initech", "Umbrella"]) assert(text.includes(word), `missing ${word}`);
  return "3/3 accounts";
});

check("treemap keeps the small value", () => {
  const text = textOf(renderChartRows({ ...SAMPLES.treemap, type: "treemap" }));
  assert(text.includes("Web"), "missing Web label");
  assert(text.includes("12"), "missing Web value");
  return "Web 12";
});

check("line keeps the last label", () => {
  const text = textOf(
    renderChartRows({
      type: "line",
      width: 40,
      labels: ["Jan", "Feb", "Mar", "Apr", "May"],
      values: [12, 18, 15, 22, 26],
    }),
  );
  assert(text.includes("May"), "last label was dropped");
  return "May";
});

check("sankey cycle is drawn and named", () => {
  const rows = renderChartRows({
    type: "sankey",
    width: 40,
    height: 10,
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    links: [{ from: "a", to: "b", value: 1 }, { from: "b", to: "a", value: 1 }],
  });
  const text = textOf(rows);
  assert(text.includes("cycle"), "cycle note missing");
  assert(rows.length <= 10, `rendered ${rows.length} rows`);
  return "cycle noted";
});

check("ohlc draws ticks, not a filled candle", () => {
  const rows = renderChartRows({ ...SAMPLES.ohlc, type: "ohlc" });
  const text = textOf(rows);
  assert(text.includes("┤") && text.includes("├"), "open/close ticks missing");
  assert(rows.length <= 10, `rendered ${rows.length} rows`);
  return "ticks present";
});

/** Area for one slice, so a two-series family can be checked one series at a time. */
function sliceArea(rows, slice, kinds = new Set(["fill"])) {
  let area = 0;
  for (const row of rows) {
    for (const run of row.runs) {
      if (!kinds.has(run.kind) || run.slice !== slice) continue;
      area += displayWidth(run.text);
    }
  }
  return area;
}

check("bar height follows value", () => {
  const width = 40;
  const rows = renderChartRows({ type: "bar", width, height: 10, labels: ["A", "B"], values: [50, 100], legend: false });
  const heights = Array(width).fill(0);
  for (const row of rows) {
    let x = 0;
    for (const run of row.runs) {
      const cells = displayWidth(run.text);
      if (run.kind === "fill" && run.slice === 0) {
        for (let offset = 0; offset < cells && x + offset < width; offset++) heights[x + offset] += 1;
      }
      x += cells;
    }
  }
  const half = Math.max(...heights.slice(0, Math.floor(width / 2)));
  const full = Math.max(...heights.slice(Math.floor(width / 2)));
  assert(full > half, `right bar ${full} is not taller than left ${half}`);
  return `${half} -> ${full} cells`;
});

check("column is the bar alias", () => {
  const spec = { width: 40, height: 8, labels: ["A", "B"], values: [1, 2], legend: false };
  const bar = textOf(renderChartRows({ ...spec, type: "bar" }));
  const column = textOf(renderChartRows({ ...spec, type: "column" }));
  assert(bar === column, "bar and column differ");
  return "identical";
});

check("hbar ranks the larger value first", () => {
  const rows = renderChartRows({ type: "hbar", width: 40, labels: ["Small", "Big"], values: [10, 30], legend: false });
  const fillIn = (label) => {
    const row = rows.find((item) => textOf([item]).includes(label));
    return row ? sliceArea([row], 0) : 0;
  };
  const small = fillIn("Small");
  const big = fillIn("Big");
  assert(big > small, `Big ${big} is not longer than Small ${small}`);
  return `${small} -> ${big} cells`;
});

check("histogram reports its bins", () => {
  const text = textOf(renderChartRows({ type: "histogram", width: 40, values: [1, 1, 1, 2, 2, 3], bins: 2 }));
  assert(text.includes("6 values"), "sample count missing");
  assert(text.includes("2 bins"), "bin count missing");
  return "6 values, 2 bins";
});

check("candle draws both directions", () => {
  const rows = renderChartRows({
    type: "candle",
    width: 40,
    height: 10,
    labels: ["Up", "Down"],
    values: [[10, 12, 9, 11], [12, 12, 10, 11]],
  });
  assert(sliceArea(rows, 0) > 0, "no up candle");
  assert(sliceArea(rows, 1) > 0, "no down candle");
  return `${sliceArea(rows, 0)}+${sliceArea(rows, 1)} cells`;
});

check("candlestick draws both directions", () => {
  const rows = renderChartRows({
    type: "candlestick",
    width: 40,
    height: 10,
    labels: ["Up", "Down"],
    values: [[10, 12, 9, 11], [12, 12, 10, 11]],
  });
  assert(sliceArea(rows, 0) > 0, "no up candle");
  assert(sliceArea(rows, 1) > 0, "no down candle");
  return `${sliceArea(rows, 0)}+${sliceArea(rows, 1)} cells`;
});

check("area fills below the line", () => {
  const spec = { width: 40, height: 10, labels: ["A", "B", "C"], values: [1, 3, 2] };
  const line = renderChartRows({ ...spec, type: "line" });
  const area = renderChartRows({ ...spec, type: "area" });
  const lineCells = sliceArea(line, 0);
  const areaCells = sliceArea(area, 0);
  assert(areaCells > lineCells, `area ${areaCells} is not larger than line ${lineCells}`);
  return `${lineCells} -> ${areaCells} cells`;
});

check("sparkline downsamples into the width", () => {
  const rows = renderChartRows({
    type: "sparkline",
    width: 16,
    values: Array.from({ length: 50 }, (_, index) => Math.sin(index / 5) * 10 + 10),
  });
  const text = textOf(rows);
  const blocks = [...text].filter((char) => "▁▂▃▄▅▆▇█".includes(char)).length;
  assert(blocks <= 16, `${blocks} blocks at width 16`);
  for (const row of rows) assert(displayWidth(textOf([row])) <= row.width, `row is ${displayWidth(textOf([row]))} cells`);
  return `${blocks} blocks`;
});

check("scatter keeps both points and their labels", () => {
  const rows = renderChartRows({ type: "scatter", width: 40, height: 10, points: [[0, 0], [10, 10]] });
  const text = textOf(rows);
  assert(text.includes("0") && text.includes("10"), "x labels missing");
  assert(sliceArea(rows, 0) > 0, "no point drawn");
  return "2 points";
});

check("radar keeps both series", () => {
  const rows = renderChartRows({ ...SAMPLES.radar, type: "radar", width: 56, height: 20 });
  const text = textOf(rows);
  assert(text.includes("Now") && text.includes("Target"), "series names missing");
  return "Now + Target";
});

check("waterfall keeps its labels", () => {
  const rows = renderChartRows({ ...SAMPLES.waterfall, type: "waterfall", width: 56, height: 10 });
  const text = textOf(rows);
  for (const label of ["Start", "New", "Churn", "Total"]) assert(text.includes(label), `missing ${label}`);
  if (!text.includes("Expansion")) assert(/label|thinn|hidden|omit/i.test(text), "Expansion dropped without a note");
  assert(sliceArea(rows, 0) > 0, "total bar missing");
  return "steps + total";
});

check("kanban keeps its cards", () => {
  const rows = renderChartRows({ ...SAMPLES.kanban, type: "kanban", width: 56, height: 12 });
  const text = textOf(rows);
  for (const word of ["Ship the sankey", "Radar labels", "Waterfall", "Table"]) {
    assert(text.includes(word), `missing ${word}`);
  }
  assert(rows.length <= 12, `rendered ${rows.length} rows`);
  return "4/4 cards";
});

check("gantt length follows duration", () => {
  const rows = renderChartRows({ ...SAMPLES.gantt, type: "gantt", width: 56, height: 11 });
  const fillIn = (label) => {
    const row = rows.find((item) => textOf([item]).includes(label));
    return row ? sliceArea([row], -1) : 0;
  };
  const design = fillIn("Design");
  const build = fillIn("Build");
  assert(build > design, `Build ${build} is not longer than Design ${design}`);
  return `${design} -> ${build} cells`;
});

check("donut is a pie with a hole", () => {
  const spec = { width: 56, height: 22, values: [62, 28, 10], legend: false };
  const pie = renderChartRows({ ...spec, type: "pie" });
  const donut = renderChartRows({ ...spec, type: "donut" });
  const pieCells = cellArea(pie, new Set(["fill", "label"]));
  const donutCells = cellArea(donut, new Set(["fill", "label"]));
  assert(donutCells < pieCells * 0.95, `donut ${donutCells} vs pie ${pieCells}`);
  return `${donutCells} < ${pieCells}`;
});

check("all families stay inside width, height and determinism", () => {
  for (const [type, sample] of Object.entries(SAMPLES)) {
    const spec = { ...sample, type, width: 56, height: 10 };
    const first = renderChartRows(spec);
    const second = renderChartRows(spec);
    assert(JSON.stringify(first) === JSON.stringify(second), `${type} is not deterministic`);
    assert(first.length <= 10, `${type} rendered ${first.length} rows at height 10`);
    for (const row of first) {
      const width = displayWidth(row.runs.map((run) => run.text).join(""));
      assert(width <= row.width, `${type} row is ${width} cells, declares ${row.width}`);
    }
  }
  return `${Object.keys(SAMPLES).length} families`;
});

console.log(`fidelity: ${passed}/${passed + failures.length} checks passed`);
if (failures.length > 0) process.exitCode = 1;
