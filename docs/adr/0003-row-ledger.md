# ADR-0003: One row ledger

Date: 2026-10-26
Status: accepted

## Context

`height` means the total rows of the block. Each family enforced that itself,
with its own chrome formula: nine variants of `title + label row + legend + notes`.
On top of that the dispatcher subtracted the chart-level notes before calling the
family, and four families ran a second pass to reserve one more row for a note
they could only know after drawing. Two ledgers counted the same rows.

The consequences were quiet: pie and line appended notes with no reservation, so
a note at a fixed height was replaced by the generic guard; the second pass could
spend a plot row on a note that turned out not to be printed; gantt's rows were
reserved twice for the same notes.

## Decision

`layoutFor(spec, { title, labels, legend, notes, fallback, min, max })` in
`src/layout.js` is the only place that does this arithmetic. It returns
`{ plotRows, noteRows, chrome, total, truncated }`.

- Notes are paid for **before** the plot. A plot row that hides a warning is a
  worse trade than a shorter plot.
- `plotHeight` names the plot only and wins; notes are still counted.
- A family that cannot fit reports `truncated` instead of believing it stayed
  inside the height.
- A family that budgets its own whole block (gantt) is listed in `OWNS_HEIGHT`;
  the dispatcher then passes the full height and lets the family place the notes.
- A note only the drawing can discover (a dropped label, a hidden period) is
  still a two-pass: lay out, learn the count, lay out again with `notes + 1`.

## Consequences

- Nine chrome formulas and two ledgers became one call per family.
- Pie and line now keep their note inside `height`.
- The guard's sentence degrades in steps that fit the width (`1 row hidden`,
  then `1 row hidden at 4`, then the full text) instead of being cut mid-sentence.
- `measureVerticalBars` in `src/bar.js` takes `notes`, not `chrome`; it is the
  query histogram uses, and an out-of-tree caller passing the old option would
  silently lose the reservation.
- Six treemap frames at width 20 changed text: the old guard line was truncated.

## Alternatives rejected

- **Let the dispatcher own all notes.** It cannot know a family's legend or
  label rows, and it cannot know a note the drawing discovers.
- **Keep per-family arithmetic and only document the invariant.** That is what
  existed, and it drifted four separate ways.
