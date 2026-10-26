import assert from "node:assert/strict";
import { DEFAULT_PALETTE, cols, mixOklab, runsText } from "../src/core.js";
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

/** Fill runs whose colour is neither a node's full palette colour nor blank:
 *  a link band is drawn dimmer than its source node. */
const bandRuns = (rows) => {
  const full = new Set(DEFAULT_PALETTE);
  return rows
    .flatMap((row) => row.runs)
    .filter(
      (run) =>
        run.kind === "fill" &&
        typeof run.color === "string" &&
        !full.has(run.color) &&
        run.text.trim() !== "",
    );
};

/** Eight nodes and seven links: the audit's `sankey-many` case. */
const many = () => ({
  width: 16,
  height: 10,
  nodes: Array.from({ length: 8 }, (_, index) => ({ id: `n${index}`, label: `N${index}` })),
  links: Array.from({ length: 7 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}`, value: 8 })),
});

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

check("a 16-wide chart draws its links and notes what it hid", () => {
  // The audit's `sankey-many` case: fixed gaps pushed the right-hand columns
  // off-grid, every label was skipped, and nothing said so.
  const rows = renderSankeyRows(many());
  for (const row of rows) {
    assert.equal(row.width, 16);
    assert.ok(total(row) <= 16, `the row fits (${total(row)})`);
  }
  const bands = bandRuns(rows);
  assert.ok(bands.length > 0, "a link band is drawn, not only bars");
  assert.equal(new Set(bands.map((run) => run.slice)).size, 7, `every link is drawn (${bands.length} runs)`);
  assert.ok(textRows(rows).some((line) => /labels? hidden/i.test(line)), "the hidden labels are counted");
});

check("links that cannot fit are counted", () => {
  // Twelve columns cannot all get a link cell at width 16, so the ones with no
  // room must be named instead of dropped in silence.
  const ids = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, label: `N${index}` }));
  const rows = renderSankeyRows({
    width: 16,
    height: 10,
    nodes: ids,
    links: ids.slice(0, 11).map((node, index) => ({ from: node.id, to: `n${index + 1}`, value: 8 })),
  });
  for (const row of rows) assert.ok(total(row) <= 16, `the row fits (${total(row)})`);
  assert.ok(textRows(rows).some((line) => /links? hidden/i.test(line)), "the undrawn links are counted");
});

check("a 56-wide chart still shows its labels", () => {
  const rows = renderSankeyRows({ ...spec(), width: 56 });
  const text = textRows(rows);
  for (const label of ["Sources", "Search", "Social", "Email", "Signup", "Trial"]) {
    assert.ok(text.some((row) => row.includes(label)), `${label} is drawn`);
  }
  assert.ok(!text.some((line) => /labels? hidden/i.test(line)), "nothing was hidden at 56");
});

check("node bars are visible blocks, not blank backgrounds", () => {
  const source = { ...spec(), width: 56, height: 12 };
  const { nodes, links } = normalizeSankey(source);
  const { barX } = sankeyLayout(nodes, links, 56, 12);
  const rows = textRows(renderSankeyRows(source));
  const x = barX(0);
  assert.ok(
    rows.some((row) => row[x] === "█"),
    `a node bar draws a solid block at x=${x}`,
  );
});

check("a cycle is named, not crashed on", () => {
  const rows = renderSankeyRows({
    width: 30,
    height: 8,
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    links: [{ from: "a", to: "b", value: 1 }, { from: "b", to: "a", value: 1 }],
  });
  assert.ok(textRows(rows).some((line) => /cycle/.test(line)), "the back edge is named");
});

check("a node without an id is named by its label, and one without either is dropped", () => {
  const { nodes } = normalizeSankey({
    nodes: [null, {}, { id: "" }, { label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", column: 1 }],
    links: [{ from: "Alpha", to: "b", value: 1 }],
  });
  assert.deepEqual(
    nodes.map((node) => [node.id, node.label]),
    [["Alpha", "Alpha"], ["b", "Beta"], ["c", "c"]],
  );
});

check("a link reads as an object, an alias, or nothing at all", () => {
  // A node that only appears in a link is created from it, in first-seen order.
  const object = normalizeSankey({ links: [{ from: "a", to: "b", value: 5 }] });
  assert.deepEqual(
    object.links.map((link) => [link.from, link.to, link.value, link.label]),
    [["a", "b", 5, null]],
  );
  assert.deepEqual(object.nodes.map((node) => [node.id, node.label]), [["a", "a"], ["b", "b"]]);

  // `source`/`target` are the aliases, and a label survives as a string.
  const alias = normalizeSankey({ links: [{ source: "s", target: "t", value: 2, label: "flow" }] });
  assert.deepEqual(
    alias.links.map((link) => [link.from, link.to, link.value, link.label]),
    [["s", "t", 2, "flow"]],
  );
  assert.deepEqual(alias.nodes.map((node) => node.id), ["s", "t"]);

  // The documented link shape is an object. A [from, to, value] pair has no
  // `from`, so it is dropped whole rather than read by position.
  const pair = normalizeSankey({ links: [["a", "b", 5]] });
  assert.deepEqual(pair.nodes, []);
  assert.deepEqual(pair.links, []);

  // A row with no ends, and a row that is not an object at all, are dropped.
  for (const raw of [null, 3, "a->b", {}, { from: "only" }, { to: "only" }]) {
    assert.deepEqual(
      normalizeSankey({ links: [raw] }),
      { nodes: [], links: [], cycles: [] },
      `${JSON.stringify(raw)} is dropped`,
    );
  }
});

check("a link value must be a positive finite number", () => {
  const read = (value) => normalizeSankey({ links: [{ from: "a", to: "b", value }] }).links;
  for (const value of [0, -3, "abc", null, undefined, Infinity, -Infinity, NaN, ""]) {
    assert.deepEqual(read(value), [], `${String(value)} is dropped`);
  }
  for (const [value, expected] of [["12", 12], [8, 8], [0.5, 0.5]]) {
    assert.equal(read(value).length, 1, `${String(value)} is read`);
    assert.equal(read(value)[0].value, expected, `${String(value)} becomes a number`);
  }
});

check("a self-link adds no adjacency and no flow", () => {
  const { nodes, links } = normalizeSankey({
    links: [
      { from: "a", to: "a", value: 5 },
      { from: "a", to: "b", value: 2 },
    ],
  });
  const a = nodes.find((node) => node.id === "a");
  assert.equal(links.length, 2, "the self-link is kept");
  assert.deepEqual(a.outgoing.map((link) => link.to), ["b"], "it is no outgoing edge");
  assert.deepEqual(a.incoming, [], "and no incoming edge");
  assert.equal(a.flow, 2, "so the flow is the edge out, without the self-link");
});

check("a duplicate link is kept, twice", () => {
  const { nodes, links } = normalizeSankey({
    links: [
      { from: "a", to: "b", value: 2 },
      { from: "a", to: "b", value: 2 },
    ],
  });
  assert.deepEqual(links.map((link) => link.index), [0, 1], "each copy keeps its own index");
  const b = nodes.find((node) => node.id === "b");
  assert.equal(b.incoming.length, 2, "both copies feed the target");
  assert.equal(b.flow, 4, "and both count towards the flow");
});

check("an explicit column is fixed, and a negative one shifts the chart", () => {
  const fixed = normalizeSankey({
    nodes: [{ id: "late", column: 3 }],
    links: [{ from: "a", to: "late", value: 1 }, { from: "late", to: "after", value: 1 }],
  });
  const column = (id) => fixed.nodes.find((node) => node.id === id).column;
  assert.equal(column("late"), 3, "the declared column wins over the layering");
  assert.equal(column("after"), 4, "and the layering starts from it");
  assert.equal(column("a"), 0, "a link into a fixed node does not pull it left");

  // A node declared left of zero moves the whole chart right, so no column can
  // leave the grid. Pinned as-is: the shift is what this check protects.
  const shifted = normalizeSankey({ nodes: [{ id: "n", column: -2 }], links: [{ from: "n", to: "m", value: 1 }] });
  assert.deepEqual(shifted.nodes.map((node) => [node.id, node.column]), [["n", 0], ["m", 2]]);
});

check("a column that is not an integer is left to the layering", () => {
  for (const column of [2.5, "2", null, true]) {
    const { nodes } = normalizeSankey({
      nodes: [{ id: "a", column }, { id: "b" }],
      links: [{ from: "a", to: "b", value: 1 }],
    });
    assert.deepEqual(
      nodes.map((node) => [node.id, node.column]),
      [["a", 0], ["b", 1]],
      `${String(column)} is not a column`,
    );
  }
});

check("a cycle is reported as a back edge, and the layering still finishes", () => {
  const { nodes, links, cycles } = normalizeSankey({
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    links: [
      { from: "a", to: "b", value: 1 },
      { from: "b", to: "c", value: 1 },
      { from: "c", to: "a", value: 1 },
    ],
  });
  assert.equal(cycles.length, 1, "one edge closes the cycle");
  assert.deepEqual([cycles[0].from, cycles[0].to], ["c", "a"]);
  assert.ok(links.includes(cycles[0]), "the cycling link is still in the link list");
  const column = (id) => nodes.find((node) => node.id === id).column;
  assert.deepEqual([column("a"), column("b"), column("c")], [0, 1, 2], "the rest of the chain is layered");
  // A self-link closes nothing: it has no edge to walk.
  assert.deepEqual(normalizeSankey({ links: [{ from: "x", to: "x", value: 1 }] }).cycles, []);
});

console.log(`\n${checks}/${checks} checks passed`);
