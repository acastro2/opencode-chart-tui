# opencode-chart-tui

**22 chart families, drawn inside the OpenCode terminal from a fenced code block.**

You type a ```chart fence with a JSON body; the plugin draws it in place — pie, donut, bar, line, area, scatter, histogram, candlestick, waterfall, heat map, gauge, radar, treemap, sankey, kanban — in colour, at sub-cell resolution, on your terminal's own theme.

Nothing is rendered as an image: every family paints a grid of cells, so the geometry is testable without a terminal and the picture fits any pane.

![Pie](assets/pie.svg)

| | |
|---|---|
| ![Donut](assets/donut.svg) | ![Radar](assets/radar.svg) |
| ![Treemap](assets/treemap.svg) | ![Sankey](assets/sankey.svg) |
| ![Waterfall](assets/waterfall.svg) | ![Kanban](assets/kanban.svg) |
| ![Heatmap](assets/heatmap.svg) | ![Table](assets/table.svg) |

The rest: `bar` `column` `hbar` `histogram` `candle` `candlestick` `ohlc` `line` `area` `sparkline` `scatter` `gauge` `progress` — every one of them is in [`assets/`](assets) as an SVG rendered from the library's own output, and in [`review/renders.txt`](review/renders.txt) as plain text.

## Install

The plugin is a directory with a `tui.js` entrypoint. Clone it anywhere and point OpenCode at it.

```sh
git clone https://github.com/acastro2/opencode-chart-tui ~/.config/opencode/charts
```

Then add it to the CLI plugin list in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["./charts"]
}
```

Or keep the repo where you develop it and symlink the directory into the config folder:

```sh
ln -s ~/Developer/opencode-chart-tui ~/.config/opencode/charts
```

The plugin has no dependencies of its own: `@opentui/core` and the OpenCode plugin API are resolved from the host at runtime. Restart the TUI once after the first install (plugins load at startup).

## Use

A fence whose language is `chart`. The body is JSON — comments and trailing commas are allowed.

````markdown
```chart
{
  "type": "pie",
  "title": "Pipeline",
  "slices": [["Closed won", 62], ["In flight", 28], ["At risk", 10]]
}
```
````

Press nothing, run nothing: the fence is replaced by the drawing as soon as it is rendered. A body that cannot be read shows `chart: <reason>` and the fence itself, so a broken chart is never silent. Anything the chart had to change — a guessed type, an old key name, a value that was not a number — is printed under it in a muted footer.

### The families

| type | data | notes |
|---|---|---|
| `pie`, `donut` | `slices: [[label, value]]`, or `labels` + `values` | `mosaic` sets the rim resolution |
| `bar`, `column` | `labels`, `values` or `series: [{name, values}]` | `stacked`, `normalized` (100%), `showPercent` |
| `hbar` | the same | `sort`, `track` |
| `line`, `area` | `labels`, `values` or `series` | `stacked`, `normalized`, `zero: false` for a narrow range |
| `scatter` | `points: [[x, y]]` | `big` doubles the marker |
| `sparkline` | `values` | one row |
| `histogram` | `values: [numbers]` | `bins`, square-root rule by default |
| `candle`, `candlestick` | `candles: [{open, high, low, close}]` or `values: [[o, h, l, c]]` | `up` / `down` colours |
| `ohlc` | the same data | drawn as candles |
| `heatmap` | `headers`, `rows: [{label, values}]` | `cellWidth`, `low`, `high`, `valueLabels` |
| `gauge`, `progress` | `value`, `max` | `target` draws a marker |
| `waterfall` | `values` (deltas), `labels` | `start`, `total: false`, `totalLabel` |
| `table` | `columns: [{label, type}]`, `rows` | types `text`, `number`, `bar`, `heat` |
| `radar` | `labels` (axes), `values` or `series` | `max`, `spokes: false`, `filled` |
| `treemap` | `items: [{label, value, children}]` | groups hold their children as bands |
| `sankey` | `nodes`, `links: [{from, to, value}]` | columns declared or layered from the links |
| `kanban` | `columns: [{title, cards}]` or a flat `cards` list | `columnWidth`, `order` |

Shared keys: `title`, `width`, `height`, `theme` (`dark` | `light`), `palette`, `legend`, `mosaic` (`sextant` default, `octant` for Unicode 16 fonts, `quadrant` for the widest support), `textured`, `boundaryColor`.

The full contract, with a description of every key, is [`schema/chart.schema.json`](schema/chart.schema.json).

## How it draws

Three ideas do the work.

1. **Cells are not square.** A terminal cell is about twice as tall as it is wide, so a circle is drawn on an ellipse in cell coordinates (vertical radius = half the horizontal) and every shape is corrected the same way. Without it a pie is a tall oval.
2. **A cell is a mosaic.** Each cell is sampled as a 2×2, 2×3 or 2×4 grid of sub-cells and the resulting mask picks a Unicode mosaic glyph (`▖▝🬭𜴏`), so rims and band edges follow the curve instead of stair-stepping. Three character sets are supported: quadrant (Unicode 1.0, everywhere), sextant (Unicode 13, the default) and octant (Unicode 16, the sharpest).
3. **A boundary cell carries both series.** Where a boundary crosses a cell, the glyph holds the winning series' sub-cells and the cell's background holds the other, so the boundary costs no extra cell and lands on the sub-cell curve. The same trick draws a spoke over a filled radar.

Every family renders from a grid of cells, with plain text and styled runs as two renderings of the same layout — which is why there are tests for geometry and none for colour matching.

## The library

`src/` is dependency-free ES modules, usable without OpenCode:

```js
import { renderChart, renderChartRows, chartTypes } from "./src/chart.js";

renderChart({ type: "bar", labels: ["a", "b"], values: [3, 5] });      // plain text
renderChartRows({ type: "bar", labels: ["a", "b"], values: [3, 5] });  // rows of runs, for a renderer
```

| | |
|---|---|
| `core.js` | cells, runs, the sub-cell sampler, legends, perceptual colour mixes, wrapping |
| `theme.js` | dark and light palettes, muted tones, `styleOf(run)` → colours and background |
| `mosaic.js` | quadrant, sextant and octant glyph tables, generated from UnicodeData.txt |
| `axis.js` | nice bounds, the box-model axis, tick rows, label rows |
| `pie.js` `bar.js` `line.js` `heatmap.js` `gauge.js` `histogram.js` `candle.js` `waterfall.js` `table.js` `radar.js` `treemap.js` `sankey.js` `kanban.js` | the families |
| `chart.js` | dispatcher, tolerant fence parser, note footer |

```sh
npm test          # 160 checks across 15 suites
npm run accuracy  # the pie rim against the analytic ellipse
node scripts/dump.mjs 58     # every family as plain text → review/renders.txt
node scripts/images.mjs 76   # every family as an SVG → assets/
```

## The plugin

`tui.js` registers a code-block renderer for the `chart` language with OpenCode's CLI plugin API, parses the fence with the library, picks the theme (the fence's own, or the terminal's), turns each run into a styled chunk and each row into a `TextRenderable`. Grid-like families stop at 110 columns and everything else at 160, because a treemap stretched across a very wide pane reads as flat stripes; a fence that names a `width` gets exactly that.

## The skill

The same knowledge ships as an agent skill, so a model writes the fence for you:

```sh
npx skills add acastro2/opencode-chart-tui
```

It carries the fence contract, one example per family, the option names and the schema path. Trigger it by asking for a chart in chat.

## Notes

- [`REFERENCES.md`](REFERENCES.md) — what I learned building renderers on OpenTUI: custom renderables, the testing harness, the exclusive markdown registry, the traps.
- [`review/anatomy.html`](review/anatomy.html) — a page that opens in a browser: the aspect correction, the octant bit layout, the sub-cell sampler with its three modes, and the renders annotated.
- [`SPEC.md`](SPEC.md) — the fence specification the library implements.

## Limits

- Interactive charts are out of scope: a fence is a picture, not a widget.
- The `mermaid` language belongs to OpenCode's built-in renderer. A plugin cannot extend it (the markdown registry is exclusive), so the families Mermaid supports and this library does not — gantt, gitgraph, timeline, mindmap, quadrant, requirements, C4, packet, block, architecture, radar-ish and the rest — would need an upstream change, not a plugin.
- Octant glyphs need Unicode 16 (2024) in your terminal font. The default is sextant; `"mosaic": "octant"` opts in.

## License

MIT. See [LICENSE](LICENSE).
