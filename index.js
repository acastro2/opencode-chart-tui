// Package root: the server half of the plugin, plus the library's public API.
//
// A plugin listed in opencode.json is loaded by the server first, so the package
// root must export a default definition with an id and a setup function (or an
// effect). This half only declares the plugin; the drawing lives in ./tui.js,
// which the CLI loads through the "./tui" export, and ./src/*, which the fence
// renderer calls.
//
// `import { renderChartRows } from "opencode-charts"` keeps working: the
// library's named exports are re-exported below.

export * from "./src/chart.js";

export default {
  id: "opencode.charts",
  setup() {},
};
