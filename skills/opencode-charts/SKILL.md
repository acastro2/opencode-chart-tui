---
name: opencode-charts
description: Draw a chart in the OpenCode terminal with a ```chart fenced block whose body is JSON. Use when the user asks to chart, plot, graph, visualise or compare numbers in chat, when a table of figures would read better as bars or a line, when they ask for a pie, histogram, candlestick, waterfall, heat map, gauge, radar, treemap, sankey or kanban board, or when a previous chart needs its type, size or colours changed. Carries the fence contract, one example per family, the option names and the schema. Not for sharing charts outside the terminal (use a document or an image for that).
---

# Charts in the terminal

A chart is a fenced block whose language is `chart` and whose body is a JSON object. The OpenCode TUI replaces the fence with the drawing. A body that cannot be read shows the reason and the fence itself, so nothing fails silently.

This skill ships with [opencode-chart-tui](https://github.com/acastro2/opencode-chart-tui): the plugin draws the charts, `src/` holds the renderer, `schema/chart.schema.json` describes every key, and `review/renders.txt` has every family as plain text.

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
