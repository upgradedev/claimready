# Protocol v2, preregistered and not yet run

**Written 2026-09-01, before any v2 run exists.** Nothing in `runs/` was produced under it. It is
here because v1 produced a result that went against the page, and the two ways to respond to that
are to say what a fair second measurement would look like before running it, or to keep quiet.
This is the first.

`protocol-v1.md` is unchanged and stays the preregistration for the eighteen runs per arm that are
on disk. Those runs are not re-run, not re-scored and not removed.

## What v1 measured, and what it found

Across six synthetic scenarios, three runs each, an agent produced a policy complete first notice in
**5 of 18** runs with the page's published rules and **6 of 18** against a static form, with two
truth mismatches in arm A against none in arm B. Participants were language models, not people. The
diagnosis in `results.md` is that arm A left `damage_zone` unanswered in 9 of 18 runs.

## The three differences in v2, each with the reason

1. **The control is the form, not the file it lives in.** v1 handed arm B the whole of
   `static-form.md`, our methodology preamble included: the sentence claiming it is not a strawman,
   the union count, the naming of the two shipped rule packs. `run_impact.mjs` now slices the file
   at `## Motor claim, first notice` and sends only what a claimant would be handed. This makes the
   control cleaner and is expected to help arm B, not arm A.

2. **The preamble's own count was wrong and is corrected.** It said nine questions above a list of
   ten. Nine is the union `node scripts/measure_intake.mjs` counts across both packs plus the page's
   required list. The tenth, who was driving, is a box the page offers that no pack names. The list
   arm B saw is unchanged; only the sentence describing it moved, and it now sits outside the slice.

3. **`damage_zone` is the pre-registered primary diagnosis, not a post hoc one.** v1 found arm A
   losing on one field. v2 states in advance that the comparison of interest is the rate at which
   each arm answers `damage_zone` correctly, and that a v2 result is reported whichever way it goes.

## What is not changed, deliberately

The scenarios, the truth sheets, the scoring functions, the repeat count and the exclusion rule are
all as they are in v1. The tools the page publishes are not tuned for this study, and the arm A
prompt is not rewritten to hint at a clock position. A measurement that needs its own prompt
sharpened to win is not measuring the page.

## What would make v2 publishable

36 runs, same shape as v1, and `node scripts/analyze_impact.mjs --runs evidence/impact/runs-v2`
refusing a headline below that. Nothing is published from a partial set, and a v2 that also goes
against the page is published with the same wording as v1.
