---
name: opencode-charts
description: Draw a chart in the OpenCode terminal from a ```chart fenced block whose body is JSON. Reach for one as naturally as a Mermaid diagram: whenever a reply involves numbers that compare, a trend over time, a share of a whole, a ranking, a distribution, a plan or timeline, a flow, a hierarchy, or the state of work, draw the family that carries the point instead of listing figures. Also use when the user asks for a specific chart (pie, bar, line, histogram, candlestick, waterfall, heat map, gauge, radar, treemap, sankey, kanban, gantt) or when a chart that is already up needs its type, size or colours changed. Not for sharing charts outside the terminal (use a document or an image for that).
---

# Charts in the terminal

A chart is a fenced block whose language is `chart` and whose body is a JSON object. The OpenCode TUI replaces the fence with the drawing. A body that cannot be read shows the reason and the fence itself, so nothing fails silently.

This skill ships with [opencode-chart-tui](https://github.com/acastro2/opencode-chart-tui): the plugin draws the charts, `src/` holds the renderer, `schema/chart.schema.json` describes every key, and `review/renders.txt` has every family as plain text. The repo's README gallery shows each family as a picture next to the fence that drew it.

## Use them like diagrams

A chart in a reply is communication, not decoration. The same way a Mermaid block replaces three paragraphs about a flow, a chart replaces a list of numbers with the shape of the numbers. Draw one without being asked when you would otherwise write "X rose from A to B", "most of it is Y", "Z is the biggest", "we are behind target", or a bare column of figures.

| the point you are making | family |
|---|---|
| these magnitudes differ, and which is biggest | `bar`, or `hbar` for a ranking with long names |
| this changed over time | `line`; `area` when the volume matters; `sparkline` inline in a sentence |
| this is the mix of a whole | `pie` or `donut`; `bar` with `normalized` when there are many parts |
| how the mix moves over time | `area` with `stacked`, `normalized` for shares only |
| how these values are spread | `histogram` |
| ahead of or behind a target | `gauge`, `progress` |
| how a number got from A to B, and what moved it | `waterfall` |
| price moved within each period | `candlestick`, `ohlc` |
| a plan with dates and milestones | `gantt` |
| where a flow goes, and how much is lost | `sankey` |
| what fills the space, grouped | `treemap` |
| how options compare on several axes | `radar` (one shared `max` across charts) |
| the state of the work right now | `kanban` |
| exact figures, or a figure beside a bar or a heat tint | `table` |

Etiquette:

- Title it, always. The title is the sentence the chart is making.
- Label the numbers where the family can (`valueLabels`, or the axis), so the reader does not have to estimate.
- Keep the prose to the why. Do not narrate the chart; say what it means and what to do about it.
- One chart per point. Two charts in one reply is fine when they answer two questions.
- A table beats a chart for a handful of exact numbers someone will read one at a time.
- Never explain the fence or paste its JSON as prose. The reader sees the drawing, not the source.

## Rules

- Name the `type`. If it is missing the shape of the data decides (slices → pie, rows → heat map, values or series → bar) and the chart says so in a footer.
- Leave `width` out unless the chart should be narrow. With no width it uses the pane, stopping at 110 columns for grid-like families (treemap, kanban, table, heat map) and 160 for the rest.
- JSON with comments (`//`, `/* */`) and trailing commas is accepted.
- Read the muted footer under a chart before trusting the picture: it reports a guessed type, a key that was renamed, or values that were not numbers. `chart: <reason>` above the source means the body could not be parsed.
- Prefer `labels` + `values` for one series, `series: [{name, values}]` for several, `slices` for a pie.
- Keep values positive where the family needs it (pie, treemap, sankey drops negatives).

## One example per family

```chart
{"type":"pie","title":"Pipeline","slices":[["Closed won",62],["In flight",28],["At risk",10]]}
```

```chart
{"type":"bar","title":"Bookings","labels":["Jul","Aug","Sep","Oct"],"values":[118,132,146,168]}
```

```chart
{"type":"bar","title":"Pipeline mix","stacked":true,"normalized":true,"labels":["Jul","Aug"],"series":[{"name":"Closed","values":[80,50]},{"name":"Open","values":[20,50]}]}
```

```chart
{"type":"hbar","title":"Accounts","sort":true,"labels":["Globex","Initech","Umbrella","Soylent"],"values":[4200,3100,2900,880]}
```

```chart
{"type":"line","title":"Revenue","labels":["Jan","Feb","Mar","Apr"],"series":[{"name":"Revenue","values":[118,124,131,142]}]}
```

```chart
{"type":"area","title":"Booking mix","stacked":true,"labels":["Q1","Q2","Q3","Q4"],"series":[{"name":"Base","values":[40,55,60,72]},{"name":"Expansion","values":[12,18,25,31]}]}
```

```chart
{"type":"histogram","title":"Ticket size","values":[3,5,5,6,7,7,8,8,9,9,10,11,12,13,15,18,22,26,31,44]}
```

```chart
{"type":"candlestick","title":"ACME","labels":["Mon","Tue","Wed","Thu","Fri"],"values":[[10,14,8,12],[12,13,9,10],[10,12,7,11],[11,15,10,14],[14,16,12,13]]}
```

```chart
{"type":"waterfall","title":"ARR movement","labels":["Start","New","Churn","Expansion"],"values":[120,45,-30,25]}
```

```chart
{"type":"table","title":"Accounts","columns":[{"label":"Account"},{"label":"ARR","type":"number"},{"label":"Share","type":"bar"},{"label":"Trend","type":"heat"}],"rows":[["Globex",4200,42,3],["Initech",3100,31,7],["Umbrella",2900,29,5],["Soylent",880,9,2]]}
```

```chart
{"type":"heatmap","title":"Ops by hour","headers":["9am","12pm","3pm","6pm"],"cellWidth":4,"rows":[{"label":"Mon","values":[1,4,6,2]},{"label":"Tue","values":[2,6,7,3]},{"label":"Wed","values":[1,3,5,2]}]}
```

```chart
{"type":"gauge","title":"Coverage","value":62,"max":100}
```

```chart
{"type":"radar","title":"Service health","labels":["Speed","Cost","Risk","Reach","Quality"],"series":[{"name":"Now","values":[4,3,4,5,4]},{"name":"Target","values":[5,4,2,4,5]}],"max":5}
```

```chart
{"type":"treemap","title":"Spend by team","height":14,"items":[{"label":"Platform","children":[{"label":"API","value":19},{"label":"ETL","value":15},{"label":"Web","value":12}]},{"label":"Ops","children":[{"label":"SRE","value":12},{"label":"Support","value":6}]}]}
```

```chart
{"type":"sankey","title":"Signup flow","height":14,"nodes":[{"id":"s","label":"Sources"},{"id":"q","label":"Search"},{"id":"so","label":"Social"},{"id":"e","label":"Email"},{"id":"t","label":"Trial"}],"links":[{"from":"s","to":"q","value":14},{"from":"s","to":"so","value":10},{"from":"s","to":"e","value":4},{"from":"q","to":"t","value":14},{"from":"so","to":"t","value":7},{"from":"e","to":"t","value":3}]}
```

```chart
{"type":"kanban","title":"Sprint","height":14,"columns":[{"title":"Todo","cards":[{"title":"Ship the sankey","meta":"@ana"}]},{"title":"Doing","cards":[{"title":"Radar labels","meta":"@rui"}]},{"title":"Done","cards":[{"title":"Waterfall","meta":"@ana"}]}]}
```

```chart
{"type":"gantt","title":"Rollout plan","height":11,"today":"2026-11-14","tasks":[{"label":"Design","group":"Discovery","start":"2026-11-02","end":"2026-11-13"},{"label":"Stakeholder sign-off","group":"Discovery","start":"2026-11-13","end":"2026-11-17"},{"label":"Build","group":"Delivery","start":"2026-11-16","end":"2026-12-04"},{"label":"Test","group":"Delivery","start":"2026-11-30","end":"2026-12-11"},{"label":"Launch","group":"Delivery","at":"2026-12-14","milestone":true}]}
```

A `gantt` task takes `label` plus `start` and `end` (numbers, or ISO dates like `2026-11-02`), or `at` for a milestone. `group` starts a section, `today` draws the vertical marker.

## Options worth knowing

| key | meaning |
|---|---|
| `theme` | `dark` (default) or `light`; without it the terminal's own theme is used |
| `palette` | array of hex colours, one per series |
| `mosaic` | `sextant` (default), `octant` (Unicode 16, sharpest), `quadrant` (widest font support) |
| `zero: false` | line, scatter, candle: fit the axis to the data instead of anchoring it at zero |
| `normalized` | bar and area: every stack becomes 100% |
| `showPercent: false` | hide the share next to a single-series value |
| `max` | radar: share one scale between charts |
| `spokes: false` | radar: drop the axis lines |
| `height` | plot rows; the round families cap their own shape |
| `boundaryColor` | the colour of the line where two slices meet |
| `up` / `down` | candle: override the two directions |
| `low` / `high` | heat map: override the ramp ends |

Renamed keys still draw and are reported in the footer: `percent` → `showPercent`, `gap` → `boundaryColor`, a heat map's `columns` → `headers`.

## When a chart looks wrong

- Cut off on the right: the fence named a `width` wider than the pane, or the family is not in the 110-column grid cap list.
- All bars the same height: the values are strings, or a `series` was passed where `values` belongs; the footer says so.
- A pie with one slice: negative or zero values were dropped.
- Missing octant glyphs: the font lacks Unicode 16; use `"mosaic": "sextant"`.
