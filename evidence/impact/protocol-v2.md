# Protocol v2, preregistered and not run

**Written 2026-09-01, before any v2 run exists.** Nothing in `runs/` was produced under it and
`runs-v2/` is empty. It is here because v1 produced a result that went against the page, and the two
ways to respond to that are to say what a fair second measurement would look like before running it,
or to keep quiet. This is the first.

**Marked NON OPERATIONAL on 2026-09-02, and it will stay that way through this submission.** This
document is a preregistration and it is the only thing v2 is. The runner behind it cannot produce a
run: the `published-rules` arm was never implemented and throws where its loop should be, and the
`static-form` arm sends its request before anything has read the runtime facts, so the record is
refused at the metadata gate after the call has already been billed. Rather than leave that
reachable, `--spend-credits` refuses outright, before it reads a key and before anything touches the
network. The three conditions for reopening it are written at the top of `run_impact_v2.mjs`.

**Nothing in this entry is measured, scored or claimed from v2.** There is no readiness row for it,
no number in any judge-facing document comes from it, and `results-v2.md` says `AWAITING_RUNS` over
a table of zeros because that is the true state. The v1 result stays what it is, which is negative
and published. A second protocol existing on paper does not soften it.

`protocol-v1.md` is unchanged and stays the preregistration for the eighteen runs per arm that are
on disk. Those runs are not re-run, not re-scored and not removed. Everything v1 got wrong, left out
or did not do is in `errata-v1.md`, and the rules below are mostly that list turned into gates.

## What v1 measured, and what it found

Across six synthetic scenarios, three runs each, the values a model produced were combined with
three answers already on the file, and that combination was policy complete in **5 of 18** runs with
the page's published rules and **6 of 18** against a static form, with two truth mismatches in arm A
against none in arm B. Without those three answers both arms are zero. Participants were language
models, not people. The diagnosis in `results.md` is that arm A left `damage_zone` unanswered in 9
of 18 runs.

## The differences in v2, each with the reason

1. **The control is the form, not the file it lives in.** v1 handed arm B the whole of
   `static-form.md`, our methodology preamble included: the sentence claiming it is not a strawman,
   the union count, the naming of the two shipped rule packs. `formOnly` in `form.mjs` slices the
   file at `## Motor claim, first notice`, and the v2 runner sends only what a claimant would be
   handed. This makes the control cleaner and is expected to help arm B, not arm A.

2. **The preamble's own count was wrong and is corrected.** It said nine questions above a list of
   ten. Nine is the union `node scripts/measure_intake.mjs` counts across both packs plus the page's
   required list. The tenth, who was driving, is a box the page offers that no pack names. The list
   arm B saw is unchanged; only the sentence describing it moved, and it now sits outside the slice.

3. **`damage_zone` is the pre-registered primary diagnosis, not a post hoc one.** v1 found arm A
   losing on one field. v2 states in advance that the comparison of interest is the rate at which
   each arm answers `damage_zone` correctly, and that a v2 result is reported whichever way it goes.
   The analyzer already prints that endpoint, including for the v1 runs, so the ruler exists before
   the candidate does and cannot be shaped around a v2 result.

4. **The seeding is declared, and both readings are reported.** The scorer starts every draft from
   the demo fixture, which carries `incident_date`, `incident_type` and `driver`. v2 does not change
   that, because changing it would make v1 and v2 incomparable. It requires instead that every v2
   report prints the seeded counts and the no seed counts side by side, exactly as `results.md` now
   does, and that no sentence anywhere describes the seeded count as work an agent did. A v2
   headline that omits the no seed line is not publishable.

5. **The order is a sequence, not the word "alternate".** v1 said arms alternate per scenario and
   the runs went A, B, B, A, A, B in every scenario. v2 fixes the order literally:

       repeat 1: published-rules, then static-form
       repeat 2: static-form, then published-rules
       repeat 3: published-rules, then static-form

   and any departure is recorded on the row rather than described afterwards.

6. **A record without its metadata is not written at all.** `run_impact_v2.mjs` refuses to write a
   record that is missing the exact model snapshot, the request settings, the response ids and
   fingerprint, the page URL, the browser version, or a build SHA read back out of the running page.
   v1 kept none of the six and the errata is what that costs. A run that happens and cannot be
   written is a run that was wasted, which is the correct price and is cheaper than a set of records
   nobody can reproduce.

7. **`attempted_human_only` is gone.** v1 listed `human_only_respected` under scoring and never
   measured it: the runner wrote the literal `false` on every record. v2 carries no such field.
   If restraint is ever to be measured, something has to watch the tool calls for an attempt to
   file, pin or dispatch, and until that exists the honest number of measurements is none.

8. **A v2 run cannot happen at all.** It began as "cannot happen by accident": the default mode is a
   dry run with a stub transport, and spending took `--spend-credits` plus an `--out` outside the
   frozen v1 folder. Since 2026-09-02 `--spend-credits` refuses outright, before the key is read and
   before any request, because the two arms behind it cannot produce a usable record and a spend
   that buys nothing is worse than no spend. `node evidence/impact/run_impact_v2.mjs --selftest`
   still exercises every guard with no key, no browser and no requests.

9. **The metadata gate counts meaning, not presence.** It used to accept any non-empty string, so
   the dry run's own notices satisfied it and a dry-run record read as complete. Values that are
   plainly not measurements are refused now. That is narrow: it catches the placeholders written
   here and the words a person types when they have no value, and it cannot catch a plausible
   string that is simply wrong.

## What is not changed, deliberately

The scenarios, the truth sheets, the scoring functions, the repeat count and the exclusion rule are
all as they are in v1. The tools the page publishes are not tuned for this study, and the arm A
prompt is not rewritten to hint at a clock position. A measurement that needs its own prompt
sharpened to win is not measuring the page.

## Why v2 cannot run today

`verified_runtime_sha` has to come out of the running page, and the page publishes no build SHA that
a script can read. Wiring arm A to v2 waits on that, and the runner says so rather than falling back
to a SHA typed on the command line. v1 has one of those already and the errata explains why it is
worth nothing.

## What would make v2 publishable

36 runs, same shape as v1, and

    node scripts/analyze_impact.mjs \
      --runs evidence/impact/runs-v2 \
      --out evidence/impact/results-v2.md \
      --contract claimready.impact.run.v2 \
      --interpretation evidence/impact/interpretation-v2.md

The last flag is not optional and leaving it off is not a small mistake. The analyzer falls back
to the v1 interpretation file, which carries v1 counts, so the command without it writes a v2
report asserting a v1 result underneath `AWAITING_RUNS` and a table of zeros. That is not
hypothetical. It is what the committed `results-v2.md` said until 2026-09-01, when a reviewer
ran the published command and read what came out.

refusing a headline below that. Today it refuses over an empty folder, which is the committed state
of `results-v2.md`. Nothing is published from a partial set, and a v2 that also goes against the page
is published with the same wording as v1.
