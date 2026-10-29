# ADR-0002: One corpus feeds every gate; goldens compare runs

Date: 2026-10-26
Status: accepted

## Context

Each gate built its own spec list. `scripts/samples.mjs` held one sample per
family, and audit, fidelity, perf, images, gallery and goldens each read it.
Goldens gained a `VARIANTS` list for grouped, stacked, multi-series and narrow
shapes, but nothing else saw it. Goldens also compared plain text only.

Two real bugs shipped through a green gate as a result: grouped vertical bars
drew from the first series' running total instead of zero, and a stacked area's
bottom band never painted (a one-series stacked area drew only its label). No
sample had more than one series, so the picture gate could not see either. A
colour or `kind` regression would still pass today, because text does not change.

## Decision

- `scripts/corpus.mjs` owns the specs: the gallery `SAMPLES`, the `VARIANTS`,
  and `edgeSpecs()` for shapes the gallery cannot show. Every gate reads it.
- Goldens store two things per family and variant: the text frames (954) and the
  **run frames** (34 at width 56, dark) — `{ text, kind, slice, fg, bg }` per run
  through `styleOf`. A kind demotion or a colour swap fails without a text diff.
- `dump.mjs` and `images.mjs` stay on the gallery samples, because their
  output is the README gallery, not a test surface.

## Consequences

- Adding one spec to the corpus reaches goldens, audit, fidelity and perf at once.
- Audit grew from 42 to 58 cases, fidelity from 26 to 45 checks, perf from 23 to
  27 specs. More assertions, no new harness.
- `golden:update` is a reviewed action: it now rewrites run frames too, so a
  colour change shows up as a diff instead of passing.
- A gate that builds its own spec list is a bug: it can silently lose coverage.

## Alternatives rejected

- **Keep `VARIANTS` in goldens only.** Cheapest, but leaves the other five gates
  unable to see the shapes that already failed once.
- **Compare images instead of runs.** Slower, and it would test the SVG writer
  rather than the renderer.
