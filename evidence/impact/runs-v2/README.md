# Protocol v2 runs

Empty on purpose. No v2 run has happened.

The protocol is `../protocol-v2.md`, the runner is `../run_impact_v2.mjs`, and what it is answering
for is in `../errata-v1.md`. Records land here as `<scenario>__<arm>__<repeat>.json` and carry the
contract `claimready.impact.run.v2`.

Scored with:

    node scripts/analyze_impact.mjs \
      --runs evidence/impact/runs-v2 \
      --out evidence/impact/results-v2.md \
      --contract claimready.impact.run.v2

Over an empty folder that writes AWAITING_RUNS and exits 1, which is the correct state and is the
file committed beside this one. It will keep saying that until all 36 records exist and every one of
them carries the metadata v1 lost. Nothing is published from a partial set, and a v2 that also goes
against the page gets published in the same words as v1.

The v1 runs next door in `../runs/` are frozen. Nothing in this folder replaces them, and the
runner refuses an `--out` that resolves inside them.
