# Protocol v1: does publishing the policy's rules make the first notice more complete?

**Preregistered.** This file, `scenarios.json` and the truth sheets were written and committed
before a single run happened. The commit that adds them is the preregistration, and it is the one to
check if you want to know whether the measure was chosen after seeing the numbers.

## What this measures, and what it does not

It measures **one** thing: given the same incident described in a claimant's own words, does an agent
produce a first notice that is complete under this insurer's own rules more often when the page
publishes those rules as typed tools than when it sees an ordinary static intake form.

It does **not** measure time, effort, satisfaction, call deflection, handler workload, cost, or
anything about real claims. The participants are **language models, not people**. Every sentence
this produces has to say so, and the analyser refuses to print a headline that does not.

Nobody has run ClaimReady on a real intake. That limitation is stated in the README and in the
submission description and this study does not remove it.

## The two arms

Both arms get the same scenario brief, written the way a driver would say it, and the same model at
the same settings. What differs is only what the agent is given to work with.

| | Arm A, published rules | Arm B, static form |
|---|---|---|
| What the agent sees | the deployed page's WebMCP tools, discovered at runtime | a plain motor first notice form, the union of the fields such a form has to carry |
| Where the policy's requirements come from | the page, through `get_requirements` and the tool descriptions | nowhere. A static form cannot know which policy it is looking at |
| How the answers are written | `apply_claim_patch`, through the page's own rules | returned as field values |

Arm B is deliberately **not** a strawman. It is handed the same field set, the same enumerations and
the same help text the page's own controls carry, which is what a well built generic form has. It is
shipped as `static-form.md` so a reader can see exactly what it saw. What it is not handed is
anything about *this* policy, because a static form does not have it.

## Scoring, identical for both arms

Each run ends with a set of field values. Those values are put through the same functions the page
uses, with the Northwind pack loaded:

- `ready`: `canFile` says the draft could be filed.
- `open_requirements`: how many of the insurer's derived requirements are still open, and which.
- `truth_mismatches`: fields whose value contradicts the scenario's truth sheet. Written before any
  run, and checked mechanically rather than by reading.
- `turns`: how many model turns the run took.
- `tool_calls`: how many tool calls it made, and whether any of them was refused.
- `human_only_respected`: whether the run ever attempted to file, pin or dispatch through a tool.
  There is no such tool, so an attempt is a refusal, and a run that never tries is not evidence of
  restraint.

## Fixed before running

- **Scenarios**: six, in `scenarios.json`. Two are the common case, two put the car off the road,
  one is a theft, one is a structural collision. They exercise the conditional requirements that a
  static form cannot know about.
- **Repeats**: three per scenario per arm, because a model is not deterministic. 36 runs.
- **Order**: arms alternate per scenario, so neither arm always runs first against a warm cache.
- **Model**: recorded in every row. A run is only comparable to another run with the same model.
- **Exclusions, defined now**: a run that fails for a transport reason, an API error or a browser
  that did not start, is recorded as `technical_failure` and kept in the file. It is excluded from
  the completeness counts and reported separately. Nothing else is excluded. There are no reruns of
  a run that produced an answer, however bad the answer.
- **No cherry picking**: every run is written to the results file as it happens, including the ones
  that make the page look worse.

## What a result may say

Counts and medians over six scenarios. No significance testing, no confidence intervals, no
extrapolation to real claimants or to any population. The sentence template the analyser will fill,
and the only shape a headline may take:

> Across six synthetic scenarios, three runs each, an agent produced a policy complete first notice
> in X of 18 runs with the page's published rules and Y of 18 against a static form. Participants
> were language models, not people.

Until real runs exist, `results.md` says `AWAITING_RUNS` and the readiness gate for impact evidence
stays open.
