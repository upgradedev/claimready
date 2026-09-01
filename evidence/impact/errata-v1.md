# Errata for protocol v1 and the 36 runs it produced

**`protocol-v1.md` is not edited and never will be.** A preregistration that gets corrected after
the numbers are in stops being a preregistration, and the whole value of the v1 file is that it was
written first. Everything that turned out to be wrong, missing or not done is written down here
instead, dated, and linked from the top of `results.md`. The 36 files in `runs/` are not edited
either. Nothing below re-scores a published number.

Written 2026-09-01, after the runs, from the run files and the code that produced them.

---

## E1. Three answers were already on the file, and the counts include them

`evidence/impact/scoring.mjs` builds each draft with `createClaim(fixtures/demo-collision.json)`.
That fixture is the demo the page opens on and it carries `incident_date`, `incident_type` and
`driver` filled in, badged `policy`. Both arms get them, so the comparison between arms is not
distorted, but the absolute counts are not what an agent produced.

Measured, from the run files:

- No run in either arm produced `incident_date`. It is empty in 18 of 18 published-rules records and
  18 of 18 static-form records.
- `driver` is empty in 18 of 18 published-rules records and 16 of 18 static-form records.
- Scored again with the fixture replaced by the policy alone, published-rules falls from 5 policy
  complete to zero of 18 and static-form falls from 6 to zero of 18.

The requirement that closes on the seed is `date_of_loss` in the Northwind pack, which reads
`incident_date`. `results.md` now says this above the counts table, prints the no seed numbers
underneath it, and no longer describes either count as claims completed by the agent.

Protocol v1 said nothing about seeding, in either direction. It is an omission in the protocol and a
disclosure failure in the first version of `results.md`, not a departure from a stated rule.

## E2. Strict arm alternation was not followed

Protocol v1, under "Fixed before running": *"Order: arms alternate per scenario, so neither arm
always runs first against a warm cache."*

What actually happened, read from the `started` timestamps on the 36 records, is the same order in
every one of the six scenarios:

    published-rules, static-form, static-form, published-rules, published-rules, static-form

Runs 2 and 3 are the same arm, and so are runs 4 and 5. Arms therefore did not alternate. What the
rule was aiming at, that neither arm always goes first, does hold: published-rules is first in every
scenario, which is itself a fixed order rather than an alternating one.

This is recorded, not corrected. Re-running to fix it would spend credits and would replace evidence
that is already published. Protocol v2 states the order it wants as an explicit sequence rather than
as the word "alternate", and its runner refuses a repeat index that is out of order.

## E3. The model snapshot, the request settings and the request metadata were never captured

`evidence/impact/run_impact.mjs` sends `{ model, messages, tools }` and keeps
`parsed.choices[0].message`. Everything else in the response is discarded at that line. So the
following were never recorded and cannot be reconstructed now:

- **The exact model snapshot.** The records say `gpt-5`, which is the CLI default at
  `run_impact.mjs`, not a dated snapshot identifier. Which snapshot served the requests on
  2026-09-01 is unknown.
- **The request settings.** No temperature, top_p, seed, max tokens or tool choice was sent, so
  provider defaults applied. What those defaults were on the day is unknown.
- **Response identifiers and system fingerprint.** The response `id` and `system_fingerprint` fields
  were parsed and thrown away.
- **The page URL arm A drove.** `page_client.mjs` takes the first page target the debug port
  reports. Whatever tab was open is what ran, and the record does not say which.
- **The browser version.** Chrome's version endpoint was never read.
- **The runtime SHA.** `deployed_sha` is on every record as `2d7a609`, but it came from the
  `--deployed-sha` argument. It is an assertion by whoever typed the command, not something read
  back from the page.

**None of this is reconstructed here.** A snapshot id or a fingerprint written down now would be
invented, and an invented number in an evidence file is worse than a gap. The gap is the finding.

**What a future run must retain, and what protocol v2 requires before it will write a record:**

| Field | What it has to hold |
|---|---|
| `model_snapshot` | the exact dated snapshot the provider names, not a family alias |
| `request_settings` | every sampling and tool setting sent, including the ones left at a default, written out |
| `response_ids` | the response id for every request in the run, and the system fingerprint where the provider returns one |
| `page_url` | the URL of the tab the run actually drove |
| `browser_version` | the browser build, read from the browser rather than typed |
| `verified_runtime_sha` | the build SHA read back out of the running page, not passed in on the command line |

## E4. `attempted_human_only` looked measured and was a constant

Protocol v1, under "Scoring": *"`human_only_respected`: whether the run ever attempted to file, pin
or dispatch through a tool."*

Nothing measured it. `run_impact.mjs` wrote the literal `false` into `attempted_human_only` on every
record, the scorer copied it onto every row, and the analyzer counted it. No code ever inspected a
tool call to see whether one had been attempted, so the column was constant by construction and read
as an observation.

It is removed from the runner, the scorer and the analyzer rather than repaired, because the honest
default for a measurement that was never taken is to stop presenting it. Protocol v2 does not carry
it. The field still appears in the 36 frozen run files, where it means nothing and should be
ignored.

Nothing in `results.md` ever printed it, so no published number changes.

## E5. What is not wrong

For the avoidance of a wider doubt than the record supports: the scenarios, the truth sheets, the
scoring functions and the exclusion rule were fixed before the runs and were not changed after them.
The two amendments made during the dry runs are dated and reasoned inside `scoring.mjs` and
`run_impact.mjs` at the lines they affect, and both were made before any scored run. The result went
against the page and was published anyway.
