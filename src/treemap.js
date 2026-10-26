// Treemap: area is value, and the box is filled completely.
//
// Three ideas carry the drawing:
//
// 1. Squarified layout (Bruls, Huizing, van Wijk). Areas are laid out in strips
//    along the shorter side of whatever rectangle is left, and the strip grows
//    only while the worst aspect ratio inside it improves. That is what keeps
//    cells readable instead of turning them into needles.
// 2. A cell is a rectangle of *background* colour, so the terminal grid itself
//    becomes the chart. The border takes the group colour as a foreground, the
//    interior takes a dimmed tint of it, and the label is written over the tint.
// 3. Groups colour the leaves. A leaf knows its top-level group, so nesting is
//    shown with colour rather than with a second layout pass, and the legend
//    names the groups that occur.

import {
  DEFAULT_PALETTE,
  blankGrid,
  cellsToRuns,
  contrastOn,
  drawBox,
  fillRect,
  formatNumber,
  legendRowRuns,
  mixOklab,
  stampText,
  titleRow,
  truncate,
} from "./core.js";
import { paletteOf, themeOf, THEMES } from "./theme.js";
import { plotRows as plotRowsFor } from "./layout.js";
import { coerce, policyFor } from "./values.js";

/** How far a tile's interior is mixed towards the terminal background. */
const SHADE = 0.5;
/** The border is the same colour, closer to full strength. */
const EDGE = 0.85;
/** The most of a box one band of items may take, so later items still get a row. */
const ROW_LIMIT = 0.8;

/** The shared fate of a leaf value: a blank and an unreadable one drop it. */
const TREE_POLICY = policyFor("treemap");

/** Whether a leaf is measurand: a treemap of nothing, zero or negatives is empty. */
function positive(value) {
  const { value: number } = coerce(value, TREE_POLICY);
  return number !== null && number > 0 ? number : null;
}

/** The `label` or `name` a source carries, before any fallback. */
function nameOf(source) {
  return source?.label ?? source?.name;
}

/** A label as text, or `fallback` when the source names nothing. */
function labelOr(label, fallback) {
  return String(label ?? fallback);
}

/** The raw value of a leaf, whichever shape it came in: a pair or an object. */
function rawValue(source, pair) {
  return pair ? pair[1] : source?.value;
}

/** The raw label of a leaf, whichever shape it came in: a pair or an object. */
function rawLabel(source, pair) {
  return pair ? pair[0] : nameOf(source);
}

/**
 * A leaf reduced to `{ label, value }`, or null when it cannot take area. The
 * two accepted shapes are read here: a `[label, value]` pair and an object with
 * `label` or `name` plus `value`.
 */
function readLeaf(source) {
  const pair = Array.isArray(source) ? source : null;
  const value = positive(rawValue(source, pair));
  return value === null ? null : { label: rawLabel(source, pair), value };
}

/** The label a leaf is drawn with: its own, or its position when it has none. */
function itemLabel(leaf, count) {
  return labelOr(leaf.label, `item ${count + 1}`);
}

/** The label of a top-level entry that nests. */
function groupLabel(item, index) {
  return labelOr(nameOf(item), `group ${index + 1}`);
}

/** The children worth laying out: an array, else none. An empty list is not nesting. */
function nestingOf(item) {
  const kids = item?.children;
  return Array.isArray(kids) ? kids : [];
}

/**
 * Append one leaf to `state.items`, or count it as dropped when no positive
 * value can give it area. Returns its index, or -1.
 */
function addLeaf(state, source, group) {
  const leaf = readLeaf(source);
  if (leaf === null) {
    state.dropped += 1;
    return -1;
  }
  state.items.push({ label: itemLabel(leaf, state.items.length), value: leaf.value, group });
  return state.items.length - 1;
}

/** The tree node for a leaf that is also a top-level item. */
function flatNode(items, at, index) {
  return { label: items[at].label, value: items[at].value, group: index, leaf: at, children: [] };
}

/** Add one leaf and the tree node that points at it. A dropped leaf adds nothing. */
function readFlat(state, source, index) {
  const at = addLeaf(state, source, index);
  if (at >= 0) state.tree.push(flatNode(state.items, at, index));
}

/** Add one child to a group node, unless it cannot take area. */
function addChild(state, node, kid, index) {
  const at = addLeaf(state, kid, index);
  if (at < 0) return;
  node.children.push(at);
  node.value += state.items[at].value;
}

/** A group node with its children added as leaves. Every child may be dropped. */
function groupNode(state, item, kids, index) {
  const node = { label: groupLabel(item, index), value: 0, group: index, leaf: -1, children: [] };
  for (const kid of kids) addChild(state, node, kid, index);
  return node;
}

/** One nesting entry: its children become leaves and its total becomes a node. */
function readGroup(state, item, kids, index) {
  const node = groupNode(state, item, kids, index);
  state.grouped = true;
  state.names[index] = node.label;
  if (node.children.length > 0) state.tree.push(node);
}

/** One top-level entry: nesting when it has children, a plain leaf otherwise. */
function readEntry(state, item, index) {
  const kids = nestingOf(item);
  if (kids.length === 0) readFlat(state, item, index);
  else readGroup(state, item, kids, index);
}

/** Walk a top-level list, one tree node per entry, in order. */
function readList(state, list) {
  list.forEach((item, index) => readEntry(state, item, index));
}

/** The label for the value at `index`, numbered when the spec names none. */
function valueLabel(labels, index) {
  return labels?.[index] ?? `item ${index + 1}`;
}

/** `labels` + `values`: one flat entry per value, in order. */
function readValues(state, spec) {
  valuesOf(spec).forEach((value, index) => readFlat(state, { label: valueLabel(spec.labels, index), value }, index));
}

/** `items` or `children`, whichever the spec gives. */
function listOf(spec) {
  return spec.items ?? spec.children;
}

/** `values`, when the spec has a list of them. */
function valuesOf(spec) {
  return Array.isArray(spec.values) ? spec.values : [];
}

/**
 * Read the tree out of a spec. Accepts `items: [{label, value, children?}]`,
 * `children`, `rows: [[label, value]]`, or `labels` + `values`. A leaf records
 * its top-level group so the whole map can be coloured by group.
 */
export function normalizeTree(spec) {
  // A zero, a negative or a value that is not a number cannot take area, so it
  // is left out of the map. The count travels with the tree: the footer says so
  // instead of the tile vanishing without a word.
  const state = { items: [], dropped: 0, names: [], tree: [], grouped: false };
  const list = listOf(spec);
  if (Array.isArray(list)) readList(state, list);
  else readValues(state, spec);
  return { items: state.items, names: state.names, grouped: state.grouped, tree: state.tree, dropped: state.dropped };
}

// ---------------------------------------------------------------------------
// Layout: continuous rectangles first, then whole cells.
// ---------------------------------------------------------------------------

/** The area a strip of entries covers. */
function areaOf(entries) {
  return entries.reduce((sum, entry) => sum + entry.area, 0);
}

/** Worst aspect ratio a strip of these areas has when it runs along `side`. */
function worstRatio(row, side) {
  const area = areaOf(row);
  const thickness = area / side;
  if (!(thickness > 0)) return Infinity;
  let worst = 1;
  for (const entry of row) {
    const length = entry.area / thickness;
    if (!(length > 0)) return Infinity;
    worst = Math.max(worst, thickness / length, length / thickness);
  }
  return worst;
}

/**
 * Which way a strip runs, and the two sides it must respect. Squarify lays the
 * strip along the *shorter* side of what is left: a column when the box is wider
 * than it is tall, a row when it is taller than wide. `rows` forces the other
 * choice, so a group's children read as bands of items stacked downwards, the
 * way a spreadsheet treemap shows them.
 */
function stripOf(box, rows) {
  const horizontal = rows || box.w < box.h;
  return horizontal
    ? { horizontal, side: box.w, limit: box.h }
    : { horizontal, side: box.h, limit: box.w };
}

/** A band that eats the whole box leaves no room for the items after it. */
function exceedsLimit(candidate, side, limit) {
  return (areaOf(candidate) / side) > limit * ROW_LIMIT;
}

/**
 * The strip to lay next: it grows while the worst ratio inside it improves. A
 * band stops growing once it would take most of the side it runs along, so the
 * items after it still get room. The last band is allowed to take what is left,
 * so this always makes progress: a rejected item simply starts the next band.
 */
function takeRow(remaining, strip) {
  const { side, limit } = strip;
  let row = [remaining[0]];
  let best = worstRatio(row, side);
  for (let i = 1; i < remaining.length; i += 1) {
    const candidate = [...row, remaining[i]];
    const ratio = worstRatio(candidate, side);
    if (ratio > best) break;
    if (exceedsLimit(candidate, side, limit)) break;
    row = candidate;
    best = ratio;
  }
  return row;
}

/** Paint one strip into `placed`, and return its thickness along the other side. */
function placeRow(row, box, strip, placed) {
  const { horizontal, side } = strip;
  const thickness = areaOf(row) / side;
  let cursor = horizontal ? box.x : box.y;
  for (const entry of row) {
    const length = entry.area / thickness;
    placed.push(
      horizontal
        ? { ...entry, x: cursor, y: box.y, w: length, h: thickness }
        : { ...entry, x: box.x, y: cursor, w: thickness, h: length },
    );
    cursor += length;
  }
  return thickness;
}

/** The rectangle left after a strip of `thickness` is taken off one side. */
function nextBox(box, horizontal, thickness) {
  if (horizontal) return { x: box.x, y: box.y + thickness, w: box.w, h: box.h - thickness };
  return { x: box.x + thickness, y: box.y, w: box.w - thickness, h: box.h };
}

/**
 * Whether there is still space to lay out. The space left can be narrower than
 * one cell while later items still have area to draw, so the recursion keeps the
 * fraction and the rounding decides the cells. Bailing at a whole cell is what
 * dropped the tail of a map without a trace.
 */
function canLayout(remaining, box) {
  return remaining.length > 0 && box.w > 0 && box.h > 0;
}

/** Lay strips until every area is placed. The rectangles stay fractional here. */
function layoutAreas(remaining, box, rows, placed) {
  if (!canLayout(remaining, box)) return;
  if (remaining.length === 1) {
    placed.push({ ...remaining[0], ...box });
    return;
  }
  const strip = stripOf(box, rows);
  const row = takeRow(remaining, strip);
  const thickness = placeRow(row, box, strip, placed);
  layoutAreas(remaining.slice(row.length), nextBox(box, strip.horizontal, thickness), rows, placed);
}

/** The entries that can take area, scaled to cell units, biggest first. */
function measureAreas(items, width, height) {
  const entries = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.value > 0);
  if (entries.length === 0) return [];
  const total = entries.reduce((sum, entry) => sum + entry.item.value, 0);
  const scale = (width * height) / total;
  return entries
    .map((entry) => ({ ...entry, area: entry.item.value * scale }))
    .sort((a, b) => b.area - a.area);
}

/** Whether any cell of column `x` is already taken between the two rows. */
function columnOwned(owned, x, y, y1) {
  for (let row = y; row <= y1; row += 1) if (owned[row][x]) return true;
  return false;
}

/** Whether any cell of row `y` is already taken between the two columns. */
function rowOwned(owned, y, x, x1) {
  for (let column = x; column <= x1; column += 1) if (owned[y][column]) return true;
  return false;
}

/** The first column at or right of the rectangle that has no owned cell. */
function nextFreeColumn(owned, rect) {
  let x = rect.x;
  while (x <= rect.x1 && columnOwned(owned, x, rect.y, rect.y1)) x += 1;
  return x;
}

/** The first free row at or below the rectangle, from the trimmed column in. */
function nextFreeRow(owned, rect, x) {
  let y = rect.y;
  while (y <= rect.y1 && rowOwned(owned, y, x, rect.x1)) y += 1;
  return y;
}

/**
 * Trim the left and top edges of a rounded rectangle back to the first free
 * cell. The layout grows left to right and top to bottom, so the trims take back
 * exactly what an earlier tile already claimed.
 */
function freeCorner(owned, rect) {
  const x = nextFreeColumn(owned, rect);
  return { x, y: nextFreeRow(owned, rect, x), x1: rect.x1, y1: rect.y1 };
}

/** One continuous coordinate as a whole cell inside the box. */
function clampCell(value, size) {
  return Math.max(0, Math.min(size - 1, Math.round(value)));
}

/** The last cell a continuous edge covers, never before its own start cell. */
function clampEnd(value, size, start) {
  return Math.max(start, Math.min(size - 1, Math.round(value) - 1));
}

/** The whole-cell corners of a continuous rectangle, clipped to the box. */
function cornersOf(entry, width, height) {
  const x = clampCell(entry.x, width);
  const y = clampCell(entry.y, height);
  return {
    x,
    y,
    x1: clampEnd(entry.x + entry.w, width, x),
    y1: clampEnd(entry.y + entry.h, height, y),
  };
}

/** Whether every cell of the rectangle is still free. */
function rectIsFree(owned, rect) {
  for (let row = rect.y; row <= rect.y1; row += 1) {
    for (let column = rect.x; column <= rect.x1; column += 1) {
      if (owned[row][column]) return false;
    }
  }
  return true;
}

/** Mark every cell of the rectangle as taken. */
function occupy(owned, rect) {
  for (let row = rect.y; row <= rect.y1; row += 1) {
    for (let column = rect.x; column <= rect.x1; column += 1) owned[row][column] = true;
  }
}

/**
 * Settle one rounded rectangle onto whole cells, or return null when it has no
 * free cell left. A tile only takes cells nobody owns yet, so area only ever
 * adds up and no tile is painted over its neighbour.
 */
function claimRect(entry, owned, width, height) {
  const rect = freeCorner(owned, cornersOf(entry, width, height));
  if (rect.x > rect.x1 || rect.y > rect.y1) return null;
  // The trims above are enough for a strip layout, but the promise is what
  // matters, not the assumption: a tile that still touches an owned cell is
  // left out rather than painted over its neighbour.
  if (!rectIsFree(owned, rect)) return null;
  occupy(owned, rect);
  return { item: entry.item, index: entry.index, ...rect };
}

/**
 * Round the continuous rectangles and settle them in draw order. Rounding can
 * put two neighbours on the same cell, and a tile painted over another tile lies
 * about the areas. A tile that finds no free cell is left out and reported by
 * the caller, because a silent hole is worse than a stated one.
 */
function settleRects(placed, width, height) {
  const owned = Array.from({ length: height }, () => new Array(width).fill(false));
  const settled = [];
  for (const entry of placed) {
    const rect = claimRect(entry, owned, width, height);
    if (rect !== null) settled.push(rect);
  }
  return settled;
}

/**
 * Squarified rectangles for `items`, in cell units, inside a `width` x `height`
 * box at the origin. Returns `[{item, index, x, y, x1, y1}]` with the corners
 * clipped to the box, so nothing can paint outside it.
 */
export function squarify(items, width, height, rows = false) {
  if (width < 1 || height < 1) return [];
  const areas = measureAreas(items, width, height);
  if (areas.length === 0) return [];
  const placed = [];
  layoutAreas(areas, { x: 0, y: 0, w: width, h: height }, rows, placed);
  return settleRects(placed, width, height);
}

// ---------------------------------------------------------------------------
// Drawing: every branch below only paints into the grid it is handed.
// ---------------------------------------------------------------------------

/** The width a treemap draws at: at least 12 cells, 48 by default. */
function chartWidth(spec) {
  return Math.max(12, Math.floor(spec.width ?? 48));
}

/** The row a map with nothing to draw shows. */
function noDataRow(width) {
  return { width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] };
}

/** Push the title row, when the spec has a title that is not empty. */
function pushTitle(rows, title, width) {
  if (title == null) return;
  const text = String(title);
  if (text) rows.push(titleRow(text, width));
}

/** Whether the map is grouped and the legend was not turned off. */
function showsLegend(spec, tree) {
  return tree.grouped && spec.legend !== false;
}

/** How many distinct groups the legend names. */
function legendCount(tree) {
  return new Set(tree.items.map((item) => item.group)).size;
}

/** The plot height, after the title and the legend take their rows. */
function mapHeight(spec, tree) {
  const chrome = (spec.title ? 1 : 0) + (showsLegend(spec, tree) ? legendCount(tree) : 0);
  return plotRowsFor(spec, { chrome, fallback: 12, min: 3, max: 30 });
}

/** The space and colours a tile draws with. */
function boxOf(rect, colour, theme) {
  return {
    room: rect.x1 - rect.x - 1,
    tall: rect.y1 - rect.y,
    tint: mixOklab(theme.tint, colour, SHADE),
    edge: mixOklab(theme.tint, colour, EDGE),
    colour,
  };
}

/**
 * Whether a group can nest its children: it needs children, room inside its
 * border for text, and rows enough for a header plus a child.
 */
function canNest(node, box) {
  return node.children.length >= 1 && box.room >= 6 && box.tall >= 4;
}

/** What is left inside a group's border, below its header. */
function innerOf(rect) {
  const x = rect.x + 1;
  const y = rect.y + 2;
  return { x, y, w: rect.x1 - x, h: rect.y1 - y };
}

/** Whether a child is big enough to carry a border of its own. */
function fitsBox(kid) {
  return kid.x1 - kid.x >= 7 && kid.y1 - kid.y >= 3;
}

/** Where a child's text sits: inset by its border when it has one. */
function textInset(boxed) {
  return boxed ? { pad: 1, top: 1 } : { pad: 0, top: 0 };
}

/** The gap a child gives up to separate it from its neighbour. */
function childGapY(boxed, tall) {
  if (boxed) return tall >= 4 ? 1 : 0;
  return tall >= 2 ? 1 : 0;
}

/**
 * The whole-cell rectangle a child draws into. Siblings are separated by one
 * clear column and row of the group's own tint, the way a spreadsheet treemap
 * leaves a gap between blocks, so a child's area stays legible even when it is
 * too small to carry a box. The gap is a luxury: a child only gives up a row to
 * it when two rows of text still fit after it, so a small tile shows its value
 * instead of a label and a stripe of tint.
 */
function childBox(kid, inner, boxed) {
  const x = kid.x + inner.x;
  const y = kid.y + inner.y;
  const x1 = kid.x1 + inner.x;
  const y1 = kid.y1 + inner.y;
  const gapX = x1 - x >= 3 ? 1 : 0;
  const bx = x1 - gapX;
  const by = y1 - childGapY(boxed, y1 - y);
  const inset = textInset(boxed);
  return {
    x,
    y,
    bx,
    by,
    boxed,
    pad: inset.pad,
    top: y + inset.top,
    room: bx - x + 1 - 2 * inset.pad,
  };
}

/**
 * Whether a child shows its value: the row under the label has to still be text.
 * For a boxed child that row must sit above the box's bottom border; an unboxed
 * child owns every row it was given.
 */
function showsValue(box) {
  return box.room >= 4 && box.by - box.top >= (box.boxed ? 2 : 1);
}

/** A child's label, and its value on the row under it when one fits. */
function drawChildText(ctx, kid, box, tint) {
  const item = ctx.items[kid.item.at];
  if (box.room < 4) return;
  stampText(ctx.grid, box.x + box.pad, box.top, truncate(item.label, box.room), {
    slice: kid.item.at,
    kind: "label",
    color: tint,
  });
  if (!showsValue(box)) return;
  stampText(ctx.grid, box.x + box.pad, box.top + 1, truncate(formatNumber(item.value), box.room), {
    slice: kid.item.at,
    kind: "label",
    color: tint,
  });
}

/** One child tile inside its group, tinted by its rank among its siblings. */
function drawChild(ctx, kid, inner, colour, boxed) {
  const box = childBox(kid, inner, boxed);
  // Siblings of one group share the hue and differ in shade, so the map still
  // reads as groups at a glance: each rank takes a brighter step than the one
  // before it.
  const tint = mixOklab(ctx.theme.tint, colour, 0.45 + (kid.index % 4) * 0.14);
  fillRect(ctx.grid, box.x, box.y, box.bx, box.by, { slice: kid.item.at, kind: "cell", color: tint });
  if (boxed) {
    drawBox(ctx.grid, box.x, box.y, box.bx, box.by, {
      slice: kid.item.at,
      kind: "fill",
      color: mixOklab(ctx.theme.tint, colour, 0.9),
    });
  }
  drawChildText(ctx, kid, box, tint);
}

/**
 * Lay a group's children out inside what is left of its box. A group's children
 * are laid out as rows: bands of items stacked downwards, which is what a
 * spreadsheet treemap looks like.
 */
function drawChildren(ctx, node, inner, colour) {
  const kids = node.children.map((at) => ({ value: ctx.items[at].value, at }));
  const rects = squarify(kids, inner.w, inner.h, true);
  ctx.lost += node.children.length - rects.length;
  // Boxing is a decision for the group, not for each child: when the smallest of
  // them cannot carry a box, none of them get one and the siblings are told
  // apart by their shade. A mix of boxed and unboxed children in one group is
  // what made a group look unfinished.
  const boxed = rects.every(fitsBox);
  for (const kid of rects) drawChild(ctx, kid, inner, colour, boxed);
}

/**
 * A group with children gets its own box and a header, and its children are
 * squarified inside what is left: that nesting is what makes a treemap read as
 * a treemap instead of a row of columns. A group with no room to nest still
 * keeps its total, but its children are not drawn: that is a loss the footer
 * has to name.
 */
function drawGroup(ctx, rect, box, node) {
  fillRect(ctx.grid, rect.x, rect.y, rect.x1, rect.y1, {
    slice: rect.index,
    kind: "cell",
    color: mixOklab(ctx.theme.tint, box.colour, SHADE * 0.45),
  });
  drawBox(ctx.grid, rect.x, rect.y, rect.x1, rect.y1, { slice: rect.index, kind: "fill", color: box.edge });
  stampText(ctx.grid, rect.x + 1, rect.y + 1, truncate(`${node.label} ${formatNumber(node.value)}`, box.room), {
    slice: rect.index,
    kind: "title",
  });
  const inner = innerOf(rect);
  if (inner.w < 3 || inner.h < 1) return;
  drawChildren(ctx, node, inner, box.colour);
}

/** A tile's label, and its value on the row under it when the tile fits both. */
function drawTileText(grid, rect, box, node) {
  // A label needs room for itself and the border either side. The box owns the
  // first and the last row of the tile, so a value needs a second text row
  // inside them: `tall >= 3` is label plus value, not one row.
  if (box.room < 3 || box.tall < 2) return;
  stampText(grid, rect.x + 1, rect.y + 1, truncate(node.label, box.room), {
    slice: rect.index,
    kind: "label",
    color: box.tint,
  });
  if (box.tall < 3) return;
  // Same kind as the label: the plugin paints a label with the tile colour as
  // its background, so the value sits on the tile instead of punching a hole
  // through it.
  stampText(grid, rect.x + 1, rect.y + 2, truncate(formatNumber(node.value), box.room), {
    slice: rect.index,
    kind: "label",
    color: box.tint,
  });
}

/** One leaf tile: its fill, its border, and the text that fits. */
function drawTile(ctx, rect, box, node) {
  if (node.children.length >= 1) ctx.collapsed.push({ label: node.label, count: node.children.length });
  fillRect(ctx.grid, rect.x, rect.y, rect.x1, rect.y1, { slice: rect.index, kind: "cell", color: box.tint });
  // A one-cell strip has no room for two corners: the second would overwrite the
  // first and leave a lone `╮` floating at the edge. The fill says enough.
  if (rect.x1 > rect.x && rect.y1 > rect.y) {
    drawBox(ctx.grid, rect.x, rect.y, rect.x1, rect.y1, { slice: rect.index, kind: "fill", color: box.edge });
  }
  drawTileText(ctx.grid, rect, box, node);
}

/** Draw one top-level node: a nested group, or a tile with its total. */
function drawNode(ctx, rect) {
  const node = rect.item.node;
  const box = boxOf(rect, ctx.palette[node.group % ctx.palette.length], ctx.theme);
  if (canNest(node, box)) drawGroup(ctx, rect, box, node);
  else drawTile(ctx, rect, box, node);
}

/**
 * What the picture could not show. A group too small to nest keeps its total and
 * loses its children, and a tile the rounding could not place loses a value
 * outright; both are counted here and said in the footer.
 */
function lostCount(tree, rects) {
  const placedNodes = new Set(rects.map((rect) => rect.item.node));
  let lost = 0;
  for (const node of tree) if (!placedNodes.has(node)) lost += node.children.length || 1;
  return lost;
}

/** Draw the map into a fresh grid, and carry what it could not show. */
function drawMap(tree, spec, width) {
  const theme = themeOf(spec);
  const height = mapHeight(spec, tree);
  const grid = blankGrid(width, height);
  const rects = squarify(tree.tree.map((node) => ({ value: node.value, node })), width, height);
  const ctx = {
    grid,
    theme,
    palette: paletteOf(spec),
    items: tree.items,
    collapsed: [],
    lost: lostCount(tree.tree, rects),
    dropped: tree.dropped,
  };
  for (const rect of rects) drawNode(ctx, rect);
  return { grid, ctx };
}

/** The legend entries: one per group, in first-appearance order, with its total. */
function groupTotals(items, names) {
  const entries = [];
  for (const item of items) {
    const at = entries.findIndex((entry) => entry.group === item.group);
    if (at === -1) entries.push({ group: item.group, label: names[item.group] ?? item.label, value: item.value });
    else entries[at].value += item.value;
  }
  return entries;
}

/** One legend row, with its marker carrying the group's slice. */
function legendBlock(entry, width) {
  return legendRowRuns([{ label: entry.label, value: entry.value }], { width, values: false }).map((row) => ({
    ...row,
    runs: row.runs.map((run) => (run.kind === "legend-mark" ? { ...run, slice: entry.group } : run)),
  }));
}

/** Every group's legend row, in the order the groups first appear. */
function legendBlocks(tree, width) {
  const blocks = [];
  for (const entry of groupTotals(tree.items, tree.names)) blocks.push(...legendBlock(entry, width));
  return blocks;
}

/** A count and its noun, singular or plural. */
function countOf(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The groups whose children were folded into a total, as one line. */
function collapsedLabels(collapsed) {
  return collapsed.map((group) => `${group.label} (${countOf(group.count, "child", "children")})`).join(", ");
}

/** The footer lines: every value and group the map could not draw. */
function buildNotes(state) {
  const notes = [];
  if (state.dropped > 0) notes.push(`${countOf(state.dropped, "value", "values")} omitted (not a positive number)`);
  if (state.collapsed.length > 0) notes.push(`collapsed: ${collapsedLabels(state.collapsed)}`);
  if (state.lost > 0) notes.push(`no cell for ${countOf(state.lost, "value", "values")}`);
  return notes;
}

/** One row per footer note, indented and clipped to the chart width. */
function noteRows(state, width) {
  return buildNotes(state).map((note) => ({
    width,
    runs: [{ text: truncate(`  ${note}`, width), slice: -1, kind: "legend" }],
  }));
}

/** The rows a treemap draws: title, the group boxes, then the legend. */
export function renderTreemapRows(spec) {
  const width = chartWidth(spec);
  const rows = [];
  pushTitle(rows, spec.title, width);

  const tree = normalizeTree(spec);
  if (tree.items.length === 0) {
    rows.push(noDataRow(width));
    return rows;
  }

  const { grid, ctx } = drawMap(tree, spec, width);

  for (const row of grid) rows.push({ width, runs: cellsToRuns(row) });
  if (showsLegend(spec, tree)) rows.push(...legendBlocks(tree, width));
  rows.push(...noteRows(ctx, width));

  return rows;
}

/** The contrast colour for a group's tile, exposed for callers that draw their own labels. */
export function treemapContrast(colour, theme = THEMES.dark) {
  return contrastOn(mixOklab(theme.tint, colour, SHADE));
}
