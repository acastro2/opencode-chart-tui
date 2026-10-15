# Chart fences

Every chart is a fenced block whose language is `chart` and whose body is JSON.
Paste a block into any OpenCode chat and it draws.

```chart
{"type":"histogram","title":"Ticket size","width":56,"height":9,"values":[3,5,5,6,7,7,8,8,9,9,10,11,12,13,15,18,22,26,31,44]}
```

```chart
{"type":"candlestick","title":"ACME","width":56,"height":12,"labels":["Mon","Tue","Wed","Thu","Fri","Sat"],"values":[[10,14,8,12],[12,13,9,10],[10,12,7,11],[11,15,10,14],[14,16,12,13],[13,14,9,10]]}
```

```chart
{"type":"waterfall","title":"ARR movement","width":56,"height":10,"labels":["Start","New","Churn","Expansion"],"values":[120,45,-30,25]}
```

```chart
{"type":"table","title":"Accounts","width":56,"columns":[{"label":"Account"},{"label":"ARR","type":"number"},{"label":"Share","type":"bar"},{"label":"Trend","type":"heat"}],"rows":[["Globex",4200,42,3],["Initech",3100,31,7],["Umbrella",2900,29,5],["Soylent",880,9,2]]}
```

```chart
{"type":"radar","title":"Service health","width":56,"height":20,"labels":["Speed","Cost","Risk","Reach","Quality"],"series":[{"name":"Now","values":[4,3,4,5,4]},{"name":"Target","values":[5,4,2,4,5]}]}
```

```chart
{"type":"treemap","title":"Spend by team","width":56,"height":12,"items":[{"label":"Platform","children":[{"label":"API","value":19},{"label":"ETL","value":15},{"label":"Web","value":12}]},{"label":"Ops","children":[{"label":"SRE","value":12},{"label":"Support","value":6}]}]}
```

```chart
{"type":"sankey","title":"Signup flow","width":56,"height":14,"nodes":[{"id":"s","label":"Sources"},{"id":"q","label":"Search"},{"id":"so","label":"Social"},{"id":"e","label":"Email"},{"id":"t","label":"Trial"},{"id":"p","label":"Paid"}],"links":[{"from":"s","to":"q","value":14},{"from":"s","to":"so","value":10},{"from":"s","to":"e","value":4},{"from":"s","to":"p","value":8},{"from":"q","to":"t","value":14},{"from":"so","to":"t","value":7},{"from":"e","to":"t","value":3}]}
```

```chart
{"type":"kanban","title":"Sprint","width":56,"height":14,"columns":[{"title":"Todo","cards":[{"title":"Ship the sankey","meta":"@ana"}]},{"title":"Doing","cards":[{"title":"Radar labels","meta":"@rui"},{"title":"Treemap tint"}]},{"title":"Done","cards":[{"title":"Waterfall","meta":"@ana"},{"title":"Table"}]}]}
```

## Also in the fence

- `bar`, `column`, `hbar` — `stacked`, `normalized` (100%), negatives draw below the zero row
- `line`, `area` — `stacked`, `normalized`, `points` for scatter
- `pie`, `donut` — `slices` or `labels` + `values`, `donut: true`
- `heatmap`, `gauge`, `progress`, `sparkline`, `scatter`
- Shared: `palette`, `mosaic` (`quadrant` | `sextant` | `octant`, default octant), `gap`, `textured`, `legend`, `title`, `width`, `height`
