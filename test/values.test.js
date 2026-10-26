// The value contract: one rule, declared per family, used by the drawing and by
// the footer. These checks pin the rule itself, not a renderer.

import assert from "node:assert/strict";
import {
  DROP,
  HOLE,
  POINTS_POLICY,
  VALUE_POLICY,
  ZERO,
  coerce,
  coerceList,
  isBlank,
  policyFor,
  tallyIsQuiet,
} from "../src/values.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

check("blank means no value, not zero", () => {
  for (const value of [null, undefined, ""]) assert.equal(isBlank(value), true, `${value} is blank`);
  for (const value of [0, "0", false, NaN, "x"]) assert.equal(isBlank(value), false, `${value} is not blank`);
});

check("a readable number is kept under every policy", () => {
  for (const fate of [ZERO, HOLE, DROP]) {
    const result = coerce("12", { null: fate, invalid: fate });
    assert.deepEqual(result, { value: 12, fate: "ok" });
    assert.equal(coerce(0, { null: fate, invalid: fate }).fate, "ok", "a real zero is not a blank");
  }
});

check("a blank takes the family's blank fate", () => {
  assert.deepEqual(coerce(null, { null: ZERO, invalid: DROP }), { value: 0, fate: ZERO });
  assert.deepEqual(coerce(null, { null: HOLE, invalid: DROP }), { value: null, fate: HOLE });
  assert.deepEqual(coerce("", { null: DROP, invalid: ZERO }), { value: null, fate: DROP });
});

check("an unreadable value takes the invalid fate", () => {
  assert.deepEqual(coerce("x", { null: DROP, invalid: ZERO }), { value: 0, fate: ZERO });
  assert.deepEqual(coerce("x", { null: ZERO, invalid: DROP }), { value: null, fate: DROP });
  assert.equal(coerce(NaN, { null: ZERO, invalid: HOLE }).fate, HOLE);
});

check("the two fates can differ inside one family", () => {
  // Histogram: a blank is a real zero sample, "x" is not a sample at all.
  const histogram = policyFor("histogram");
  assert.equal(coerce(null, histogram).fate, ZERO);
  assert.equal(coerce("x", histogram).fate, DROP);

  // Candle: a missing price is not a zero price.
  const candle = policyFor("candle");
  assert.equal(coerce(null, candle).fate, DROP);
  assert.equal(coerce("x", candle).fate, DROP);
});

check("a list reports what happened to it", () => {
  const { values, zeroed, holes, dropped } = coerceList(
    [1, null, "x", 4],
    { null: ZERO, invalid: DROP },
  );
  assert.deepEqual(values, [1, 0, null, 4], "alignment is kept");
  assert.deepEqual({ zeroed, holes, dropped }, { zeroed: 1, holes: 0, dropped: 1 });
});

check("compaction removes dropped entries", () => {
  const { values, dropped } = coerceList([1, "x", 3], { null: DROP, invalid: DROP }, { compact: true });
  assert.deepEqual(values, [1, 3]);
  assert.equal(dropped, 1);
});

check("a quiet tally says nothing", () => {
  assert.equal(tallyIsQuiet({ zeroed: 0, holes: 0, dropped: 0 }), true);
  assert.equal(tallyIsQuiet({ zeroed: 1, holes: 0, dropped: 0 }), false);
});

check("scatter points are strict even though series zero-fill", () => {
  assert.equal(POINTS_POLICY.invalid, DROP);
  assert.equal(policyFor("scatter").invalid, ZERO);
});

check("every family that can draw a value has a policy", () => {
  const families = [
    "bar", "column", "hbar", "line", "area", "sparkline", "scatter", "radar",
    "gauge", "progress", "histogram", "waterfall", "pie", "donut", "treemap",
    "sankey", "candle", "candlestick", "ohlc", "heatmap",
  ];
  for (const family of families) {
    const policy = VALUE_POLICY[family];
    assert.ok(policy, `${family} has a policy`);
    for (const fate of [policy.null, policy.invalid]) {
      assert.ok([ZERO, HOLE, DROP].includes(fate), `${family} uses a known fate (${fate})`);
    }
  }
});

console.log(`\n${checks}/${checks} checks passed`);
