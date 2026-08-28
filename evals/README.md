# WebMCP evals

Three journeys over the nine tools this page publishes, plus a seeded generator of adversarial
patch scenarios for the unit suite.

Read the status section first. One of the two run modes has now been observed to run green on a
runner and the other has never been wired at all, and that section says which is which, names the
run, and names the one thing that mode is blind to.

---

## What was verified, and where it was read

Every claim about the harness below was read from a live page on 2026-08-27. Anything not on this
list was not verified and is not relied on.

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
| Run | [33074580188](https://github.com/upgradedev/claimready/actions/runs/33074580188), workflow `WebMCP evals`, conclusion success, started 2026-08-27T13:00:03Z |
| Commit under test | `2c052e3464198993e3efed9043e0443ff2bcb817` |
| Target | `https://upgradedev.github.io/claimready/`, the deployed judge URL |
| Browser | `Google Chrome 154.0.8013.2 dev`, printed by the install step |
| Harness | cloned and built from `GoogleChromeLabs/webmcp-tools` at the pinned commit `d39eae4bd51e8c12736b8cae840bd98f190f3179` |
| Result | `Passed steps: 16/16 across 3 case(s).` |

An earlier run, [33070316906](https://github.com/upgradedev/claimready/actions/runs/33070316906),
was green as well. The one above is the one quoted here because its commit is named. Read either for
yourself with `gh run view 33074580188 --repo upgradedev/claimready --log`.

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

The lifecycle half needed four steps rather than one, and got them:

```
Step 2/7: Calling tool "apply_claim_patch"       PASS: Applied. The claim is now at revision 1. Set vehicle_drivable to false.
Step 4/7: Calling tool "get_assistance_options"  PASS: Northwind Mutual options for a vehicle that cannot be driven ...
Step 5/7: Calling tool "apply_claim_patch"       PASS: PATCH_REJECTED_STALE. expected revision 0, current revision 1.
Step 7/7: Calling tool "get_assistance_options"  PASS: Northwind Mutual options for a vehicle that cannot be driven ...
```

Step 4 found a tool that did not exist when the case opened. Step 7 found it still there after the
stale patch was refused. That pair is the assertion journey 2 is built around, and both halves are
in the log.

### The limitation this file did not state

**Smoke mode collects browser console errors and then throws them away. It never prints them and it
never fails on them.** Three facts, each read from the harness at the pinned commit
`d39eae4bd51e8c12736b8cae840bd98f190f3179`:

- The pinned commit is `feat(evals): include browser console errors in reports (#361)`. It changed
  `src/evaluator/browser.ts`, `src/evaluator/browserEvaluator.ts` and `src/report/report.ts`. It did
  not change `src/evaluator/smokeEvaluator.ts`.
- `executeToolChecked`, which smoke calls for every step, starts the collector, so the errors really
  are gathered on a smoke run exactly as on a model driven one.
- `getBrowserConsoleErrors()` has exactly one caller in the package, `browserEvaluator.ts` line 122.
  Nothing in `smokeEvaluator.ts` reads it and nothing in the smoke summary prints it.

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
| The planted third party note | present, 2 evidence notes, so journey 3 has a note to read. Its text was rewritten after this observation, from a severity and a filing to a pinned field and a filing, and the live host serves the older wording until the next deploy. The count and the position are what this row pins, and neither moved |
| Console errors, including CSP against `script-src 'self'` | none |
| `document.modelContext` and `navigator.modelContext` | both absent in stock Chrome, and the page correctly says "No agent detected in this browser" |

That last row is the expected result in a browser without the API and is not evidence against the
page. It is recorded because it is the same absence that would have made every journey fail at its
first step on a runner, which was risk 3 above. Run 33074580188 settled it: on the runner's Chrome
Dev build one of the two names was there, and the page's own registration ran against it.

**What has been observed to pass, locally, with no install:**

- The three journeys are correct against the domain. Each was replayed through
  `src/core/claim.js` and `CONDITIONAL_TOOLS[0].present` and produced the sequence the file
  claims. Output is quoted under "Proof the gate fails" below.
- Every `functionName` in `evals.json` resolves to a tool actually registered under
  `src/webmcp/tools/`, read from the `name:` field rather than from the filename. All nine are
  exercised, none is invented.
- No argument object contains a `$` operator, so nothing is silently replaced by a sample value.
- `scripts/gen_scenarios.mjs` produces 180 of 180 scenarios whose expected outcome matches what
  `applyPatch` actually returns, across all 18 kinds.

---

## The three journeys

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

## Running it

```bash
# Deterministic, no model, no API key. This is what CI runs.
npx --yes webmcp-evals@0.0.3 smoke \
  -u "https://upgradedev.github.io/claimready/" \
  -e evals/evals.json \
  --chrome-channel chrome-dev \
  --timeout 30000 \
  -v

# LLM driven, needs a key in the environment. Never observed to run here.
npx --yes webmcp-evals@0.0.3 browser \
  -u "https://upgradedev.github.io/claimready/" \
  -e evals/evals.json \
  --backend gemini
```

In CI: `.github/workflows/evals.yml`, on manual dispatch and daily at 06:17 UTC. It reads the
target from the repository variable `CLAIMREADY_URL`, fails when that is empty, fails when the URL
does not answer 200, and uploads the log and any `.evals` report as an artifact.

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

**3. Journey 2's negative control.** Replaying journey 2 against `src/core/claim.js` and
`CONDITIONAL_TOOLS[0].present`:

```
start revision 0 | drivable null | ninth tool present: false
J2 step2 ok: true | revision 1 | ninth tool present: true
J2 step5 ok: false | code PATCH_REJECTED_STALE
J2 after refusal -> drivable false | revision 1 | ninth tool STILL present: true
NEGATIVE CONTROL (correct revision, so it applies): ok true -> drivable true
  | ninth tool present: false <- smoke would hard-fail here
```

The last line is the proof: change the stale revision to the current one, the patch lands,
`vehicle_drivable` becomes `true`, the ninth tool is withdrawn, and step 7 of the journey fails
with `tool "get_assistance_options" is not available.` The journey can fail, and it fails for the
right reason.

Reproduce the three of them with:

```bash
node scripts/gen_scenarios.mjs --number 36   # the blank string, now filed as out of range
node scripts/gen_scenarios.mjs --number 19   # its sibling, genuinely not a whole number
node scripts/gen_scenarios.mjs --count 180 --json
```

**Still owed, and narrowed.** Smoke mode has now been observed to run, so the condition that
blocked the item below is gone and only the run itself is outstanding. Three things are owed on this
page and nothing else is.

1. **Journey 2's negative control, inside a browser.** Item 3 above is a replay against the domain,
   not against the harness. Dispatch the evals workflow once against a copy of `evals/evals.json`
   whose step 5 carries `baseRevision: 1` instead of `0`, so the patch lands, `vehicle_drivable`
   becomes `true` and the ninth tool is withdrawn. Confirm the case then fails at step 7 with
   `tool "get_assistance_options" is not available.` and paste the harness output here. The green
   run proves this journey passes in a browser. Nothing yet proves it can fail in one.
2. **A console reading from a smoke run.** Smoke gathers the page's console errors and prints none
   of them, as set out in the status section. Either the harness has to be patched to read that
   array or a separate check has to watch the console, before this file may say that a smoke run saw
   a clean page. It has never said so and it must not start.
3. **Browser mode, the model driven one.** It needs a key this repository does not hold, so it stays
   NOT WIRED and NOT OBSERVED.
