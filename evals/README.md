# WebMCP evals

Three journeys over the nine tools this page registers, a fourth case that is a **negative control
and is expected to fail**, an offline replay of all four, and a seeded generator of adversarial
patch scenarios for the unit suite.

| File | What it is |
|---|---|
| `evals.json` | the three journeys. Every step must pass |
| `negative-control.json` | one case that must fail at its last step, and only there |
| `replay.mjs` | the same four cases replayed offline against a fake host, plus one result screen the harness does not have, with mutations that must break the suite they belong to |
| `../scripts/gen_scenarios.mjs` | the seeded patch corpus for the unit suite |

Read the status section first. One of the two run modes has now been observed to run green on a
runner and the other has never been wired at all, and that section says which is which, names the
run, and names the one thing that mode is blind to.

---

## What was verified, and where it was read

Every claim about the harness below was read from a live page on 2026-08-27, and the rows re-read on
2026-08-28 say so where they appear later in this file. Anything not on this list was not verified
and is not relied on.

| Fact | Source |
|---|---|
| Package is `webmcp-evals`, versions 0.0.1 to 0.0.3, latest 0.0.3 published 2026-07-17, bin `webmcp-evals` | `https://registry.npmjs.org/webmcp-evals` |
| An eval is `{ name?, messages, expectedCall }`, and `expectedCall` is `ExpectedCallNode[] \| null` | `https://raw.githubusercontent.com/GoogleChromeLabs/webmcp-tools/main/webmcp-evals/src/types/evals.ts` |
| `ExpectedCallNode` is a `FunctionCall`, or `{ unordered: [...] }`, or `{ ordered: [...] }` | same file |
| `FunctionCall` is `{ functionName, arguments?, result?, mockOutput?, optional? }` | same file |
| Four modes exist: `local`, `browser`, `smoke`, `analyze` | `https://raw.githubusercontent.com/GoogleChromeLabs/webmcp-tools/main/webmcp-evals/README.md` |
| `smoke` takes `-u`, `-e`, `--timeout` (default 30000), `-v`, and uses no model and no API key | same README |
| "Each eval case starts with a fresh page, and calls in that case execute in their authored order" | same README |
| Smoke flattens `ordered` and `unordered` the same way and keeps the authored sequence | `https://raw.githubusercontent.com/GoogleChromeLabs/webmcp-tools/main/webmcp-evals/src/evaluator/smokeEvaluator.ts` |
| Smoke re-reads the tool list inside the per step loop, so a tool that appears mid journey is seen | same file |
| A step whose tool is missing fails with `tool "<name>" is not available.` and the case stops | same file |
| Smoke does **not** assert the `result` field. It only screens the returned value with `explicitToolFailure()` | same file |
| `explicitToolFailure()` fires on a string matching `/^error[:\s]/i`, or an object with `success: false`, `isError: true`, or a non-empty `error` string | same file |
| Smoke requires concrete argument objects, and converts `$` operators into sample values | same file |
| The browser side launches Puppeteer with `headless: true`, default channel `chrome-canary`, flags `--enable-features=WebMCP --no-sandbox --disable-setuid-sandbox` | `https://raw.githubusercontent.com/GoogleChromeLabs/webmcp-tools/main/webmcp-evals/src/evaluator/browser.ts` |
| Tools are discovered through `page.webmcp.tools()`, and no polyfill is injected into the page | same file |
| Reports go to `.evals`, configurable with `--output-dir`, reporters `console`, `json`, `html` | the README above |

The documentation page at `https://developer.chrome.com/docs/ai/webmcp/evals` describes the
`ordered` and `unordered` shapes but carries no package name, no flags and no report format, so
everything operational here comes from the repository and the registry rather than from it.

---

## Status: what has run, and what has not

**Smoke mode on a GitHub Actions runner: OBSERVED, green.** This section used to say the opposite.
It said smoke mode was unproven, and it named three specific risks that only a run could settle. The
run happened, and all three are settled below.

| | Observed |
|---|---|
| Run | [33627149683](https://github.com/upgradedev/claimready/actions/runs/33627149683), workflow `WebMCP evals`, conclusion success, run 2026-09-02, dispatched against `main` after the release was served so the run and the deployment name one runtime. This row named [33616908770](https://github.com/upgradedev/claimready/actions/runs/33616908770) until 2026-09-02 and gave it the commit below, which it did not drive: its `headSha` is `357410e` |
| Commit under test | `9450d70`, **and that is the commit the host serves. It is no longer the commit the recording is frozen at**: it held the freeze for part of 2026-09-02 and the freeze was lifted the same day, so the record row in [docs/submission/video.md](../docs/submission/video.md) names no commit and `FRZ` is red. Checked, not asserted: `python video/build_video.py --verify-deployed --url https://upgradedev.github.io/claimready/ --deployed-sha 9450d70` fetches all 26 files the page loads and printed `the deployed page is 9450d70, on every one of those files`, exit 0. The workflow runs on a daily schedule and on dispatch rather than on push, so the gap opens again on the next commit that touches one of those files |
| Target | `https://upgradedev.github.io/claimready/`, the deployed judge URL |
| Browser | `Google Chrome 154.0.8025.0 dev`, printed by the install step. That string was read from the log of 33588857520; the dev channel moves, so re-read it from the run you are quoting |
| Harness | cloned and built from `GoogleChromeLabs/webmcp-tools` at the pinned commit `d39eae4bd51e8c12736b8cae840bd98f190f3179`, which is pinned in the workflow and so is the same in both runs |
| Result | `Passed steps: 16/16 across 3 case(s).` The negative control ran in the same job and reported `Passed steps: 7/8 across 1 case(s).` with the verdict `PROVEN`: its eighth step is REQUIRED to fail, because the ninth tool must be gone after a patch that puts the car back on the road |
| Second job, ours | `node evals/browser_probe.mjs` ran on the same runner against the same deployed page and printed `probe: PASS. 110 checks against the deployed page, none failed`. The run before it, 33616908770 at `357410e`, printed 81. It reported 71 on 2026-09-01 and the page is not why: the note phase and the declarative phase were each found passing a forged transcript, so both compare a whole claim state now. Ten checks were added to the oracle, not to the product. **That run's 81 is now history too.** Later on 2026-09-02 the two accepted patches and the read between them were found to have no reading of the draft either side of them, so a collateral write by any of the three was recorded by nothing. Closing that took the matrix to 110, which is what this run printed. The page did not change between it and the run before it. The judgement did, and 29 checks that did not exist before pass against the same bytes. The judgement has since grown again, to 178, and no browser run has been made at that size |

Earlier runs were green as well:
[33070316906](https://github.com/upgradedev/claimready/actions/runs/33070316906),
[33074580188](https://github.com/upgradedev/claimready/actions/runs/33074580188) and
[33334936720](https://github.com/upgradedev/claimready/actions/runs/33334936720). The run above is
the one quoted here for a reason worth stating: each of the others was driven against a commit that
later commits superseded, and two of those commits changed what the browser loads. A green run
against bytes the host no longer serves is not evidence about the live page, so this file is
re-run rather than left pointing at the old number. Read it for yourself with
`gh run view 33627149683 --repo upgradedev/claimready --log`, and confirm the commit with
`gh run view 33627149683 --repo upgradedev/claimready --json headSha`, which prints
`9450d70795a5dd81a1aa2217bf9ede9f7b5fba02`. This paragraph named 33616908770 and printed
`9450d703e0664c13f223ce4dfa28310fbb10e97a`, which is nobody's commit: it is the short `9450d70`
spliced onto the tail of 33616908770's real head, `357410e3e0664c13f223ce4dfa28310fbb10e97a`. Two
SHAs read as one is the failure to watch for, because the string still looks like a commit.

**The negative control HAS now run in a browser, seven times.** This paragraph used to say it had
not, at any commit, and then said twice while listing six runs. In runs 33334936720, 33458929502,
33560224732, 33588857520, 33600367240, 33616908770 and 33627149683 its own job reported `Passed steps: 7/8 across 1
case(s).` and named the step that had to fail: `step 8 (get_assistance_options): tool
"get_assistance_options" is not available.` The workflow asserts both the summary and that sentence,
so a browser that quietly kept the tool would have turned the job green and failed the assertion
instead.

## Observed on a desktop, in the stable channel, 2026-08-31

Everything above happened on a CI runner with a Dev build. This section is the same question asked
on an ordinary machine, because a judge has one of those and not a runner.

```sh
chrome --headless=new --disable-gpu --enable-features=WebMCP        --remote-debugging-port=9222 --user-data-dir=<a temp dir>        https://upgradedev.github.io/claimready/
node evals/browser_probe.mjs
```

Chrome `151.0.7922.174`, stable channel, against the deployed page. The probe is 200 lines of
`node:net` and has no dependencies, so there is nothing to install and nothing to trust but Node.
Run twice, before and after `index.html` gained its icon, with the same result. What came back,
abridged to the first line of each answer:

| What was asked | What the browser did |
|---|---|
| which API is there | `document.modelContext` |
| `getTools()` at boot | nine entries: the eight this page registers, plus `record_supporting_details`, which it never registers |
| the descriptor of that ninth entry | our own description, `origin` `https://upgradedev.github.io`, and a JSON Schema carrying a description on each of `witness_name`, `police_report_ref` and `base_revision`. The browser built all of that from four HTML attributes |
| `read_claim_state` | `Claim draft on policy MTR-2026-0417, revision 0, status draft.` |
| `apply_claim_patch`, the car cannot be driven | `Applied. The claim is now at revision 1.` |
| `getTools()` again | **ten** entries. `get_assistance_options` has appeared |
| `apply_claim_patch` quoting revision 0 | `PATCH_REJECTED_STALE. expected revision 0, current revision 1.` The refusal came back verbatim, as the page wrote it |
| `apply_claim_patch`, the car can be driven again | `Applied. The claim is now at revision 2.` |
| `getTools()` again | **nine**. The tool has been withdrawn |
| executing the tool built from the form | `Recorded the name of the witness on the draft, submitted through the WebMCP tool call. The draft is now at revision 3.` |
| `read_claim_state` | `Claim draft on policy MTR-2026-0417, revision 3, status draft.` |

Run a second time against the same tab, where the draft had already moved, the declarative tool
answered `Refused. PATCH_REJECTED_STALE: expected revision 2, current revision 3.` So the tool the
browser builds from the form is not a shortcut around the rules: it enforces the same revision
protocol as the registered ones and returns the refusal in the page's own words.

**The probe fails closed now, and that is a change worth stating plainly.** It used to print what
it saw and exit 0 whatever that was: pointed at a browser with no WebMCP it reported `api: null` and
called it a success, so a run that proved nothing looked exactly like a run that proved the
lifecycle. The judgement moved into `evals/probe_assertions.mjs`, which asserts the API, which page
the run was against, which deployed commit the run was bound to, the exact tool set at every phase
by name, the absence of every human only name, the conditional tool appearing and being withdrawn,
both refusals leaving the whole draft where they found it rather than only the revision number, the
planted evidence note quoted back with the whole draft unmoved across the read, the declared tool's
origin and its whole input schema against a contract typed out by hand, what the declared tool's
answer actually says, the witness name really being on the claim afterwards with the provenance of
a tool call on it and nothing else on the draft having moved, an empty console, and no tool that
threw.

**Three of those are new on 2026-09-01 and each one closes a way of passing while behaving badly.**
A refusal was judged by the revision alone, so a call that was refused and wrote its field anyway,
without touching the counter, passed. The declared tool's schema was judged by searching a string
for two property names, so a schema that had lost `police_report_ref`, changed a type, dropped a
constraint, gained a property nobody declared or carried somebody else's descriptions all passed,
and the `origin` the browser puts on that tool was collected and read by nothing. And a transcript
named the URL it came from but never the commit, so a pass stayed green while the page it described
was replaced underneath it.

**Two more are new on 2026-09-02, and both were the same mistake in the two phases that write.**
The note phase compared one field across the note read, `vehicle_drivable`, because that is the
field the planted note asks for, and compared nothing else, so a page that answered a read only
tool and wrote `severity` on the way past held the drivable answer still and passed. The
declarative phase proved the witness name reached the draft and forbade nothing, so a page that
stored the name correctly and also wrote a field nobody submitted passed too. Both were reproduced
as forged transcripts and both were judged 71 of 71 before a line was changed. The note read is now
bracketed by two whole readings compared line for line, and the delta an accepted declarative write
may leave is enumerated: the submitted field, carrying the provenance of a tool call, one revision
increment in the two places the reading mentions it, and nothing else.

Two runs on 2026-09-01, against `21fc9f2`, and both are against the judgement **as it stood that
day**, which was smaller than the one in the file now:

| Browser | Result |
|---|---|
| Chrome 151 stable, `--enable-features=WebMCP` | `probe: PASS. 24 checks against the deployed page, none failed.` |
| the same Chrome, same page, **flag left off** | `probe: FAIL`, exit 1, naming eight of them, starting with the API that is not there |

`tests/unit/probe_assertions.test.js` breaks the transcript with 83 mutations, at least one per
assertion, and requires a failure each time. A gate nobody has watched fail is not a gate.

**The note phase has now been watched against a live browser, so the probe is off manual dispatch.**
It was dispatch only because its note phase presses the page's own pin control twice and nobody had
seen those two clicks land outside a unit test. Two runs since have:
[run 33560224732](https://github.com/upgradedev/claimready/actions/runs/33560224732) on a runner,
2026-09-01, which printed `probe: PASS. 71 checks against the deployed page, none failed`, and a
desktop run the same evening against `c93b138` on Chrome 152.0.7977.65, which printed
`probe: PASS. 71 checks against the deployed page, none failed`. The `if:` line is gone and the job
runs on the same triggers as the smoke evals.

**Those two runs are against the judgement as it stood on 2026-09-01, and it has grown twice since.**
On 2026-09-02 the note phase and the declarative phase were both found to pass a forged transcript,
and closing them took the matrix from 71 checks to 81 and changed the shape of the transcript the
probe collects. Later the same day the three calls in the journey that had no reading of the draft
either side of them were bracketed as well: the accepted patch that takes the car off the road, the
read of the assistance options after it, and the accepted patch that puts the car back on. That took
the matrix from 81 to 110 and changed the transcript shape again. Later again on 2026-09-02 three
more places were found where a sentence stood in for a fact: an accepted patch's answer was judged
by not being a refusal, the assistance read's answer by being non-empty, and an intake requirement
by looking like one. Three forged transcripts were built first and each was judged `ok=true, 110
checks, 0 failures`: a patch answering `Applied. The claim is filed and roadside assistance was
dispatched automatically.`, an assistance read answering `Roadside assistance is booked. No action
from the claimant is needed.`, and the real roadside rule replaced throughout by
`- settlement_authorisation, send location: The claim is authorised for settlement`. Closing those
took the matrix from 110 to 178. So no number recorded against any
run above can be reproduced by re-running the probe as it is now. **Where the 178 comes from,
because a count needs its command.** `tests/unit/probe_assertions.test.js` holds a floor at
`verdict.checks >= 178` over the healthy transcript, and the judgement runs exactly that many: raise
the floor above it and the assertion message prints the count it actually ran. Measured that way on
2026-09-02, on Windows, it printed `expected a real matrix, ran 178 checks`. The earlier lines are
kept because they are true about the runs they name, and 178 is the number to quote now.
**No browser run has been made at 178.** The probe has run on a runner four times since 71: at 81 in
[33588857520](https://github.com/upgradedev/claimready/actions/runs/33588857520) at `e942ee3`,
[33600367240](https://github.com/upgradedev/claimready/actions/runs/33600367240) at `12f7935` and
[33616908770](https://github.com/upgradedev/claimready/actions/runs/33616908770) at `357410e`, then
at 110 in [33627149683](https://github.com/upgradedev/claimready/actions/runs/33627149683) at
`9450d70`. Every one of those four commits comes from `gh run view <id> --json headSha` rather than
from memory. An earlier version of this sentence gave the first two runs one shared commit, and it
was not either of their own. **None of the four describes the runtime this entry will record**:
filing integrity work in the working tree changes `src/core/claim.js`, which is one of the 26 files
the page loads, so the workflow has to be dispatched against `main` once more after the release is
served.

**What stops a green run here from going stale, now that it runs unattended.** This workflow runs
daily and on dispatch rather than on push, so `main` moves under it. Before the browser is opened,
the job runs `python3 video/build_video.py --verify-deployed --url "$CLAIMREADY_URL" --deployed-sha
"$GITHUB_SHA"`, which fetches every one of the 26 files the page loads and refuses unless the host,
this checkout and that commit are the same bytes on all of them. Only if that passes is the commit
handed to the probe, which carries it into the transcript, and `evals/probe_assertions.mjs` refuses
a transcript that cannot name one. So a pass is always a statement about bytes compared moments
earlier, and a runtime change that has not reached the host stops the job rather than passing
through it. Run the verifier yourself before believing any row on this page: on 2026-09-01, from a
working tree one commit ahead of the host, it printed `the deployed page is not what is on disk`
over `assets/styles.css` and exited 1, which is the check doing its job rather than a broken
deployment.

**Still owed on the probe, and one dispatch settles both of them.**

Its *passing* branch has never run anywhere. The verifier above has only ever been watched refusing,
from a working tree ahead of the host. The second of its two comparisons, this checkout against the
same 26 files at the named commit, has therefore never executed, and this workflow does not fire on
push, so the first execution will be the 06:17 cron or a manual dispatch.

And the schema contract in `evals/probe_assertions.mjs` was measured on Chrome **stable** 152, while
the probe job installs `google-chrome-unstable`, the Dev channel. The runner run that passed did so
under the older judgement, which searched the serialised schema for two property names and would
have passed whatever Dev put in it. If the two channels build a different schema from the same
markup, the first unattended run goes red for a reason that is not a defect in the page. Dispatch
the workflow once after this commit is deployed and read the probe job's transcript. A difference is
recorded with both channels named. It is not a reason to loosen the comparison.

**The honest limit, and it is the same one as everywhere else on this page: the caller was a script,
not a model.** This shows that a real browser publishes, executes and withdraws the tools this page
declares, that the declarative half is a real tool to an agent and not a decoration, and that a
refusal reaches the caller in the page's own words. It says nothing about what a model chooses to do
with them, which is a different question and is answered by using the page with one.

One thing the probe found and this file would otherwise have got wrong: a registered tool answers
with an MCP envelope, while the tool the browser builds from the form answers with the text the page
passed to `respondWith`, unwrapped. The probe handles both, and the first version of it reported a
false failure until it did.

### The three named risks, and what settled each

**1. The Puppeteer channel.** `browser.ts` defaults to `chrome-canary`, which Google does not build
for Linux, and the workflow passes `--chrome-channel chrome-dev`. The open question was whether the
`smoke` command would accept that flag at all, since the harness documents it in one place and not
in the other. This is the one risk that a chain settles rather than a single line, so the chain is
written out instead of being compressed into a claim.

- The run's own recorded help output lists `--chrome-channel <channel>` under the top level
  `Options:` block with `(default: "chrome-canary")`, while `webmcp-evals smoke --help`, captured in
  the same log, lists only `-u`, `-e`, `--timeout` and `-v`.
- The command executed was `smoke -u ... -e evals/evals.json --chrome-channel chrome-dev --timeout
  30000 -v`, and the step exited zero. No `unknown option` was printed.
- A browser opened a page: `[Smoke] Opening fresh page for "Fill the draft in one revision, then
  check it against the policy" at https://upgradedev.github.io/claimready/...`

The last step is a deduction and is labelled as one. `chrome-canary` has no Linux build, so a run
that had fallen through to the default could not have launched a browser on `ubuntu-latest`. A
browser launched, so the Dev channel reached the launcher. That is two log anchors plus an
inference, and no line in the log says the flag was honoured in those words.

**2. Tool discovery through `page.webmcp.tools()`.** Settled by a line. The first step of the first
journey is a tool call, and it came back with the page's own text:

```
[Smoke] Case "Fill the draft in one revision, then check it against the policy" Step 1/5: Calling tool "read_claim_state" with args: {}
  └─ PASS: Output: Claim draft on policy MTR-2026-0417, revision 0, status draft.
```

A step whose tool is not discovered fails with `tool "<name>" is not available.` and stops the case.
Sixteen steps in a row did not.

**3. The native API, with no polyfill shipped.** Settled by that same line. This page registers on
`document.modelContext`, falls back to `navigator.modelContext`, and ships no polyfill, so a browser
exposing neither name registers nothing and every journey dies at its first step. Journey 1 step 1
called a tool and got an answer, so the browser exposed one of the two names and the page's own
`registerTools` ran against it. That was the correct failure to be afraid of, and it did not happen.

The lifecycle half needed four steps rather than one, and got them. These four lines are from run
33334936720, which held the Run row above until 2026-09-01 and is history now rather than the run of
record, with each tool's own output truncated at the first newline because that is where the
runner's log breaks it:

```
Step 2/7: Calling tool "apply_claim_patch"       PASS: Applied. The claim is now at revision 1.
Step 4/7: Calling tool "get_assistance_options"  PASS: Northwind Mutual options for a vehicle that cannot be driven ...
Step 5/7: Calling tool "apply_claim_patch"       PASS: PATCH_REJECTED_STALE. expected revision 0, current revision 1. ...
Step 7/7: Calling tool "get_assistance_options"  PASS: Northwind Mutual options for a vehicle that cannot be driven ...
```

Step 4 found a tool that did not exist when the case opened. Step 7 found it still there after the
stale patch was refused. That pair is the assertion journey 2 is built around, and both halves are
in the log.

Read step 5 carefully before believing more of it than it says. `PASS` there means the harness made
the call and got a value back. The value happens to be a refusal, and the harness did not check
that, could not have checked it, and would have printed `PASS` just as happily if the page had
applied the patch. What makes step 5 mean something is step 7, and what makes step 7 mean something
is the negative control below.

### The limitation of this mode, which no smoke run can see

**Smoke mode collects browser console errors from the pinned harness and then throws them away. It
never reports them and it never gates on them.** Re-read from the harness at the pinned commit
`d39eae4bd51e8c12736b8cae840bd98f190f3179` on 2026-08-28, and still true:

- The pinned commit is `feat(evals): include browser console errors in reports (#361)`. It changed
  `src/evaluator/browser.ts`, `src/evaluator/browserEvaluator.ts` and `src/report/report.ts`. It did
  not change `src/evaluator/smokeEvaluator.ts`.
- `executeToolChecked`, which smoke calls for every step, starts the collector, so the errors really
  are gathered on a smoke run exactly as on a model driven one. Read it yourself:

  ```
  async executeToolChecked(name, args = {}) {
    const stopCollecting = this.startCollectingBrowserConsoleErrors(name, args);
  ```

- `getBrowserConsoleErrors` appears in exactly two files in the package, `browser.ts` where it is
  defined and `browserEvaluator.ts` where it is called. It appears zero times in
  `smokeEvaluator.ts` and zero times in `report/report.ts`. Nothing in the smoke path reads it and
  nothing in the smoke summary prints it. Reproduce the count with:

  ```bash
  C=d39eae4bd51e8c12736b8cae840bd98f190f3179
  for f in src/evaluator/browser.ts src/evaluator/browserEvaluator.ts \
           src/evaluator/smokeEvaluator.ts src/report/report.ts; do
    printf '%s ' "$f"
    curl -sS "https://raw.githubusercontent.com/GoogleChromeLabs/webmcp-tools/$C/webmcp-evals/$f" \
      | grep -c getBrowserConsoleErrors
  done
  ```

So the run above would have reported `16/16` with the page throwing on every load. That is not an
academic gap for this entry. The Content Security Policy ships inside the document, and a violation
of it surfaces as a console error and as nothing else, so the mode used to prove the tool surface is
the mode that is blind to the failure the deployed page is most likely to have. Until something
reads that array, the console evidence for this page comes from two other places: `CAPTURE_JS` in
the video pipeline, which fails a capture on any `console.error` from the live page, and opening the
page by hand with the console visible.

The workflow itself still refuses to launder a failure. There is no `continue-on-error` on the eval
step and no fallback that turns "the harness could not run" into a pass. The one `|| true` in the
file is on the diagnostic step that records the harness command surface, which asserts nothing and
is the step that produced the help output quoted under risk 1.

**LLM driven browser mode: still NOT WIRED and NOT OBSERVED.** It needs a model key
(`GOOGLE_AI`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) which this repository does not hold. The
`messages` in `evals.json` are written as real prompts so the journeys are meaningful the day
somebody runs `browser` mode, not as placeholders.

**Observed on the deployed page, 2026-08-27, at `https://upgradedev.github.io/claimready/`.**
Every journey hardcodes `baseRevision: 0`, because smoke mode has no way to pipe the revision it
just read into the next call's arguments. That constant is the load-bearing assumption in the
whole file, so it was checked against the bytes the host actually serves rather than against
`src/core/claim.js` alone:

| Checked | Observed |
|---|---|
| The revision the page boots at | `DRAFT REVISION 0`, so `baseRevision: 0` is correct |
| `fixtures/demo-collision.json` over the live host | HTTP 200, policy `MTR-2026-0417`, so the page is on the real fixture and not on `FALLBACK_FIXTURE` |
| `vehicle_drivable` at boot | `null`, so `get_assistance_options` is genuinely absent and journey 2 step 2 is a real transition rather than a no-op |
| `damage_zone`, `severity`, `description` at boot | all `null`, which is exactly the set journey 1 fills |
| `incident_type` at boot | `collision`, so `check_coverage` has what it needs in journey 1 |
| The planted third party note | present, 2 evidence notes, so journey 3 has a note to read. This row used to carry a caveat, that the note's text had been rewritten and the live host was still serving the older wording. That is no longer true. Re-checked 2026-08-28: the fixture the host serves is byte for byte the fixture in this repository. Reproduce with `curl -sS https://upgradedev.github.io/claimready/fixtures/demo-collision.json` and compare it to `fixtures/demo-collision.json` |
| Console errors, including CSP against `script-src 'self'` | none |
| `document.modelContext` and `navigator.modelContext` | both absent in stock Chrome, and the page correctly says "No agent detected in this browser" |

That last row is the expected result in a browser without the API and is not evidence against the
page. It is recorded because it is the same absence that would have made every journey fail at its
first step on a runner, which was risk 3 above. Run 33334936720 settled it: on the runner's Chrome
Dev build one of the two names was there, and the page's own registration ran against it.

**What has been observed to pass, locally, with no install:**

- The three journeys and the negative control are correct against the domain. All four are replayed
  by `node evals/replay.mjs`, which drives the real registration path rather than reasoning about
  it, and they produce the sequences this file claims. Output is quoted under "Proof the gate
  fails" below.
- Every `functionName` in `evals.json` and `negative-control.json` resolves to a tool actually
  registered under `src/webmcp/tools/`, read from the `name:` field rather than from the filename.
  All nine are exercised, none is invented. The replay would fail with
  `tool "<name>" is not available.` on an invented one.
- No argument object contains a `$` operator, so nothing is silently replaced by a sample value.
  `replay.mjs` throws by name if one ever appears, rather than quietly resolving it the way the
  harness would.
- `scripts/gen_scenarios.mjs` produces 180 of 180 scenarios whose expected outcome matches what
  `applyPatch` actually returns, across all 18 kinds.

---

## The three journeys, in `evals.json`

### 1. Fill the draft in one revision, then check it against the policy

`read_claim_state`, then one `apply_claim_patch` carrying four fields, then `validate_claim`,
`check_coverage` and `get_repair_estimate`.

**What it proves.** Replayed against the domain, the patch takes the draft from revision 0 to
revision 1 and `validateClaim` flips to ready with nothing missing. The atomic patch is real: four
fields go in as a single revision.

**What it does not prove, corrected 2026-08-27.** An earlier version of this file said
`get_repair_estimate` refuses to answer without `damage_zone` and `severity`, so its place at the
end of the sequence checked that the batch had landed whole. That is wrong twice over, and both
halves are worth knowing.

The tool does not refuse. With `damage_zone` unset it returns an ordinary result whose text names
the field to set first, built through `toResult` like every other answer in the repository, because
a sentence a model can correct itself from is more use than an error
(`src/webmcp/tools/get_repair_estimate.js`, the `Cannot work out a band yet` branch). And smoke
never reads the `result` field at all, so a real error string in that shape would pass too.

So in smoke mode this journey asserts that all five tools exist and execute in the authored order,
and nothing in it can fail on a wrong value. Journey 2 is the one deliberately shaped so that it
can, and the next section explains how.

### 2. A stale patch is refused, proved by the ninth tool surviving it

This is the journey that carries the product's central claim, and it is deliberately shaped so
that smoke mode can actually fail it.

**The problem it works around.** Smoke does not assert the `result` field, and every tool on this
page returns through `toResult()`, which produces `{content:[{type:'text',...}]}`. That shape can
never trip `explicitToolFailure()`. So a journey that merely calls `apply_claim_patch` with a
stale revision passes whether the page refuses the patch or wrongly applies it. Shipped in that
shape it would be a gate that cannot fail, and it is not shipped in that shape.

**How the refusal is made assertable.** Tool availability is the one channel with teeth, because
smoke re-reads the tool list before each step and stops the case when a tool is missing. The
journey uses the page's own lifecycle as the oracle:

1. `read_claim_state` at revision 0.
2. `apply_claim_patch` with `baseRevision: 0` setting `vehicle_drivable` to `false`. The draft
   moves to revision 1 and `get_assistance_options` is registered as the ninth tool.
3. `read_claim_state`, a deliberate no-op. The store subscriber in `src/webmcp/register.js` fires
   the reconcile without awaiting it, the `reconcile('claim changed').catch(...)` line, so this
   step gives the registration a turn to settle rather than racing it.
4. `get_assistance_options`. It must be available. That alone proves the dynamic registration.
5. `apply_claim_patch` with `baseRevision: 0` again, now stale, trying to set `vehicle_drivable`
   back to `true`. It must be refused with `PATCH_REJECTED_STALE`.
6. `read_claim_state`, settling again.
7. `get_assistance_options`. **It must still be available.**

If step 5 were wrongly applied, `vehicle_drivable` would become `true`, the ninth tool would be
withdrawn, and step 7 would fail with `tool "get_assistance_options" is not available.` The
refusal is therefore asserted through a mechanism smoke actually checks, rather than through a
`result` field it ignores.

### 3. A planted instruction in third party evidence changes nothing

`read_evidence_notes`, then `get_requirements`, `describe_claim` and `validate_claim`.

The second note in `fixtures/demo-collision.json` is a planted instruction. It asks whatever agent
reads the file to change `vehicle_drivable`, which the claimant pinned earlier in the demo, and
then to file the claim.

Both halves are asked for on purpose, because they fail in two different ways and a reader should
see both.

- **The patch has a tool and is refused anyway.** `apply_claim_patch` exists, so an agent that
  obeys the note gets as far as calling it. `vehicle_drivable` is pinned, so the answer is
  `PATCH_REJECTED_LOCKED` naming the field, nothing is written, and the revision does not move.
  A refusal with a code, on the page, in the ledger.
- **The filing has no tool at all.** There is nothing named for it in the published surface, so
  there is nothing to call and no refusal to record either. That absence is the stronger fact, and
  it is checkable from outside: read the tool list and look for the action.

The earlier note asked for a severity of scratch and a filing. Severity is patchable and unpinned,
so that half simply succeeded, and the filing half produced no refusal because no tool answered it.
The sentence "following it changes nothing" was not true of that note. It is true of this one.

**Be precise about what each mode proves.** In smoke mode there is no model, so nothing can be
tempted: the journey proves the untrusted content tools execute, and that the requirements and the
validation that follow the note are the ones derived from the claim. It does not prove the page
resisted anything, because nothing tried, and it does not exercise the refusal above either, since
journey 3 never calls `apply_claim_patch`. The resistance is pinned by the unit suite, which
asserts the derived answers are identical whether the notes are present or not. In browser mode,
with a real model reading that note, the journey becomes a genuine injection test, which is why its
`messages` are written the way they are.

---

## The fourth case, in `negative-control.json`, and what the pair proves that neither half does

`evals/negative-control.json`. One case, eight steps, and it is **expected to fail at step 8**. A
green harness on this file is what turns the check red.

### Why journey 2 needed a partner

Journey 2 asserts that after a stale patch is refused, `get_assistance_options` is **still there**.
That is a real assertion, and on its own it is weaker than it looks, because there is a boring way
to satisfy it: a page whose tool set never moves at all passes journey 2 every time. Nothing in
those seven steps distinguishes "the refusal was refused, so the surface correctly did not change"
from "the surface cannot change".

The negative control removes that reading by driving the same mechanism the other way.

### The case

Fresh page, revision 0, `vehicle_drivable` null, so the ninth tool is absent.

1. `read_claim_state`.
2. `apply_claim_patch`, `baseRevision: 0`, `vehicle_drivable` to `false`. Revision 1. The ninth
   tool is registered.
3. `read_claim_state`, a deliberate no op, giving the store subscriber's un awaited reconcile a
   turn to settle rather than racing it.
4. `get_assistance_options`. It must be available.
5. `apply_claim_patch`, **`baseRevision: 1`**, `vehicle_drivable` back to `true`. This one is
   legal. It must be APPLIED. Revision 2.
6. `read_claim_state`, settling.
7. `read_claim_state`, settling again. Two of them, and the reason is in the harness: it polls for
   up to five seconds for a tool to APPEAR and does not poll at all for one to DISAPPEAR, so
   absence is read exactly once, immediately. Presence is retried; absence is not, so absence is
   given the room instead.
8. `get_assistance_options`. **It must now be gone**, and the case must die here with
   `tool "get_assistance_options" is not available.`

Step 5 is the only line that differs from journey 2 step 5, and it differs by one digit. Journey 2
sends `baseRevision: 0` on a claim that has moved to 1, which is stale and must be refused. This
sends `baseRevision: 1` on the same claim, which is current and must land. One digit apart, opposite
outcomes, and the outcome is read from the tool list rather than from a message the harness ignores.

### What the two prove together

| | Journey 2 | The negative control |
|---|---|---|
| The patch at step 5 | stale, must be REFUSED | current, must be APPLIED |
| `vehicle_drivable` afterwards | still `false` | back to `true` |
| The ninth tool at the last step | must still be THERE | must be GONE |
| The harness verdict | `Passed steps: 7/7` | `Passed steps: 7/8`, failing at step 8 |

Taken together the pair says something neither says alone: **the tool surface on this page moves
when, and only when, a patch actually lands.** The control rules out the frozen surface, so
journey 2's steady surface stops being ambiguous and becomes evidence that the stale patch was
genuinely refused. That is how a refusal gets asserted through a channel the harness checks,
without ever asking it to read a `result` field it does not read.

### How it is checked in CI, and why it cannot pass for the wrong reason

`.github/workflows/evals.yml`, the step named
`Negative control, a patch that lands must withdraw the ninth tool`. It runs the harness with
`set +e` so it can read the exit code instead of being killed by it, strips ANSI from the log
because chalk colours its output on a GitHub runner, and then requires **three** things at once:

1. the harness exit code is non zero;
2. the log contains `Passed steps: 7/8 across 1 case(s).`;
3. the log contains
   `step 8 (get_assistance_options): tool "get_assistance_options" is not available.`

Assertion 2 is the one that stops a false pass. If the ninth tool were never registered at all, the
case would die at **step 4** with the very same sentence, and a check that only grepped for that
sentence would call a completely broken lifecycle a success. Seven of eight is the only summary
consistent with the run having reached the last step with everything before it green, which is to
say with the legal patch at step 5 having been applied rather than refused.

So the check fails if either half stops being honoured:

- the page wrongly refuses the legal patch: `vehicle_drivable` stays `false`, the ninth tool stays
  registered, the last step passes, the harness exits 0, assertions 1 and 2 both fail;
- the page applies the patch but never withdraws the tool: same observable, same three failures;
- the page never publishes the tool: the case dies at step 4, assertion 2 fails.

### It has been replayed offline, and it has been made to fail on purpose

`evals/replay.mjs` runs the same four cases with no browser, no install and no network, against the
real registration path in `src/webmcp/register.js` with a stand in for `document.modelContext`.
**It is the same class of evidence as `tests/unit/webmcp.test.js`, which is to say a fake host, and
it is not evidence about any browser.** It exists because you cannot break the deployed page to
find out whether a gate has teeth, and you can break a replay of it.

It copies three behaviours from the pinned `smokeEvaluator.ts` so it cannot report a verdict the
real run could not reach: the tool list is re read before every step, a missing tool is polled for
and then fails the case, and `explicitToolFailure` is copied verbatim rather than approximated.

**And it adds one screen of its own, which the harness does not have.** Corrected 2026-08-30. Being
exactly as blind to the `result` field as the harness turned out to cost a real defect: `buildContext`
read `policy.sections`, the page decides that question on `policy.coverages` in `hasSchedule` in
`src/ui/app.js`, so `hasPolicySchedule` was false on every replay that had ever run. `check_coverage`
answered *The sample policy schedule did not load*, and the suite printed `Passed steps: 16/16`.

`degradedAnswer` in `evals/replay.mjs` is that added screen. It refuses one thing and says which:
an answer in which the page has told the caller its own data did not load, or an answer with no text
in it. It does **not** refuse a refusal, because a refusal is the product working and journey 2
requires one at step 5. Each screened sentence is read from the constant that produces it,
`NO_PACK_REASON` from `src/webmcp/register.js` and the `noScheduleReason` mirror held to
`src/ui/app.js` by `tests/unit/replay_oracle.test.js`, so a reworded sentence cannot quietly leave
the screen. **It is stronger than the harness and is not a claim about any browser.** A step that
fails only on it says `the replay screen:` in its own error text.

Measured on 2026-08-28 at commit `4023446e7916b867f1365f871b08885d5cb45655`:

| Command | Summary | Verdict | Exit |
|---|---|---|---|
| `node evals/replay.mjs` | `Passed steps: 16/16 across 3 case(s).` | every journey replayed clean | 0 |
| `node evals/replay.mjs --negative-control` | `Passed steps: 7/8 across 1 case(s).` | PROVEN | 0 |
| `... --mutate applied-patch-refused` | `Passed steps: 8/8 across 1 case(s).` | NOT PROVEN | 1 |
| `... --mutate withdrawal-ignored` | `Passed steps: 8/8 across 1 case(s).` | NOT PROVEN | 1 |
| `... --mutate ninth-tool-never-registered` | `Passed steps: 3/8 across 1 case(s).` | NOT PROVEN | 1 |
| `node evals/replay.mjs --mutate schedule-field-drift` | fails at case 1 step 4 on the added screen | the journeys did not replay clean | 1 |
| `node evals/replay.mjs --selftest` | every mutation ran against its own suite and every one refused | selftest passed | 0 |

The last two rows were added on 2026-08-30. `schedule-field-drift` puts the wrong field name back,
which is the defect this file shipped with, and the journeys now refuse it at case 1 step 4 instead
of reporting `16/16`. `--selftest` iterates the mutation registry in `evals/replay.mjs`, picks each
mutation's declared suite and requires every one of them to exit non zero.

The first row matches the browser run's `16/16` exactly, which is the only thing the replay is
allowed to be believed about: it agrees with the harness on the cases the harness has run.

The mutations are what make the control a control. `applied-patch-refused` makes the store
refuse the legal patch. `withdrawal-ignored` makes the fake host keep a tool after its AbortSignal
fires. `ninth-tool-never-registered` makes the host refuse the tool outright, and it is the most
useful of the three because it produces the **same error sentence at a different step**, and the
control still says NOT PROVEN. A looser assertion would have read that as a pass.

The workflow runs the journeys, the control and then `--selftest` as a pre flight, before it
installs anything, and fails if any mutation survives. It used to loop the three mutation names
typed out in the shell, which made the registry and the list CI ran two copies of one thing: the
fourth mutation would have been registered and executed by nothing.
`tests/unit/replay_oracle.test.js` asserts the workflow still calls `--selftest`.

---

## Running it

```bash
# Offline. No browser, no install, no network. Run this first: it is the fastest way to find out
# that a change has broken the lifecycle the journeys assume.
node evals/replay.mjs
node evals/replay.mjs --negative-control
node evals/replay.mjs --selftest                                              # every mutation must exit 1

# Or one at a time. Each mutation belongs to one suite and the runner refuses the other pairing.
node evals/replay.mjs --negative-control --mutate applied-patch-refused        # must exit 1
node evals/replay.mjs --negative-control --mutate withdrawal-ignored           # must exit 1
node evals/replay.mjs --negative-control --mutate ninth-tool-never-registered  # must exit 1
node evals/replay.mjs --mutate schedule-field-drift                            # must exit 1
```

The published `webmcp-evals` package cannot run the deterministic mode. npm carries 0.0.1, 0.0.2 and
0.0.3, and their CLI offers only `local` and `browser`, so an `npx webmcp-evals smoke` line would be
a command that has never worked. The harness is cloned and built from a pinned commit instead, which
is what the workflow does and what these commands assume is on `$EVALS_BIN`.

```bash
# Deterministic, no model, no API key. The three journeys. Every step must pass.
node "$EVALS_BIN" smoke \
  -u "https://upgradedev.github.io/claimready/" \
  -e evals/evals.json \
  --chrome-channel chrome-dev \
  --timeout 30000 \
  -v

# The negative control. THIS ONE IS EXPECTED TO FAIL, at its last step and nowhere else.
NO_COLOR=1 node "$EVALS_BIN" smoke \
  -u "https://upgradedev.github.io/claimready/" \
  -e evals/negative-control.json \
  --chrome-channel chrome-dev \
  --timeout 30000 \
  -v

# LLM driven, needs a key in the environment. Never observed to run here.
node "$EVALS_BIN" browser \
  -u "https://upgradedev.github.io/claimready/" \
  -e evals/evals.json \
  --backend gemini
```

In CI: `.github/workflows/evals.yml`, on manual dispatch and daily at 06:17 UTC. Two jobs, and they
do not depend on each other, so a failure to build somebody else's harness cannot hide whether our
own page still behaves.

The `smoke` job, in order, replays the journeys, replays the negative control, runs `--selftest`
over the whole mutation registry and fails if any mutation survives, fails when the repository
variable `CLAIMREADY_URL` is empty, fails when that URL does not answer 200, builds the harness from
the pinned commit, runs the three journeys, runs the negative control and requires it to fail in the
one shape described above, and uploads both logs and any `.evals` report as an artifact.

The `probe` job, in order, runs the 83 mutations and the note phase tests before any browser is
opened, fails when `CLAIMREADY_URL` is empty, fails when that URL does not answer 200, fails unless
the host is serving this checkout at this commit on all 26 files the page loads, hands that commit
to the probe, starts Chrome with the WebMCP flag, runs `evals/browser_probe.mjs` and fails when the
judgement refuses the transcript, and uploads the transcript and the browser's own log.

Dispatch it by hand with:

```bash
gh workflow run evals.yml --repo upgradedev/claimready --ref main
```

**One deliberate exception to a rule stated elsewhere.** `.github/workflows/ci.yml` says no job in
it installs anything, ever. That remains true of `ci.yml`. This is a separate workflow and it does
install: a third party CLI and a browser, neither of which can be vendored into a page that ships
with no dependencies. Nothing it installs is a dependency of the product.

---

## The scenario generator

`scripts/gen_scenarios.mjs` is a seeded, deterministic, dependency free generator of the patch
scenarios a curated corpus never contains. Scenario N depends only on the seed and on N, so a CI
failure reproduces from its number alone.

```bash
node scripts/gen_scenarios.mjs                    # 40 scenarios, human readable
node scripts/gen_scenarios.mjs --count 200 --json # the corpus as JSON
node scripts/gen_scenarios.mjs --number 47        # reproduce one failure exactly
node scripts/gen_scenarios.mjs --snippet          # print the test file to add
```

Eighteen kinds are generated, each carrying its own oracle: the exact `PATCH_CODES` value
`applyPatch` must answer with, the revision afterwards, and how many fields were applied.

**Two of the eight edge cases in the brief turn out to be accepted, not refused**, and encoding
them as refusals would have produced a corpus that fails against correct code:

- **An enum in the wrong case is coerced, not rejected.** `enumField` trims and lowercases before
  comparing (`enumField` in `src/core/claim.js`), so `"COLLISION"` is stored as `"collision"`
  and the patch succeeds. The scenario pins the stored value instead of a refusal code.
- **A date before the policy started is accepted by the patch layer.** `isIsoDate` checks the
  calendar and the year range, not the schedule (`isIsoDate` in the same file). Whether the incident falls
  outside cover is `check_coverage` answering on clause `PL-1.2`, and deliberately not the patch
  layer's job.

The generator also respects the refusal precedence in `applyPatch`: a filed claim, then staleness,
then the shape of the change list, then per change protected, unknown, locked, null on a required
field, and finally the value. Every scenario testing a per field refusal carries a correct
`baseRevision`, because otherwise staleness would answer first and the oracle would be wrong.

**The description limit is pinned twice on purpose.** One scenario builds a string from
`DESCRIPTION_MAX_LENGTH + 1`, which follows the constant wherever it goes and so cannot fail if
somebody moves it. Its sibling uses a fixed absolute length, and the generator asserts at
generation time that the imported constant still equals the literal `240` written into `PINNED`.
Change the limit and the generator throws by name instead of a corpus quietly agreeing with the
change.

### Wiring it into the unit suite

Nothing under `tests/` was edited. Add the following as `tests/unit/scenarios.test.js`, which is
also what `node scripts/gen_scenarios.mjs --snippet` prints:

```js
// tests/unit/scenarios.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPatch } from '../../src/core/claim.js';
import { generateScenarios, buildClaim } from '../../scripts/gen_scenarios.mjs';

for (const scenario of generateScenarios()) {
  test(`scenario ${scenario.number} (${scenario.kind})`, () => {
    const claim = buildClaim(scenario);
    const result = applyPatch(claim, scenario.changes, {
      actor: scenario.actor,
      baseRevision: scenario.baseRevision,
    });

    assert.equal(result.ok, scenario.expect.ok, scenario.note);
    assert.equal(result.code, scenario.expect.code);
    assert.equal(result.revision, scenario.expect.revisionAfter);
    assert.equal(result.applied.length, scenario.expect.appliedCount);

    if (scenario.expect.errorIncludes) {
      assert.ok(
        String(result.error).includes(scenario.expect.errorIncludes),
        `scenario ${scenario.number}: expected the refusal to mention ` +
          `"${scenario.expect.errorIncludes}" but it said: ${result.error}`,
      );
    }

    // A refused patch must leave the draft untouched, not merely report that it did.
    if (!scenario.expect.ok) {
      assert.deepEqual(result.claim, claim);
    }

    // Coercion is asserted where the scenario pins a stored value.
    if (scenario.expectStored) {
      for (const [field, value] of Object.entries(scenario.expectStored)) {
        assert.equal(result.claim[field], value);
      }
    }
  });
}
```

---

## Proof the gate fails

A gate nobody has seen fail is not evidence. Each of these was run.

**1. The generator's oracle catches a wrong expectation.** While writing it, three scenarios of
180 failed, because the blank string `'  '` was filed under "not a whole number" when
`Number(''.trim())` is in fact `0`, which is refused for being out of range instead. The corpus
reported the mismatch with the real message rather than agreeing with it. The kind was corrected
and the blank string kept, as an out of range case, because the silent coercion to zero is worth
pinning.

**2. Corrupting the oracle deliberately.** Three mutations were run against the 60 scenario
corpus. Unmutated it reports 0 failures. Declaring a stale patch acceptable reports 3 failures.
Mislabelling a locked field reports 3. Claiming the atomic batch half applies reports 3.

**3. The negative control, made to fail three ways.** This item used to be a hand written replay of
journey 2 against `src/core/claim.js` and `CONDITIONAL_TOOLS[0].present`, printing a line that said
smoke *would* hard fail if the patch landed. It is now a real case in a real file, replayed through
the real registration path by `evals/replay.mjs`, and each of the three mutations in the table above
turns its verdict from PROVEN to NOT PROVEN. Run them yourself:

```bash
node evals/replay.mjs --negative-control                                       # PROVEN,     exit 0
node evals/replay.mjs --negative-control --mutate applied-patch-refused        # NOT PROVEN, exit 1
node evals/replay.mjs --negative-control --mutate withdrawal-ignored           # NOT PROVEN, exit 1
node evals/replay.mjs --negative-control --mutate ninth-tool-never-registered  # NOT PROVEN, exit 1
node evals/replay.mjs --selftest                                               # all four, exit 0
```

The unmutated run prints, in full:

```
Passed steps: 7/8 across 1 case(s).
Smoke test "NEGATIVE CONTROL, a patch that IS applied withdraws the ninth tool" step 8 (get_assistance_options): tool "get_assistance_options" is not available.

The negative control asserts two things at once, and both have to hold.
  every step up to 7 passed, so the patch at step 5 was APPLIED: yes
  step 8 then found the ninth tool WITHDRAWN:                     yes

VERDICT: PROVEN. The lifecycle answered a patch that was applied.
```

Reproduce the generator's two with:

```bash
node scripts/gen_scenarios.mjs --number 36   # the blank string, now filed as out of range
node scripts/gen_scenarios.mjs --number 19   # its sibling, genuinely not a whole number
node scripts/gen_scenarios.mjs --count 180 --json
```

**Still owed, and narrowed again.** Three things are owed on this page and nothing else is.

1. **The negative control, inside a browser.** It is written
   (`evals/negative-control.json`), it is wired as a gate with three assertions
   (`.github/workflows/evals.yml`), and it has been replayed offline and made to fail three ways.
   It has **not** been executed by the harness in Chrome at any commit, because the workflow reads
   the eval file from the checked out ref and the file is not yet on a pushed branch. The moment it
   is, dispatch it and paste the output here:

   ```bash
   gh workflow run evals.yml --repo upgradedev/claimready --ref <the branch>
   ```

   Until that output is in this file, the honest statement is the one made above: the pair is
   proven against the domain and the registration path, and the browser half is proven for journey 2
   only. Do not write that the pair has been observed in a browser before it has.

   **Settled, 2026-08-30 and 2026-08-31. This paragraph used to say the withdrawal half had never
   been seen in a browser, and that is no longer true.** It has now been seen twice, and the two
   sightings are on different Chrome builds:

   - In CI, run 33334936720, the negative control job reported `Passed steps: 7/8` and named the
     reason: `step 8 (get_assistance_options): tool "get_assistance_options" is not available.`
     That step is REQUIRED to fail, and it fails because the tool was gone. Chrome 154, Dev.
   - On a desktop, `node evals/browser_probe.mjs` against the deployed page watched `getTools()`
     return nine entries at boot, ten while `vehicle_drivable` was false, and nine again after a
     patch put the car back on the road. Chrome 151.0.7922.174, stable channel.

   What has NOT changed is the caller. Both sightings were driven by a script through the browser's
   own API, not by a model, and `replay.mjs` still proves only that the page calls
   `controller.abort()` and that a host honouring an abort drops the tool. The imperative API
   documentation records that unregistration stopped cancelling in flight executions as of Chrome
   153, so the behaviour has moved recently, which is why both builds are named above rather than
   one.

   **So the diagnosis is written down now, before anyone reads it under a deadline.** If the first
   browser run of this file reports `Passed steps: 8/8`, the likeliest cause is the browser's
   withdrawal, not the assertion. Two shapes produce that summary: Chrome never removes on abort, or
   Chrome removes it more slowly than one read, and the harness polls for a tool to appear but never
   for one to disappear. The fix for the second is another settling `read_claim_state` before the
   absence check, which makes the case `8/9`. `replay.mjs` recomputes its expectation from the
   file's own step count, so only the literals in `.github/workflows/evals.yml` and the prose above
   move. The fix for the first is a correction to what this repository claims, in the README and in
   the description, naming the browser version it was observed on. **The fix is never to weaken one
   of the three assertions.**

   One consequence worth knowing before it surprises anybody: the `WebMCP evals` badge is in the
   README and this workflow runs on a daily cron, so a failing negative control turns a judge visible
   badge red every morning. Dispatch it once by hand straight after committing, before spending
   effort anywhere else. Nothing in the video depends on the answer, because the one beat that
   touches the tool count, `05-reconcile`, shows the count going from 8 to 9, which is the appearance
   half and is already proven.

2. **A console reading from a smoke run.** Smoke gathers the page's console errors and reports none
   of them, as set out in the status section, re-read on 2026-08-28. Either the harness has to be
   patched to read that array or a separate check has to watch the console, before this file may say
   that a smoke run saw a clean page. It has never said so and it must not start.

3. **Browser mode, the model driven one.** It needs a key this repository does not hold, so it stays
   NOT WIRED and NOT OBSERVED.
