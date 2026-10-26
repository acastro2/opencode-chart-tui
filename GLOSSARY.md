# Glossary

The words this repo uses for its own ideas. Architecture terms follow the
`codebase-design` vocabulary: **module**, **interface**, **implementation**,
**depth**, **seam**, **adapter**, **leverage**, **locality**. Do not substitute
"component", "service", "API" or "boundary".

## Drawing

**Fence** — the ```chart``` block in a message. Its body is JSON, read by the
parser in `src/chart.js`.

**Family** — one chart type: `bar`, `pie`, `gantt` … Each lives in one module and
exports `renderXRows(spec)`. There are 23.

**Spec** — the object a fence parses to. User input, plus a few keys the
dispatcher resolves before drawing (`width`, `theme`, `cellAspect`).

**Row** — one line of the drawing: `{ width, runs }`.

**Run** — a styled span inside a row: `{ text, slice, kind, color? }`. A run's
colour comes from its `kind`, never from the family.

**Frame** — the whole picture: the rows a family returns, after the dispatcher
has added notes and fitted the height.

## Layout

**Height contract** — `height` is the total rows of the block, notes included.
`plotHeight` is the exception: it names the rows the data may use.
`src/layout.js` owns the arithmetic.

**Chrome** — the rows around the plot that are not data: title, axis label row,
legend, notes. A family declares its chrome; it does not do the subtraction.

**Row budget** — the negotiation between the dispatcher and a family over how
many rows each owns. One ledger is the goal; two is the bug.

## Data

**Fate** — what a family does with a value it cannot draw. One of:
`zero` (draw it as 0), `hole` (keep the slot empty and keep alignment), `drop`
(remove the point and report the loss). Null, empty string and non-finite
values can have different fates in the same family.

**Coercion** — turning a fence value into a number under a declared fate. One
rule, one place.

**Loss note** — the muted footer line that says how many values were drawn as
zero, kept as holes, or dropped. It must agree with the picture by construction.

## Tests

**Gate** — one of the six checks that must stay green: `test`, `audit`,
`fidelity`, `golden`, `perf`, `accuracy`.

**Corpus** — the curated set of specs every gate reads. Adding one spec to the
corpus must reach every gate at once.

**Sample** — the one canonical fence per family that the gallery and README show.

**Variant** — an extra spec that exercises a shape the sample cannot: grouped,
stacked, multi-series, narrow, tight height.
