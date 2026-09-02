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
file committed beside this one. Nothing is published from a partial set, and a v2 that also goes
against the page would get published in the same words as v1.

**This folder stays empty for this submission, and that is a decision, not a delay.** The runner is
closed: `--spend-credits` refuses before it reads a key, because the `published-rules` arm was never
implemented and the `static-form` arm bills a request before it has the runtime facts its own
metadata gate requires. v2 is a preregistration. It contributes no number to anything a judge reads,
and the v1 result next door stands as the only measurement this entry has, negative as it is.

The v1 runs next door in `../runs/` are frozen. Nothing in this folder replaces them, and the
runner refuses an `--out` that resolves inside them.
