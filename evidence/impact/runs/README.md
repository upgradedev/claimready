# Runs

One JSON file per run, named `<scenario>__<arm>__<repeat>.json`, written by
`evidence/impact/run_impact.mjs` and scored by `scripts/analyze_impact.mjs`.

**Nothing here is edited by hand.** A run that produced an answer is kept whatever the answer was,
including the ones that make the page look worse, and a run that failed for a transport reason is
kept too with `technical_failure: true` so the count of failures is visible rather than absent.

The dry runs that shaped the instrument are deliberately **not** here. They were made while the
harness still had the refusal detection bug described in `../protocol-v1.md`, and a set that mixes
runs from two different instruments measures the instrument.
