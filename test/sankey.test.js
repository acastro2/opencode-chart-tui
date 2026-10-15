import assert from "node:assert/strict";
import { cols, mixOklab, runsText } from "../src/core.js";
import { normalizeSankey, renderSankeyRows, sankeyLayout } from "../src/sankey.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];
const total = (row) => row.runs.reduce((sum, run) => sum + cols(run.text), 0);
const BASELINE = "#101010";

/** Block glyphs, box drawing and the two mosaic ranges: everything a band may use. */
const isCanvas = (cell) => {
  const point = cell.codePointAt(0) ?? 0;
  return (
    (point >= 0x2580 && point <= 0x259f) || // block elements
    (point >= 0x1fb00 && point <= 0x1fbff) || // legacy computing: sextants, quarter blocks
    (point >= 0x1cc00 && point <= 0x1cebf) || // legacy computing supplement: octants
    "│─┌┐└┘├┤┬┴┼╭╮╰╯●".includes(cell)
  );
};

const spec = () => ({
  width: 60,
  height: 16,
  nodes: [
    { id: "src", label: "Sources" },
    { id: "a", label: "Search" },
    { id: "b", label: "Social" },
    { id: "c", label: "Email" },
    { id: "d", label: "Signup" },
    { id: "e", label: "Trial" },
  ],
  links: [
    { from: "src", to: "a", value: 30 },
    { from: "src", to: "b", value: 20 },
    { from: "src", to: "c", value: 10 },
    { from: "a", to: "d", value: 18 },
    { from: "a", to: "e", value: 12 },
    { from: "b", to: "d", value: 20 },
    { from: "c", to: "e", value: 10 },
  ],
});

check("columns come from the links", () => {
  const { nodes } = normalizeSankey(spec());
  const column = (id) => nodes.find((node) => node.id === id).column;
  assert.equal(column("src"), 0);
  assert.equal(column("a"), 1);
  assert.equal(column("d"), 2);
  // A node that only appears in a link is created from it, one column to the right.
  const chain = normalizeSankey({ links: [{ from: "x", to: "y", value: 5 }, { from: "y", to: "z", value: 5 }] });
  assert.deepEqual(chain.nodes.map((node) => [node.id, node.column]), [["x", 0], ["y", 1], ["z", 2]]);
  // A declared column is fixed, even when a link points further right.
  const fixed = normalizeSankey({ nodes: [{ id: "late", column: 3 }], links: [{ from: "a", to: "late", value: 1 }] });
  assert.equal(fixed.nodes.find((node) => node.id === "late").column, 3);
});

check("a node's height follows its flow", () => {
  const { nodes, links } = normalizeSankey(spec());
  sankeyLayout(nodes, links, 60, 16);
  const height = (id) => nodes.find((node) => node.id === id).height;
  assert.ok(height("a") > height("c"), `Search ${height("a")} is taller than Email ${height("c")}`);
  assert.ok(height("d") > height("e"), `Signup ${height("d")} is taller than Trial ${height("e")}`);
  assert.equal(height("src"), 14, "the whole flow fills the drawn height");
});

check("a band never leaves the bar it belongs to", () => {
  // The bug this check exists for: slots were mapped with the shared scale while
  // heights are whole cells, so a band drifted off its own bar (16.33 on a bar
  // that ended at 16) and left a hole beside its neighbour.
  const { nodes, links } = normalizeSankey(spec());
  sankeyLayout(nodes, links, 60, 16);
  for (const link of links) {
    if (link.from === link.to) continue;
    assert.ok(link.sourceTop >= link.source.top - 0.005, `${link.from} starts inside its bar`);
    assert.ok(link.sourceBottom <= link.source.top + link.source.height + 0.005, `${link.from} ends inside its bar`);
    assert.ok(link.targetTop >= link.target.top - 0.005, `${link.to} starts inside its bar`);
    assert.ok(link.targetBottom <= link.target.top + link.target.height + 0.005, `${link.to} ends inside its bar`);
  }
});

check("the bands of a node tile its bar exactly", () => {
  const { nodes, links } = normalizeSankey(spec());
  sankeyLayout(nodes, links, 60, 16);
  const search = nodes.find((node) => node.id === "a");
  const bands = links.filter((link) => link.from === "a").sort((a, b) => a.sourceTop - b.sourceTop);
  assert.equal(bands.length, 2);
  const filled = bands.reduce((sum, link) => sum + (link.sourceBottom - link.sourceTop), 0);
  assert.ok(Math.abs(filled - search.height) < 0.02, `bands fill the bar (${filled} vs ${search.height})`);
  assert.ok(Math.abs(bands[0].sourceBottom - bands[1].sourceTop) < 0.005, "and meet each other");
  // The bigger flow gets the taller band.
  assert.ok(bands[0].sourceBottom - bands[0].sourceTop > bands[1].sourceBottom - bands[1].sourceTop);
});

check("a node that sends less than it takes in shows the drop-off", () => {
  // A funnel is the chart where this matters: 100 in and 30 out must leave the
  // rest of the bar empty. Stretching the 30 to the full bar hides the loss.
  const { nodes, links } = normalizeSankey({
    links: [
      { from: "in", to: "step", value: 100 },
      { from: "step", to: "out", value: 30 },
    ],
  });
  sankeyLayout(nodes, links, 60, 16);
  const step = nodes.find((node) => node.id === "step");
  const band = links.find((link) => link.from === "step");
  const height = band.sourceBottom - band.sourceTop;
  assert.ok(height > 0, "the band is drawn");
  assert.ok(
    height < step.height * 0.45,
    `the band carries its own flow, not the whole bar (${height.toFixed(1)} of ${step.height})`,
  );
  assert.ok(band.sourceBottom <= step.top + step.height + 0.005, "and stays inside its own bar");
});

check("bands take their source node's colour and bars take their own", () => {
  const rows = renderSankeyRows(spec());
  const fills = rows.flatMap((row) => row.runs).filter((run) => run.kind === "fill");
  const colours = new Set(fills.map((run) => run.color));
  const source = colours.has(mixOklab(BASELINE, "#4e9de0", 0.7));
  assert.ok(source, "a band leaving Sources carries the dimmed Sources colour");
  assert.ok(colours.has("#4e9de0"), "the Sources bar carries the full colour");
  assert.ok(colours.size >= 5, `bars and bands differ, saw ${colours.size} colours`);
});

check("labels are drawn beside their nodes", () => {
  const rows = textRows(renderSankeyRows(spec()));
  for (const label of ["Sources", "Search", "Social", "Email", "Signup", "Trial"]) {
    assert.ok(rows.some((row) => row.includes(label)), `${label} is drawn`);
  }
});

check("a band edge lands between rows", () => {
  const rows = textRows(renderSankeyRows(spec()));
  const partial = rows.flatMap(cellsOf).filter((cell) => cell !== " " && !/[0-9a-zA-Z]/.test(cell) && isCanvas(cell));
  assert.ok(partial.length > 4, `the edges are drawn at sub-cell resolution (${partial.length} cells)`);
});

check("every row is the chart width and only holds canvas or labels", () => {
  const rows = renderSankeyRows(spec());
  assert.equal(rows.length, 16, "the chart uses the height it was given");
  for (const row of rows) {
    assert.equal(row.width, 60);
    assert.ok(total(row) <= 60, `the row fits (${total(row)})`);
  }
  for (const row of textRows(rows)) {
    for (const cell of cellsOf(row)) {
      if (cell === " " || /[0-9a-zA-Z]/.test(cell)) continue;
      assert.ok(isCanvas(cell), `"${cell}" is not a block or a connector`);
    }
  }
});

check("a title is drawn, and an empty chart says so", () => {
  assert.equal(textRows(renderSankeyRows({ ...spec(), title: "Revenue flow" }))[0], "Revenue flow");
  assert.match(textRows(renderSankeyRows({ width: 40, links: [] }))[0], /no data/);
  // A self-link has no horizontal room, so on its own it cannot be drawn.
  assert.match(textRows(renderSankeyRows({ width: 40, links: [{ from: "a", to: "a", value: 5 }] }))[0], /no data/);
});

check("a narrow chart still fits its labels", () => {
  const rows = renderSankeyRows({ ...spec(), width: 30 });
  for (const row of rows) assert.ok(total(row) <= 30, `the row fits (${total(row)})`);
  assert.ok(textRows(rows).some((row) => row.includes("Sources") || row.includes("Search")), "a label survives");
});

console.log(`\n${checks}/${checks} checks passed`);
