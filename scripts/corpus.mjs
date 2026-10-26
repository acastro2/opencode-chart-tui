// One corpus for every gate: the 23 gallery samples, the variants the family
// grid cannot reach, and the extra specs worth asserting but not drawing in the
// README.
//
// Why: the samples, the goldens and the gates used to read different lists. A
// variant that only the golden grid knew about could not fail the audit, and a
// fix proven by a golden could sit behind a gate that never saw the case. One
// module means a new spec is visible to every gate at once.
//
// Division of labour:
//   SAMPLES  one fence per family; gallery, dump, images and the family goldens.
//   VARIANTS grouped/stacked series, narrow widths and tight heights; goldens.
//   EDGE_SPECS  further cases; audit, fidelity and perf (and goldens through
//               edgeSpecs(), which includes the variants).

/** One sample fence per family, shared by the dump and the image generator. */
export const SAMPLES = {
  pie: { title: "Closed won", labels: ["Closed won", "In flight", "At risk"], values: [62, 28, 10] },
  donut: { title: "Spend", labels: ["Cloud", "Salaries", "Tools"], values: [44, 38, 18], donut: true },
  bar: { title: "Bookings", labels: ["Jul", "Aug", "Sep", "Oct"], values: [120, 150, 168, 141], height: 9 },
  column: { title: "Bookings", labels: ["Jul", "Aug", "Sep", "Oct"], values: [120, 150, 168, 141], height: 9 },
  hbar: { title: "Accounts", labels: ["Globex", "Initech", "Umbrella", "Soylent"], values: [4200, 3100, 2900, 880] },
  histogram: {
    title: "Ticket size",
    values: [3, 5, 5, 6, 7, 7, 8, 8, 9, 9, 10, 11, 12, 13, 15, 18, 22, 26, 31, 44],
    height: 9,
  },
  candle: {
    title: "ACME",
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    candles: [
      { open: 10, high: 14, low: 8, close: 12 },
      { open: 12, high: 13, low: 9, close: 10 },
      { open: 10, high: 12, low: 7, close: 11 },
      { open: 11, high: 15, low: 10, close: 14 },
      { open: 14, high: 16, low: 12, close: 13 },
    ],
    height: 12,
  },
  candlestick: {
    title: "ACME",
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    values: [[10, 14, 8, 12], [12, 13, 9, 10], [10, 12, 7, 11], [11, 15, 10, 14], [14, 16, 12, 13]],
    height: 12,
  },
  ohlc: {
    title: "ACME",
    labels: ["Mon", "Tue", "Wed"],
    values: [[10, 14, 8, 12], [12, 13, 9, 10], [10, 12, 7, 11]],
    height: 10,
  },
  line: { title: "Revenue", labels: ["Jan", "Feb", "Mar", "Apr", "May"], series: [{ name: "Revenue", values: [12, 18, 15, 22, 26] }], height: 9 },
  area: { title: "Revenue", labels: ["Jan", "Feb", "Mar", "Apr", "May"], series: [{ name: "Revenue", values: [12, 18, 15, 22, 26] }], height: 9 },
  sparkline: { title: "Pulse", values: [3, 5, 4, 7, 6, 9, 8, 11, 10, 12] },
  scatter: { title: "Deals", points: [[1, 2], [2, 5], [3, 3], [4, 8], [5, 6], [6, 9]], height: 10 },
  heatmap: {
    title: "Ops by hour",
    headers: ["9am", "12pm", "3pm", "6pm"],
    rows: [
      { label: "Mon", values: [1, 4, 6, 2] },
      { label: "Tue", values: [2, 6, 7, 3] },
      { label: "Wed", values: [1, 3, 5, 2] },
    ],
  },
  gauge: { title: "Coverage", label: "Coverage", value: 62, max: 100 },
  progress: { title: "Sprint", label: "Done", value: 0.4, max: 1 },
  waterfall: { title: "ARR movement", labels: ["Start", "New", "Churn", "Expansion"], values: [120, 45, -30, 25], height: 10 },
  table: {
    title: "Accounts",
    columns: [{ label: "Account" }, { label: "ARR", type: "number" }, { label: "Share", type: "bar" }, { label: "Trend", type: "heat" }],
    rows: [["Globex", 4200, 42, 3], ["Initech", 3100, 31, 7], ["Umbrella", 2900, 29, 5], ["Soylent", 880, 9, 2]],
  },
  radar: {
    title: "Service health",
    labels: ["Speed", "Cost", "Risk", "Reach", "Quality"],
    series: [{ name: "Now", values: [4, 3, 4, 5, 4] }, { name: "Target", values: [5, 4, 2, 4, 5] }],
    height: 20,
  },
  treemap: {
    title: "Spend by team",
    height: 12,
    items: [
      { label: "Platform", children: [{ label: "API", value: 19 }, { label: "ETL", value: 15 }, { label: "Web", value: 12 }] },
      { label: "Ops", children: [{ label: "SRE", value: 12 }, { label: "Support", value: 6 }] },
    ],
  },
  sankey: {
    title: "Signup flow",
    height: 14,
    nodes: [
      { id: "sources", label: "Sources" },
      { id: "search", label: "Search" },
      { id: "social", label: "Social" },
      { id: "email", label: "Email" },
      { id: "trial", label: "Trial" },
      { id: "paid", label: "Paid" },
    ],
    links: [
      { from: "sources", to: "search", value: 14 },
      { from: "sources", to: "social", value: 10 },
      { from: "sources", to: "email", value: 4 },
      { from: "sources", to: "paid", value: 8 },
      { from: "search", to: "trial", value: 14 },
      { from: "social", to: "trial", value: 7 },
      { from: "email", to: "trial", value: 3 },
    ],
  },
  kanban: {
    title: "Sprint",
    height: 12,
    columns: [
      { title: "Todo", cards: [{ title: "Ship the sankey", meta: "@ana" }] },
      { title: "Doing", cards: [{ title: "Radar labels", meta: "@rui" }, { title: "Treemap tint" }] },
      { title: "Done", cards: [{ title: "Waterfall", meta: "@ana" }, { title: "Table" }] },
    ],
  },
  gantt: {
    title: "Rollout plan",
    height: 13,
    today: "2026-11-14",
    tasks: [
      { label: "Design", group: "Discovery", start: "2026-11-02", end: "2026-11-13" },
      { label: "Stakeholder sign-off", group: "Discovery", start: "2026-11-13", end: "2026-11-17" },
      { label: "Build", group: "Delivery", start: "2026-11-16", end: "2026-12-04" },
      { label: "Test", group: "Delivery", start: "2026-11-30", end: "2026-12-11" },
      { label: "Launch", group: "Delivery", at: "2026-12-14", milestone: true },
      { label: "Hypercare", group: "Delivery", start: "2026-12-14", end: "2027-01-08" },
    ],
  },
};

/**
 * Specs the one-sample-per-family grid cannot reach: grouped and stacked
 * series, multi-series lines, and the small-height paths where a note competes
 * with the plot for rows. Without these the grouped-bar floor bug drew for
 * months behind a green gate, because every sample had exactly one series.
 */
export const VARIANTS = {
  "bar-grouped": {
    type: "bar",
    title: "Bookings by state",
    labels: ["Jul", "Aug", "Sep"],
    series: [{ name: "Closed", values: [120, 90, 60] }, { name: "Open", values: [30, 60, 90] }],
    height: 9,
  },
  "bar-stacked": {
    type: "bar",
    title: "Bookings by state",
    labels: ["Jul", "Aug", "Sep"],
    series: [{ name: "Closed", values: [120, 90, 60] }, { name: "Open", values: [30, 60, 90] }],
    stacked: true,
    height: 9,
  },
  "hbar-grouped": {
    type: "hbar",
    title: "Accounts by region",
    labels: ["Globex", "Initech"],
    series: [{ name: "This year", values: [42, 31] }, { name: "Last year", values: [30, 44] }],
  },
  "line-multi": {
    type: "line",
    title: "Revenue and cost",
    labels: ["Jan", "Feb", "Mar", "Apr", "May"],
    series: [{ name: "Revenue", values: [12, 18, 15, 22, 26] }, { name: "Cost", values: [9, 11, 12, 13, 15] }],
    height: 9,
  },
  "area-stacked": {
    type: "area",
    title: "Traffic by source",
    labels: ["A", "B", "C", "D"],
    series: [{ name: "Base", values: [3, 4, 3, 5] }, { name: "Add-on", values: [2, 1, 2, 1] }],
    stacked: true,
    height: 9,
  },
  "area-stacked-single": {
    type: "area",
    title: "Traffic",
    labels: ["A", "B", "C"],
    series: [{ name: "Only", values: [3, 4, 3] }],
    stacked: true,
    height: 8,
  },
  "kanban-tight": {
    type: "kanban",
    title: "Sprint",
    height: 9,
    columns: [
      { title: "Todo", cards: [{ title: "a" }, { title: "b" }] },
      { title: "Doing", cards: [{ title: "c" }] },
    ],
  },
  "candle-many": {
    type: "candle",
    title: "ACME",
    labels: Array.from({ length: 12 }, (_, index) => `${index + 1}`),
    candles: Array.from({ length: 12 }, (_, index) => ({
      open: 10 + index, high: 12 + index, low: 9 + index, close: 11 + index,
    })),
    height: 8,
  },
  "bar-many": {
    type: "bar",
    title: "Thirty categories",
    labels: Array.from({ length: 30 }, (_, index) => `S${index}`),
    values: Array.from({ length: 30 }, (_, index) => index + 1),
    height: 8,
  },
  "histogram-many": {
    type: "histogram",
    title: "Many bins",
    values: Array.from({ length: 120 }, (_, index) => (index * 37) % 100),
    bins: 60,
    height: 12,
  },
  "candle-bad": {
    type: "candle",
    title: "One row missing a price",
    candles: [
      { open: 10, high: 12, low: 9, close: 11 },
      { open: 11, high: 13, low: 10 },
      { open: 12, high: 14, low: 11, close: 13 },
    ],
    height: 8,
  },
};

/**
 * Cases beyond the gallery and the variants: the narrow widths where a group
 * loses its label or a bar loses its floor, and a stack that crosses zero.
 * These are assertions, not pictures: they never enter the README gallery.
 */
export const EDGE_SPECS = {
  "bar-grouped-narrow": {
    type: "bar",
    title: "Narrow group",
    labels: ["A", "B", "C"],
    series: [{ name: "Closed", values: [120, 90, 60] }, { name: "Open", values: [30, 60, 90] }],
    height: 8,
    width: 24,
  },
  "bar-stacked-negative": {
    type: "bar",
    title: "Stack across zero",
    labels: ["Up", "Down"],
    series: [{ name: "One", values: [10, -6] }, { name: "Two", values: [4, 3] }],
    stacked: true,
    height: 9,
  },
  "hbar-grouped-narrow": {
    type: "hbar",
    title: "Narrow ranking",
    labels: ["Globex", "Initech", "Umbrella"],
    series: [{ name: "This year", values: [42, 31, 18] }, { name: "Last year", values: [30, 44, 22] }],
    width: 24,
  },
  "line-multi-narrow": {
    type: "line",
    title: "Two series, narrow",
    labels: ["Jan", "Feb", "Mar", "Apr", "May"],
    series: [{ name: "Revenue", values: [12, 18, 15, 22, 26] }, { name: "Cost", values: [9, 11, 12, 13, 15] }],
    height: 7,
    width: 24,
  },
  "area-stacked-negative": {
    type: "area",
    title: "Bands across zero",
    labels: ["A", "B", "C", "D"],
    series: [{ name: "Base", values: [4, -3, 5, 2] }, { name: "Add-on", values: [2, 2, -1, 3] }],
    stacked: true,
    height: 9,
  },
};

/**
 * Every spec a gate should assert beyond the 23 gallery samples: the variants
 * first, then the extra edge cases. Each entry is named, so a failure says which
 * case broke instead of "a spec".
 *
 * @returns {{ name: string, spec: object }[]}
 */
export function edgeSpecs() {
  return [
    ...Object.entries(VARIANTS).map(([name, spec]) => ({ name, spec })),
    ...Object.entries(EDGE_SPECS).map(([name, spec]) => ({ name, spec })),
  ];
}
