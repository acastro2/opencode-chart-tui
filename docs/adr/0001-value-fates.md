# ADR-0001: A fence value has one declared fate

Date: 2026-10-26
Status: accepted

## Context

A fence value can be unreadable in two ways: it is blank (`null`, `undefined`,
`""`) or it cannot be read as a number (`"x"`, `NaN`). Each family decided what
to do with it, and the dispatcher in `src/chart.js` decided again, for the footer.
The two decisions disagreed. A `null` was drawn as `0` by a bar, kept as a hole
by a heat map and dropped by a candle, while the footer called all three
"treated as 0". Two lookup tables, `ZERO_FILLED` and `SELF_REPORTING`, existed
only to reconcile the wording with the picture.

That produced three shipped bugs: a value reported as dropped that was drawn as
0; the same loss reported twice in different units; and `data` values silently
lost because the dispatcher did not know that key held values.

## Decision

A family declares, per kind of unreadable value, one **fate**:

- `zero` — draw it as 0 and say so.
- `hole` — keep the slot empty and keep alignment.
- `drop` — remove the point and report the loss.

`src/values.js` owns the rule and the table (`VALUE_POLICY`). The drawing and the
footer read the same declaration, so they cannot disagree. A family that prints
its own richer note (candle, heatmap, treemap) sets `selfReports` in the same
table, and the dispatcher stays quiet for it.

## Consequences

- The footer sentence is true by construction, not by a suppression table.
- A new family must declare a fate; `test/values.test.js` fails if it has none.
- `null` and `""` are not the same decision as `"x"`, because `Number(null)` is
  `0` while `Number("x")` is `NaN`. A family can zero one and drop the other.
- Scatter points use a stricter policy than series values: both ends must be
  numbers, so a labelled pair is dropped and counted rather than read as x=0.

## Alternatives rejected

- **One global fate.** Simple, but it changes what existing fences draw: a heat
  map with a missing cell would shift its row, and a candle with a missing price
  would draw a zero candle.
- **Keep per-family rules and make the footer ask each family.** That is what
  the two lookup tables were, and they drifted.
