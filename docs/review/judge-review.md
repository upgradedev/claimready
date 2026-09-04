# Judge review, written against ourselves

> ## Where this entry actually stands, 2026-09-04
>
> **Read this box before anything below it.** Most of this file was written while the entry was
> incomplete, and it argues against a state that no longer exists. It is kept as the record of what
> we found and when, not as a description of today. What is true today, each with the command that
> says so:
>
> | | |
> | --- | --- |
> | Public video | **published**, <https://youtu.be/cazdzwy2qKU>, 2:49, Public not Unlisted. `curl -s -L "https://www.youtube.com/watch?v=cazdzwy2qKU"` returns `"isPrivate":false`, `"isUnlisted":false`, `"lengthSeconds":"169"` |
> | Devpost entry | **reads `SUBMITTED`**, all five steps done, re-checked after every edit |
> | Commit the host serves | **`ecd4c09`**. `python video/build_video.py --verify-deployed --url https://upgradedev.github.io/claimready/ --deployed-sha ecd4c09` prints `the deployed page is ecd4c09, on every one of those files`, exit 0 |
> | Browser evidence at that commit | [run 33828470561](https://github.com/upgradedev/claimready/actions/runs/33828470561), `probe: PASS. 178 checks against the deployed page, none failed.`, smoke `16/16` with the negative control at `7/8` |
> | Readiness | `node scripts/readiness.mjs` prints **27 of 27 automated rows PASS**, `deliverable rows outstanding: 0`, exit 0 |
>
> **The one sentence in this file a judge should not read straight.** Under
> [The five things a hostile judge says first](#the-five-things-a-hostile-judge-says-first), item 1
> reads "There is no video". That was true when it was written and it is false now, and it is left
> standing with this correction beside it rather than quietly edited, which is the same rule the rest
> of this file follows.

**This file used to carry four scores out of ten, one per criterion, and it does not any more.**
They were removed on 2026-09-02. Each was labelled `Ours, not measured`, and the label was true and
was not the point: a number awarded by the people who built the entry, sitting in a folder anybody
who clones the repository can browse, is the exact shape of the thing this project refuses
everywhere else. The findings the scores were attached to are all still here, which is the part
that was ever worth reading. **Every judgement below is ours**, made by the people with the
strongest possible reason to be generous, and no reviewer outside the build has seen this entry.

What this file is: an adversarial read of our own submission against the organizer's four criteria,
kept because it is where the entry's own defects get written down before a judge finds them.

First written against `7b50d4a`, a working commit that reached the public repository squashed as
`9b64fb2`. **This line said `c93b138` until now, and an earlier version of this file had it right.**
`gh pr view 22 --json number,mergeCommit` prints
`{"mergeCommit":{"oid":"9b64fb22c9fe8069aa2cf5d58e65628ab54d9367"},"number":22}`, and the same
command with `24` returns `c93b138`, which is a different pull request.
`git show c93b138:docs/review/judge-review.md | sed -n '9,10p'` prints this file naming `9b64fb2`
where this line now names it again, so a later pass broke a sentence an earlier pass had right. That
is the same class as the run attributed to a commit it did not drive, recorded below. Revised
2026-09-01 against `ab2db69`, and again on 2026-09-02 against `b5a43e8`, which was not a released
commit and was the weaker footing this line used to apologise for.

**SUPERSEDED. The commit the host serves is `ecd4c09`, not `ead5077`.** This line said `61b4d8b` from 2026-09-03 until 2026-09-04, when a change to `index.html` moved the freeze again; the box at the top of this file carries the current commit and the run that drove it. `ead5077` was
lifted the morning of 2026-09-03 for a defect this file records below: the sealed handler packet
reported a filing revision the filing did not happen at. `61b4d8b` closed it, was deployed, and was
verified over all 27 files the page loads, with a native Chrome run at the same commit,
[run 33724024167](https://github.com/upgradedev/claimready/actions/runs/33724024167), printing
`probe: PASS. 178 checks against the deployed page, none failed.`

The block below is kept in its original wording, because a review that quietly rewrites what it
checked is worth less than one that says what it checked and when. Read it as a reading taken at
`ead5077`, and read the paragraph above as the current state.

**This revision reads `ead5077`, which was `origin/main` and the commit the host served.** Checked
here at 19:11 UTC on 2026-09-02:

```sh
python video/build_video.py --verify-deployed --url https://upgradedev.github.io/claimready/ --deployed-sha ead5077
```

It printed `checking 27 on camera source(s) at https://upgradedev.github.io/claimready/ against
ead5077` and `the deployed page is ead5077, on every one of those files`, and exited 0. **It is 27
files and not 26.** `src/core/canonical.js` is new in `ead5077` and the page loads it.

**This file used to say that every sentence in this repository naming 26 files describes an earlier
commit. That universal is false.** Read against the released commit rather than against a working
tree four agents are editing, `git grep -c "26 files" ead5077 -- '*.md' '*.mjs' '*.js'` prints

```
ead5077:README.md:6
ead5077:docs/review/judge-review.md:3
ead5077:docs/submission/video.md:9
ead5077:evals/README.md:5
ead5077:evals/browser_probe.mjs:2
```

25 lines at the commit a judge clones. Some of them name the commit they describe, and
`README.md:497` is one, inside a sentence that names run 33560224732 at `c93b138`. Others are
general standing statements with no commit attached, and `README.md:505` is one of those; those are
simply stale at 27. This pass did not read all 25, so it does not say which line every one of them
is.

**The live URL was a 404 for part of today.** A settings change made the repository private, which
disabled GitHub Pages, and the judge URL answered 404 from about 16:16 UTC on 2026-09-02 until the
repository was made public again and Pages re-enabled from `main` at root. The start of that window
is our record. The end of it is pinned by CI rather than by our note: the `pages build and
deployment` run for `b5a43e8` is `success` at 18:58:12Z, from
`gh run list --limit 40 --json name,createdAt,headSha,conclusion,event`. What was measured here at
19:11 UTC on 2026-09-02 is the state after it:
`curl -s -o /dev/null -w "%{http_code}" https://upgradedev.github.io/claimready/` printed `200`, and
the page served `<title>ClaimReady, the policy aware claim desk</title>`. The outage is ours and not
the host's.

**This file used to say that no gate ran during the window, and that nobody ran the `LIVE` row for
those two and three quarter hours. Both are false.** The gate ran six times inside the window, and
what happened to those six runs is one story with defect 6 below, the readiness purity check that
reads a string literal as code, which this file had been filing as an unrelated item.

`gh variable list` shows `CLAIMREADY_URL` set to the judge URL on 2026-08-27, so the `LIVE` row was
armed and would fetch. From the run list command above, and from `gh run view <id> --json jobs` on
each run:

**Nothing fired for most of the window.** The Readiness workflow runs on push, on pull request and
on dispatch, and there is no Readiness run at all between 12:37:41Z and 18:43:56Z. Nothing was
pushed, so there was nothing to blind. The blindness below is confined to five minutes, not to two
and three quarter hours, and this file is not going to trade one overstatement for another.

**Then four runs fired and reported nothing.** Runs 33669011890 at 18:43:56Z and 33669052847 at
18:44:20Z over commit `985953d`, and 33669304136 at 18:46:45Z and 33669314838 at 18:46:51Z over
`2c485dc`. In all four the step `Prove the gate can fail before trusting it` is `failure` and the
step `Readiness table` is `skipped`, so the table that holds the `LIVE` row never ran. The failing
case is one row, and it is not the live one. Job 100377701906 printed, at 18:45:31Z:

```
  BAD  PUR   intact FAIL     broken FAIL     a core module reaches for the browser
        refusal said: packet.js uses document, zz_selftest_break.js uses window
```

read back with `gh api repos/upgradedev/claimready/actions/jobs/100377701906/logs`. The same one
case failed in the other three, each printing `selftest FAILED. 1 case(s) did not behave`.

**Then two runs fired with the selftest green, and the live row did catch it.** Runs 33670094219 at
18:54:30Z and 33670098201 at 18:54:32Z, over `a431553`, ran the table and printed

```
LIVE  FAIL          mandatory     engineering  judge URL https://upgradedev.github.io/claimready/
                                               HTTP 404, expected 200
```

at 18:56:48Z and 18:56:45Z, with `READY TO SUBMIT:  24 of 31 proven, 77.4 percent`. That is about
ninety seconds before Pages redeployed.

**So the gate caught it in the end, and for four runs it was blind to a 404 because an unrelated row
had gone red.** A gate that refuses to report because one of its other rows failed is a gate that
goes blind exactly when something is wrong, and the row it stopped printing was a mandatory one.
**The remedy is not that somebody should have run it. It is that the live row has to be reachable
independently of the selftest, and that is open.** In `.github/workflows/readiness.yml` at `ead5077`
the `Readiness table` step follows `Prove the gate can fail before trusting it` with no condition on
it, so a failing selftest still skips the table. Nothing about that has changed.

On the day before the deadline, a repository visibility setting that can take the whole entry off
the internet is a submission risk and not a footnote.

Every count below carries the command that produced it and the time it was taken. Two files were
being edited by other agents while this was written, `README.md` and `docs/submission/video.md`, so
a reading taken here may already have moved. Reviewed one day before the deadline, with the video
still unrecorded.

## What the criteria actually are

**Read from the live rules page, <https://webmcp.devpost.com/rules>, on 2026-09-01 `[PRIMARY]`.**
An earlier version of this file quoted only one of the four and reviewed the other three against a
one word label, because that was all the workspace state file had recorded on 2026-08-26. Reviewing
against a label is weaker than reviewing against the organizer's sentence, and it was a gap in our
preparation rather than in the entry. It cost one page load to close. All four are now quoted.

Stage one is pass or fail:

> "The first stage will determine via pass/fail whether the ideas meet a baseline level of
> viability, in that the Project reasonably fits the theme and reasonably applies the required
> APIs/SDKs featured in the Hackathon."

Stage two is four criteria at 25 percent each:

> **WebMCP Leverage.** "How thoroughly and skillfully does the project use WebMCP? Does the code
> reflect genuine effort and a working, non-trivial implementation?"

> **Execution.** "Does the project deliver a working or runnable project that has a complete,
> coherent product experience, not just a technical proof of concept?"

> **Potential Impact.** "Does the project make a credible, specific case for solving a real problem
> for a real audience, and does the solution actually address that problem based on what's
> demonstrated?"

> **Creativity & Ambition.** "How creative and novel is the concept and does the project differ from
> existing concepts?"

**Two of those quotes are altered, and here is the alteration.** The organizer writes an em dash at
two points, after "product experience" in Execution and after "real audience" in Potential Impact.
Our own style gate forbids that character anywhere in this repository, so both are rendered here as
commas. Nothing else is changed and no word is dropped. The originals are at the URL above, and the
substitution is stated rather than left for a reader to discover, because a quote that has been
quietly reshaped to pass one of our own gates is exactly the defect this file exists to catch. All
five passages were checked against the raw page on 2026-09-01 with
`curl -s https://webmcp.devpost.com/rules`, not against a summary of it. The rules page also says
the criteria are "equally weighted", which is where the 25 percent comes from.

Two things moved when the real wording arrived, and both change how the sections below should be
read. The fourth criterion is not called Creativity. It is **Creativity & Ambition**, and ambition
is a word we had not been scoring ourselves against at all. And Execution asks for "a complete,
coherent product experience, not just a technical proof of concept", which is a product sentence
rather than the engineering sentence we had been answering.

## The way to read this file

Each section says what a judge would credit, then what a judge would mark down, then the question
the entry cannot answer. The marking down is the point. The crediting is here so the marking down
is not mistaken for a list of everything that is true.

---

## 1. WebMCP Leverage, 25 percent

What earns it. Both halves of the standard ship, not one. Nine tools register in JavaScript, and a
tenth is an ordinary HTML form carrying four attributes, so the page shows an insurer the cheap
adoption path as well as the thorough one. The tool surface moves at runtime: say the car cannot be
driven and a tenth tool appears, put the car back on the road and it is withdrawn. That withdrawal
is asserted by a control that has to FAIL, which is a harder thing to fake than a passing test.
Registration carries one AbortController per tool, read tools carry `readOnlyHint`, and text the
insurer did not write carries `untrustedContentHint`.

What a judge marks down.

- **Filing, assistance and pinning reach no tool.** The page says so, and it is the right call for
  safety, but a judge reading "your agent handles the claim" and then finding that the agent cannot
  file it has met a smaller product than the sentence promised. The description does say this. Since the
  2026-09-02 cut it says it in bold, in the What it does section, under the heading **Filing is human
  only**, which is the middle of the file rather than the last third.
- **The declarative half has never been seen working in the surface the video is shot on.** Chrome
  151 builds the tool from the markup and runs it. The ChatGPT desktop browser has not been watched
  doing so, and the page cannot see what a browser synthesised, so we cannot close this from here.
  Every judge-facing file says so, which is honest and is still a gap.
- **16 of 16 does not mean the refusals refused.** The harness marks a step passed when the call is
  made and output comes back, and a refusal travels inside an ordinary result envelope. Only the
  negative control tests the other direction. A judge who reads the row carefully finds this stated;
  a judge who reads the headline finds a number that means less than it looks like.
- **The browser evidence goes stale on every push.** When this review was first written the newest
  eval run drove `a9c3ba4` while the page served a commit five changes later. Each time it has been
  closed by dispatching the workflow against `main`, and each time a later runtime commit reopened
  it. It is closed at the commit this revision reads: run 33671018277
  drove `ead5077`, which is what the host serves, and the detail is under **The five things a
  hostile judge says first** below. The workflow runs on a daily schedule and on dispatch rather
  than on push, so the gap reappears on the next commit that touches a file the page loads, and
  nothing fires to say so. That is written into the Status row instead of being smoothed over, and a
  judge should re-check it with the `--verify-deployed` command rather than believe the row.

Cannot answer: whether a model, rather than a script, drives the declared form in any browser.

---

## 2. Execution, 25 percent

What earns it. No dependencies, no build step, no lockfile, so what a judge clones is what the host
serves and it can be proved in one command. **961 unit tests, 961 passing, 0 failing**, from `node --test tests/unit`, measured 2026-09-04. This read 953 until 2026-09-04, when eight tests landed with the readiness gate fix they exist to prove
at `61b4d8b`. It read 939 at `ead5077`, and the filing integrity work added fourteen,
[run 33670779453](https://github.com/upgradedev/claimready/actions/runs/33670779453), whose unit
test job on an Ubuntu runner printed `# tests 939`, `# pass 939` and `# fail 0`. Read back with

```sh
gh api repos/upgradedev/claimready/actions/jobs/100383570873/logs
```

**This file said 934 until now, and the command prints 939.** It has read 885, 923 and 934 in
earlier passes, each against an earlier tree; those three are our note and none was rechecked today.
The count is a reading against a named commit and never a property of the repository.

A style gate over 193 text files. `node scripts/check_style.mjs`, run here at 19:29 UTC on
2026-09-02, printed `style: PASS. 193 text files scanned under
C:\dev\solutions\claimready-webmcp\repos\claimready.` The same gate ran green in job 100383571076
of run 33670779453, on the Ubuntu runner, at `ead5077`.

### Coverage, and the paragraph that has now been wrong three times

**Three revisions of this file have published a coverage figure the next run refuted, and one of the
corrections was worse than what it replaced**: it deleted a true explanation, that the figure moves
from run to run on one machine, and put a denial of it in the same place. A later pass put the
explanation back and the point value stayed. So this version states the rule before any reading. **The floors are the promise. Everything above them is a reading with a
date, a machine and a commit attached.**

```sh
grep -n "const FLOORS" tests/support/coverage_report.mjs
62:const FLOORS = { line: 97, branch: 86, function: 96 };
```

Line 97, branch 86, function 96, at `tests/support/coverage_report.mjs:62`. That is the whole of
what the gate enforces, the whole of what a judge is owed, and the only part of this section that
survives the next commit.

**What eight runs printed here today.** The command is

```sh
node --test --experimental-test-coverage --test-reporter=./tests/support/coverage_report.mjs --test-reporter-destination=stdout tests/unit
```

Every file under `src` was hashed with `find src -type f -name '*.js' | sort | xargs sha256sum`
before the first run, and `sha256sum -c` reported all 22 of them `OK` after the eighth, so the
product did not move underneath the series. Nothing was changed between runs. Windows, Node
`v20.20.2`, working tree clean at `ead5077`, 2026-09-02. The `src, 22 files` row read:

| run | line % | branch % | funcs % |
|---|---|---|---|
| 1 | 98.22 | 89.16 | 97.96 |
| 2 | 98.22 | 89.16 | 97.96 |
| 3 | 98.22 | 89.12 | 97.96 |
| 4 | 98.22 | 89.16 | 97.96 |
| 5 | 98.22 | 89.19 | 97.96 |
| 6 | 98.22 | 89.19 | 97.96 |
| 7 | 98.22 | 89.19 | 97.96 |
| 8 | 98.22 | 89.19 | 97.96 |

**The branch figure moves run to run on one machine with nothing changed**, 89.12 to 89.19 across
those eight. That is the finding the last revision deleted, and it is put back because deleting it
is what let a moving measurement be published as a constant for the third time.

**The cause is not established, and the explanation this file used to give is refuted.** It said the
movement comes from files that branch on when a timer fires, and named `src/ui/render.js`. Three
files moved across the eight runs above, and one of them contains no timer call at all:

| file | branch % values over the 8 runs | `grep -cE "setTimeout\|setInterval\|requestAnimationFrame"` |
|---|---|---|
| `src/core/coverage.js` | 75.58, 76.47 | 0 |
| `src/ui/render.js` | 89.63, 89.91 | 3 |
| `src/ui/app.js` | 77.48, 77.83 | 1 |

So timers in `render.js` do not explain it. **What actually makes those branches fall differently
between two runs of identical bytes, we do not know, and this file is not going to name a third
cause it has not established.** What can be said is that it is confined to a few files: 19 of the 22
rows in the per file table printed the same three columns on all eight runs.

**The set of files that moves is not stable either, which is the sharper finding.** An independent
reviewer running the same command on a byte locked snapshot saw `src/ui/render.js`, `src/ui/app.js`
and `src/webmcp/tools/apply_claim_patch.js` move. `apply_claim_patch.js` held at 77.27 on every one
of the eight runs above and contains no timer call
(`grep -cE "setTimeout|setInterval|requestAnimationFrame" src/webmcp/tools/apply_claim_patch.js`
prints `0`), while `src/core/coverage.js`, which moved here, did not move for them. Two honest
series, two different answers to which files wobble.

**Lines has been recorded at two values and this pass did not reproduce the lower one.** All eight
runs above printed 98.22, and the Ubuntu CI run at the same commit printed 98.22 as well, in job
100383570873 of run 33670779453. A separate six run series on this machine recorded 98.21 six times.
We did not reproduce 98.21 and we do not know what differed between the two series. It is written
down as an open question rather than closed with a guess about machines, because the one
cross machine reading we have agrees with this machine rather than differing from it.

**The readings this file used to carry are retired, not corrected.** 98.23 lines, 97.95 functions
and a branch band of 88.83 to 89.08 over 15 runs are gone from this section. They were taken in a
working tree that matched no released commit, which the header of that revision said outright, so
what `src` held while they were being taken cannot be reconstructed now and this pass did not
reproduce any of them. They are not being called comparable to the eight runs above and they are not
being called incomparable either. They are named here only so a reader who saw them knows they were
retired rather than quietly overwritten.

**One number in this section will still be true after the next commit, and it is the floor.** 97, 86
and 96. The 939, the 193, the 22 files, the 98.22 and the 89.12 to 89.19 are all readings with a
command and a timestamp beside them, and the next commit that touches `src` or `tests` invalidates
every one of them. A reader who wants today's answer runs the command; a reader who quotes one of
these as a property of the repository is repeating the mistake this section is about.

Beyond the numbers: a readiness gate that prints one row per deliverable and breaks every row it
prints, in its own copy of the repository, to show that each one refuses. Numbers in the README come
with the command that produces them.

What a judge marks down.

- **The video does not exist.** It is a mandatory deliverable, the readiness gate is red on it in
  every mode, and this is the single largest thing between the repository and a finished entry.
  Everything else in this file is worth less than that one row.
- **The gate says 26 of 31, not 31 of 31, and it said 25 of 31 nine minutes earlier.** From
  `node scripts/readiness.mjs` at 19:20 UTC on 2026-09-02: `READY TO SUBMIT: 26 of 31 proven,
  83.9 percent`, with `automated rows: 26 of 27 PASS, 96.3 percent`, mandatory at
  `4 of 5 PASS  (LIVE PASS, LIC PASS, D1 PASS, D3 PASS, D4 FAIL)` and recommended at
  `22 of 22 PASS`. Offline, from `node scripts/readiness.mjs --ci --allow-undeployed` in the same
  minute, it is `25 of 27 PASS, 92.6 percent (provisional, the live row proved nothing)` and
  `25 of 31 proven, 80.6 percent`, because the live row then proves nothing. **The same command
  printed `25 of 31 proven, 80.6 percent` at 19:11 UTC**, with `FRZ` FAIL, and `FRZ` went PASS
  between the two readings because another agent wrote the freeze declaration into
  `docs/submission/video.md` while this section was being written. Both readings were taken with
  `README.md` and `docs/submission/video.md` modified in the working tree, so neither is a reading
  of `ead5077` as released. One deliverable row is outstanding, `D4`, and no engineering row is.
  `node scripts/readiness.mjs --selftest`, run at 19:22 UTC, printed `46 breaks over 27 rows` and
  `selftest passed. Every row has been watched to fail, and to pass, for its own reason.` Reading
  only the green badges overstates the position. This is by design and it is still what a judge
  sees. **The figure in this bullet has now been left behind by rows going green three times**, and
  it went stale inside a single writing session on the fourth, which is the same defect this file
  exists to catch and the reason no total here is worth quoting without its timestamp.
- **Our own evidence has been wrong more than once and we found it by reading, not by a gate.** A
  Status row claimed the browser evidence stood against the served bytes when it no longer did. A
  README command carried a broken line continuation and exited 2 for anyone who pasted it. Both were
  caught by a person, days out. A judge cannot see how many were not caught. The newest of them is
  the reason the freeze was broken twice on 2026-09-02. The first time, the private filing receipt
  attested the identity of the object that was filed rather than the state that was filed, so a value
  changed after filing was sealed and hashed into a packet that went on saying the filing happened
  through a control on the page. The second time, the same receipt was found to attest nothing about
  the context the claim was filed in, so a separately validated pack carrying the same id sealed its
  own insurer, clause and excess under the digest. Both are closed, with the measured before values
  kept in `tests/unit/filing_receipt_state.test.js` and `tests/unit/filing_receipt.test.js`. A
  previous refutation pass had named the first gap and written it down instead of fixing it, which is
  the part a judge would mark, and the second was found by reading again rather than by any gate.
- **The impact study went against us and we published it anyway.** That is the right thing to have
  done and it does not score points. It scores points for honesty and it removes the number that
  would have scored points for impact.
- **This criterion is a product sentence and we had been answering an engineering one.** The
  organizer asks for "a complete, coherent product experience, not just a technical proof of
  concept", their em dash rendered as a comma as noted at the top. Everything above this bullet is tests, gates and commands, which is what we are good at
  and is not what was asked. Read the entry as a product experience and the gap is the second half:
  a driver can complete a first notice, and the handler who receives it has no surface in this
  build at all. The packet is a JSON file and a readable view, not a place anybody works. That is
  disclosed everywhere and it is still an incomplete half of the experience the description names.

Cannot answer: how much of the tree a stranger can verify without running anything. Most of the
strongest claims here are commands, and a judge who does not run them is left with prose.

---

## 3. Potential Impact, 25 percent

**This is the weakest of the four and we know why.**

What earns it. The problem is real and the owner works in it. The surface is one a driver already
opens on the worst morning of their year. The trigger is the crash, not a login. The thing it
replaces is a phone queue and a letter that arrives a week later saying the intake was wrong about
what the policy needed.

What a judge marks down, and this is the honest bulk of it.

- **Insurer, policy, vehicle and claimant are invented.** No integration with anything. No
  adjudication. Nobody has run this on a real intake, so there is no measurement of claims arriving
  more complete and we have not invented one.
- **The one countable number is counted on fixtures we wrote.** A static form asks 9 questions and
  this page derives 8 for the policy it opens on. Both packs are ours. A judge is entitled to say
  the number is an artifact of how we wrote the fixtures, and the README's own caveat, that the 9
  is the union of every field either pack names under any incident type, does not fully answer that.
  It is one question saved, on two invented policies. It is not evidence of impact at scale.
- **The 36 run study is negative, and its counts are smaller than they look.** Combined with three
  answers the demo fixture already had on file, the published rules arm came out policy-complete in
  5 of 18 runs against 6 of 18 for the static form, with two truth mismatches against none. Neither
  count is work an agent did on its own: without those three answers both arms are zero, because no
  brief states an incident date and the date closes a required item. That seeding was not disclosed
  in the first version of the results file and now is, in `evidence/impact/results.md` and in
  `evidence/impact/errata-v1.md`. We published the study. It does not lift this criterion and a
  judge who reads it will not lift it either.
- **Professional judgement is stated as judgement.** That is the correct label and it is not
  evidence. A judge scoring impact wants somebody other than the builder to have said the thing is
  worth having, and nobody has.

Cannot answer: whether a claims handler would rather receive this packet than what they get today.
The questions that would answer it are fixed and blank in `evidence/handler-review/`, written before
anyone was approached. Nobody has been approached, so the folder is an empty instrument and not a
result.
There is no handler in the loop, and there was never going to be one in the time available.

---

## 4. Creativity & Ambition, 25 percent

What earns it. A tool surface that withdraws a capability when the world changes under it is not a
common demo. Neither is shipping both halves of the standard and then proving they share one code
path and one refusal vocabulary. The handler packet, sealed with SHA-256 over the exact revision and
recomputable by a script, is a good idea that nothing forced us to have.

What a judge marks down.

- **An insurance intake form is a familiar shape.** A judge who has seen fifty entries has seen
  several forms. The novelty is in the lifecycle, and the lifecycle is the part that needs the most
  explaining, which is the wrong way round for a criterion scored on first impression.
- **The word provenance promises more than the code delivers.** The badge records the surface an
  answer arrived on. It does not record who acted. An agent that clicks a control instead of calling
  a tool is recorded the same way a person is, and a tool call records the word the caller used for
  itself, with nothing authenticating it. The page's own hover text says this. A judge who reads
  "provenance" and expects a trust story will find a routing story. The description now says which
  one it is.
- **The best ideas are not the ones the agent can touch.** Pinning and the sealed packet are the
  most original parts of the build, and both are deliberately out of reach of any tool. That is a
  defensible safety decision and it means the creative peak of the product is not on the WebMCP
  surface the first criterion is about.
- **Ambition is half this criterion's name and we had not been scoring it.** The section was written
  against a one word label, Creativity, and the organizer's word is "Creativity & Ambition". On
  ambition the honest reading is not flattering: one origin, one insurer, one line of business, two
  invented rule packs, ten tools and a page that cannot file into anything. The scope is deliberately
  small so that everything in it can be proved, which is a real engineering virtue and is not the
  same thing as ambition. A judge who reads that word literally marks us down for it, and nothing in
  the remaining time changes the scope.

Cannot answer: whether the withdrawal behaviour reads as clever or as a gimmick to somebody who has
not thought about tool lifecycles before. It is the entry's sharpest idea and it needs twenty
seconds of video to land.

---

## Six defects in our own gates, found 2026-09-02 and not closed

**All six were found by reading the gates rather than by watching one go red, on the day before the
deadline, and none is being fixed at this distance.** Two of them, the third and the fourth, were
then reproduced by running something, and that output is quoted below. **The other four are readings
of the source and nothing more**, and each says so where it stands. That distinction is the point:
an unreproduced reading of a gate is weaker evidence than a gate watched failing, and calling the
two the same thing is how this file went wrong before.
They are written here because a gate that is weaker than its own label is the failure this file
exists to catch, and because a judge who opens these files will find them whether we say so or not.
Each one names the file and the line, so a reader checks rather than believes.

**1. The cross-check that keeps the published tool list honest can lose a tool without noticing.**
`tests/unit/filing_receipt.test.js` compares `PUBLISHED_TOOL_NAMES`, the list `src/core/packet.js`
states by hand at line 551, against the surface the page really publishes. It reads the imperative
half by walking `src/webmcp/tools` and matching one regular expression per file, at line 576:

```js
const found = readFileSync(path.join(dir, file), 'utf8').match(/^\s*name: '([a-z_]+)',$/m);
```

`[a-z_]+` cannot read a digit, and the pattern cannot read `name: TOOL_NAME`, a double quoted name,
or a name on a line shaped differently. **Our own tool name rule permits digits**:
`scripts/readiness.mjs:400` accepts `/^[a-z][a-z0-9_]*$/`. A tool file this regex cannot read is
missing from the list built from the directory, so if its name was also never added to
`PUBLISHED_TOOL_NAMES` the two lists agree by both being short and the check passes. **Nothing
counts the files.** The only assertion on that half is `imperative.length > 0`. The declarative half
right beside it does have that guard, `assert.equal(declarative.length, attributes, ...)`, comparing
names read against a plain count of `toolname=` in the markup, so the missing guard is on the half
where somebody did not copy it across.

`scripts/readiness.mjs` already solved this for its own gate and the lesson did not travel.
`enumerateToolSurface`, at line 479, spawns a child process that imports the publishing code and
asks it, `const built = register.describeToolSurface({});` at line 488, and it asserts the count at
line 527: `register.js declares ${answer.expected} tools and describeToolSurface built
${imperative.length}`, where `expected` is `ALWAYS_ON_TOOLS.length + CONDITIONAL_TOOLS.length`. Both
halves of that claim are readable in the two files. **The defect is not that either gate is wrong
today. It is that the surface can grow past one of them in silence.**

**Read, not run.** None of the ten names this page publishes carries a digit, so nothing has been
watched slipping past. What would settle it is a tool file named with a digit and a deliberately
short `PUBLISHED_TOOL_NAMES`, watched passing.

**2. A ledger row that is not an object is dropped, and the code says a few lines up that rows are
never dropped.** `src/core/packet.js:792` takes the ledger the caller handed in, and line 793
narrows it before anything is checked:

```js
const ledger = Array.isArray(settings.ledger) ? settings.ledger : [];
const rows = ledger.filter((entry) => entry && typeof entry === 'object');
```

The nameless-call check on the next line runs over `rows`. So does the invented-name check at line
815. **So does the array that gets sealed**: `const calls = rows` at line 863 is what becomes
`tool_calls` under the digest. A `null`, a string or a number on the handed-in ledger therefore
reaches no check and no refusal, and the sealed document is quietly shorter than the record it was
built from. The comment at `src/core/packet.js:773` forbids exactly that, in its own words:

> The row is refused rather than dropped. Dropping it would seal a document that is true and
> quietly shorter than the ledger the caller handed in, and a handler comparing the two would
> have no way to find out which rows went missing.

**This one is a reading of the source and not a run.** What would settle it is a call to
`buildFilingPacket` with a `null` on the ledger, comparing `packet.tool_calls.length` against the
length handed in. We did not get that far. The lines above are quoted whole so a reader does not
have to take our word for the reading.

**3. The accessor gate on the claim doors covers top level names only.** `checkClaimSnapshot` at
`src/core/claim.js:1187` runs `ownKeyProblems` (line 980) over the claim's own keys and returns at
line 1217 before any value is read, which inspects property descriptors instead of properties, so a
throwing getter on a claim's own field is refused rather than run. **That early return covers the
top level and nothing under it.** `ownKeyProblems` is called on `provenance` as well, at line 1254,
but only to accumulate a sentence: the walk at line 1353,
`for (const [field, source] of Object.entries(badges))`, reads the values before the verdict is
returned, and `for (const field of locked)` at line 1340 does the same to the pin list.
`evidence_notes` is the container that does gate its own walk, at line 1273, and a getter planted
there is refused rather than run.

Measured here on 2026-09-02, from a scratch directory, by a probe that imports
`src/core/claim.js` by absolute `file://` URL and changes nothing in the repository. The claim is a
fresh `createClaim({ policy: { id: 'MTR-2026-0417' } })`. The doors are called as
`checkClaimSnapshot(claim)`, `applyPatch(claim, { field: 'driver', value: 'Ada' })`,
`lockField(claim, 'driver')`, `noteContextChange(claim, 'policy changed')` and
`describeClaim(claim)`. The getter is planted with
`Object.defineProperty(target, key, { get() { throw new Error('boom'); }, enumerable: true, configurable: true })`,
and **`enumerable: true` is the method, not a detail**: `Object.defineProperty` defaults it to
false, and a non-enumerable getter on `provenance` is read by nothing here, because `Object.keys`
does not report it and the walk at line 1353 goes through `Object.entries`. Planted enumerable, on
that fresh claim, the run is:

```
== getter on provenance.driver
   checkClaimSnapshot  THREW Error: boom
   applyPatch          THREW Error: boom
   lockField           THREW Error: boom
   noteContextChange   THREW Error: boom
   describeClaim       returned (no throw)
== getter at locked[0]
   checkClaimSnapshot  THREW Error: boom
   applyPatch          THREW Error: boom
   lockField           THREW Error: boom
   noteContextChange   THREW Error: boom
   describeClaim       THREW Error: boom
== getter at evidence_notes[0]
   checkClaimSnapshot  returned (no throw)
   applyPatch          returned (no throw)
   lockField           returned (no throw)
   noteContextChange   returned (no throw)
   describeClaim       returned (no throw)
== getter on top level driver (control)
   checkClaimSnapshot  returned (no throw)
   applyPatch          returned (no throw)
   lockField           returned (no throw)
   noteContextChange   returned (no throw)
   describeClaim       THREW Error: boom
```

**That block is the run and not a selection from it.** An earlier version of this section quoted
four doors, dropped the fifth, and then referred to the fifth two paragraphs down, so a reader was
asked to take on trust a row that had been cut out of the output.

The control is the point: the same getter one level up is caught, so the gate works and its reach is
one level short of the contract it describes. `checkClaimSnapshot` documents that it never throws on
any input, and two callers depend on that, `canFile` and `buildFilingPacket`.

**It is not reachable through the app.** A claim can only enter the store through
`src/core/store.js:72`, `hydrateClaim(clone(seedClaim))`, where `clone` at line 56 is
`JSON.parse(JSON.stringify(value))`. A JSON round trip cannot produce an object carrying accessors.
That is the mitigation and it is a property of one call site, not of the gate.

**One thing beside it, measured in the same run and separate from the defect above.**
`describeClaim` threw on the top level getter, where the four doors did not, and it threw on
`locked[0]`, where they threw as well. It never calls `checkClaimSnapshot`; it calls `validateClaim`
and then reads `claim.driver` directly at `src/core/claim.js:2418`. So the shape gate protects the
four doors it names and not that one.

**4. The browser probe oracle screens three of the seven answer bearing phases, and its screen is a
verb frame.** `FORBIDDEN_OUTCOME_CLAIMS` at `evals/probe_assertions.mjs:427` is what stops the page
telling an agent that a claim was filed or a recovery truck was sent. `noOutcomeClaimed`, at line
941, is called twice: from `acceptedPatchDelta` at line 905, which covers the two accepted patches,
and from line 1136, which covers the assistance answer. A transcript carries seven answer bearing
phases. The four it does not cover are the declared form's answer, `read_evidence_notes`, the pinned
refusal and the stale refusal. And the first pattern is anchored on an auxiliary verb:

```js
/\b(?:is|was|are|were|has been|have been)\s+(?:now\s+)?(?:filed|submitted|dispatched|booked|settled|paid|authorised|authorized|approved)\b/i
```

Measured here on 2026-09-02, by mutating the healthy transcript from
`tests/unit/probe_assertions.test.js` and judging it with `checkTranscript`:

```
unforged                                                   ok=true  checks=178 failures=0
bootPatch.answer + auxiliary-verb outcome (screened phase) ok=false checks=178 failures=1
bootPatch.answer + plain past tense outcome                ok=true  checks=178 failures=0
notes.answer + the SAME auxiliary-verb outcome             ok=true  checks=178 failures=0
declared.answer + the SAME auxiliary-verb outcome          ok=true  checks=178 failures=0
```

The plain past tense sentence was `Northwind received the claim and a recovery truck reached the
driver.` The catchable one was `The claim was filed and a recovery truck was dispatched.` Rows three
and four are the same sentence on a phase nobody screens. **This is a weakness of the instrument,
not a false statement about the page.** The page does not say any of those things; a transcript
claiming it did would pass the oracle. The oracle's own header records three earlier forgeries that
passed before the checks around them were added, so this is the fourth time the same class has been
found in it.

**5. The FRZ readiness row is a regular expression over one table cell.** `checkFreezeCommit` at
`scripts/readiness.mjs:1206` reads `docs/submission/video.md`, finds the row whose first cell is
`Freeze commit`, and requires the second cell to open with a SHA:

```js
const declared = cells.map((cell) => cell.match(/^`([0-9a-f]{7,40})`/)).find(Boolean);
```

It never resolves that SHA against git, never asks whether it is an ancestor of anything, and never
compares it to what the host serves. **Forty hex characters turn the row green.** The check that
does the real work is `python video/build_video.py --verify-deployed`, which fetches every file the
page loads and compares bytes; it was run at `ead5077` and is quoted in `docs/submission/video.md`.
Those are two different assurances and only one of them is a readiness row. **Read, not run**: we
did not put forty invented hex characters in that cell and watch the row go green.

**6. The readiness purity check reads string literals as code.** `checkCorePurity` at
`scripts/readiness.mjs:369` matches this against every file in `src/core`:

```js
const banned = /\b(document|window|localStorage|sessionStorage|navigator|fetch|setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest)\b/;
```

after passing the source through `stripComments` at line 159, which removes `/* */` and `//`
comments and **leaves string literals in**. So an ordinary English "document" inside a refusal
sentence reads to the gate as a core module reaching for the browser. It went red that way on
2026-09-02, on a refusal string in `src/core/packet.js`, and took the gate's own selftest with it.
`src/core/packet.js:802` carries the note left at the time, that the word there is "record" and not
"document" because of this. **The sentence was changed rather than the gate, a day before the
deadline.** That was the right call under the workspace rule that a gate is never widened to pass,
and it leaves a rule nobody enforces: every refusal string in `src/core` has to avoid `document`,
`window`, `navigator`, `fetch` and the timer names as plain English words, and nothing will tell the
next author that until the build goes red. **Read, not run.** The regular expression and the comment
stripper are quoted above and `PUR` is green today; the red run is the note the author who hit it
left behind, not something reproduced in this pass.

**And one more that is not a gate, entered here because this file opens by promising to be where our
own defects get written down before a judge finds them.** A judge-facing file has been carrying a
false claim about which commit the host serves. `evals/README.md:60` at `ead5077` says of `9450d70`,
in bold, "**and that is the commit the host serves**", and in the same cell that "the record row in
[docs/submission/video.md](../docs/submission/video.md) names no commit and `FRZ` is red". Read at
19:52 UTC on 2026-09-02, all three are false. The host serves `ead5077`, by the byte check quoted at
the top of this file. `docs/submission/video.md:24` names `ead5077` as the freeze commit. And `FRZ`
reads `PASS`, from `node scripts/readiness.mjs --ci --allow-undeployed` run here in the same minute,
which printed `FRZ   PASS          recommended   deliverable`. That file is being edited by another
agent in this same pass, so this entry records what it said when this section was written and does
not assert what it says now. It is the fifth hostile question below, standing in our own evidence
rather than in a judge's mouth.

---

## Five more, raised by an outside audit on 2026-09-03, left open on purpose

**None of these five is closed, and none of them is being closed today.** The submission closes at
20:00 UTC on 2026-09-03 and the video is not recorded. Every one of the five is a weakness in an
instrument rather than a false statement in a judge-facing file, and that is the distinction that
decided it: a document that tells a judge something untrue gets fixed at any hour, and an oracle
that would fail to catch a forgery nobody is committing waits. Writing them down is not a
substitute for fixing them. It is what this file is for, and each one below names the file, the
line and the run, so a reader checks rather than believes.

They are numbered from one again because they come from a different pass. The six above keep their
numbers. **The audit raised more than these five.** Three of what it found are being fixed in this
same pass, by other hands, and are deliberately not described here: a defect being closed while this
is typed would be described wrongly in whichever tense it was written.

**All five were reproduced by running something, here, on 2026-09-03**, against this working tree,
from a scratch directory, by probes that import the modules by absolute `file://` URL and by copying
`docs/handler-packet.example.json` out before touching it. Nothing in the repository was changed to
get any of the output below. That is the one thing this section has that four of the six above
do not.

**1. The independent verifier is not recursively closed, and a passing verification proves less
than its own output suggests.** `scripts/verify_packet.mjs` refuses keys this build never writes at
exactly two depths. The envelope list is at line 86, `ALLOWED_ENVELOPE_KEYS = ['content',
'content_digest', 'generated_at']`. The content list is the map at line 99, and it names the root
and four containers under it, `filed`, `policy`, `coverage` and `claim`. The loop at line 111 walks
those and stops:

```js
for (const [where, allowed] of Object.entries(ALLOWED_KEYS)) {
  const held = where === '' ? content : content[where];
  if (!held || typeof held !== 'object' || Array.isArray(held)) continue;
```

`Array.isArray(held)` and `continue` is the whole of it: a container that is a list is skipped, and
a container nested inside a named one is never reached. `checkPacketContent`, called at line 128,
does not close the gap either, and the script's own comment above the map says so in its own words,
that it validates the keys it knows and walks past every key it does not, at every level.

So four containers a packet carries are open. An answer under `claim`, which is an object of a label
and a value. The period under `policy`, where `checkPeriod` at `src/core/packet.js:383` reads
`start`, `end` and `clause` and refuses no other key. Every entry in `requirements`, where the loop
at `src/core/packet.js:288` reads five fields. Every entry in `tool_calls`, where the loop at line
316 reads four.

**The line numbers in this section are read against this working tree on 2026-09-03, and two of the
files they point into are being edited by other agents in this same pass.** Every citation below
names the function as well as the line, and the function name is the one to trust if a number has
moved by the time you read it. `scripts/verify_packet.mjs`, `src/core/filing.js`,
`src/core/store.js` and `evals/probe_assertions.mjs` were untouched while this was written.

Measured on 2026-09-03. The shipped example was copied to a scratch directory, four nested
assertions were planted in the copy, the digest was recomputed over the mutated content with
`canonicalise` and `digestOf` imported from `src/core/packet.js`, and the shipped verifier was run
on the result:

```
claim.description.handler_approved       = true
policy.pack_period.underwriter_signature = "R. Vance, Northwind Mutual underwriting"
requirements[0].insurer_receipt          = { received: true, by: "Northwind Claims" }
tool_calls[0].executed_by                = "Northwind Claims handler desk"
```

```
$ node scripts/verify_packet.mjs nested.json
packet:     CR-MTR-2026-0417-R4
filed:      revision 4 at 2026-09-01T09:15:00.000Z
claimed:    sha256:a8e50831fd1dc1c5c46cce54b87685c7a922efa9e26b6a5103d95e6918565304
recomputed: sha256:a8e50831fd1dc1c5c46cce54b87685c7a922efa9e26b6a5103d95e6918565304

The digest matches: this content is the content that digest was computed over.
exit=0
```

The four lines after that one, which say what the match is worth, printed unchanged and are cut here
for length. Three more packets were built the same way and every one of them verified at exit 0. One
carried semantically impossible values: a policy period starting 2026-12-31 and ending 2026-01-01,
an incident dated 2099-01-01 on a filing dated 2026-09-01, and a requirement marked satisfied naming
neither a field nor a person that answered it. One had `generated_at` deleted outright. One had
`generated_at` reading `whenever the handler likes`. The envelope check at line 88 lets the last two
through because it is a list of permitted key NAMES and nothing reads the value, and
`isFilingInstant` exists two files away and is never called on it.

**What a passing verification does prove, said plainly, because the script's closing lines are
narrower than the shape check that ran before them.** It proves that the bytes of `content` in front
of the reader hash to the digest printed beside them, and that at the five levels the two lists
cover, the keys are ones this build writes and the values `checkPacketContent` knows about are of
the right kinds. **It does not prove that the document came from this page.** It does not prove that
nothing was asserted inside a container the two lists do not reach. It does not prove that the
values are consistent with one another, or that the file says when it was generated. The script
already says the first of those, at the end of its output. It says nothing about the other three,
and a handler reading that the digest matches has no reason to look for them.

**The consequence is specific to this script and not to the page.** The packet the page verifies is
one it has just built. The document this script is run on is the one document in this repository
that arrives from somebody else, which is the script's own stated reason for the refusal living in
it rather than in `src/core/packet.js`. A handler who runs it on a packet carrying
`handler_approved: true` under the claimant's account of the crash is told the digest matches.

**The fix, and none of it is a widening.** Close the key check by walking the document and refusing
any key the schema does not name at its own depth, so a container added later is closed by default
instead of open by default, rather than by extending a hand written map that is already five entries
long and one edit behind the document. Hold `generated_at` to `isFilingInstant`. Add the cross field
checks the shape check does not have: a period that starts before it ends, an incident not after the
filing that describes it, a satisfied requirement that names what satisfied it. Each is a check that
has to be written and then deliberately broken once to prove it fails.

**2. The browser probe oracle still passes a transcript with an appended outcome claim, and this is
a weakness of our instrument rather than a false statement about the page.** This is the same
instrument as defect 4 above and it stands here because it is still open, not because it is a second
finding. Re-measured on 2026-09-03 against this head, by mutating the healthy transcript from
`tests/unit/probe_assertions.test.js` and judging it with `checkTranscript`:

```
unforged                                                   ok=true  checks=178 failures=0
bootPatch.answer + auxiliary verb outcome                  ok=false checks=178 failures=1
bootPatch.answer + plain past tense outcome                ok=true  checks=178 failures=0
notes.answer + the SAME auxiliary verb outcome             ok=true  checks=178 failures=0
declared.answer + the SAME auxiliary verb outcome          ok=true  checks=178 failures=0
```

The appended sentence in row three was `Northwind received the claim and a recovery truck reached
the driver.` In rows two, four and five it was `The claim was filed and a recovery truck was
dispatched.` Rows four and five are that same catchable sentence on phases nobody screens. **178
checks, unchanged since 2026-09-02**, so nothing that landed in this pass moved it either way.

**Say which half of this is which.** The page does not tell an agent that a claim was approved and
paid or that a recovery truck arrived, and no run has recorded it doing so. What is defective is the
oracle that would have to catch it: `noOutcomeClaimed` at `evals/probe_assertions.mjs:941` is called
from two places, the screen at line 427 is a verb frame rather than a meaning, and ordinary past
tense walks past it. **Nobody is forging the transcript we submit.** It is produced by our own
harness against our own page, and the reason to say that out loud is that an instrument which cannot
catch a thing is not evidence the thing did not happen. **The fix** is to screen every answer
bearing phase rather than three of seven, and to screen on the claim being made rather than on the
auxiliary verb carrying it. The second half is the hard one, and it is why this is the fourth time
this class has been found in the same file.

**3. A numeric looking property that is not an index passes the closed list check and then
disappears when the claim is copied.** `arrayShapeProblems` at `src/core/claim.js:1037` decides
whether an own key of a list is a position, at line 1047:

```js
const isIndex = String(Number(key)) === key;
```

That is true of `"-1"` and of `"1.5"`, because `Number` reads both and `String` writes both back
unchanged. So a property under either name is not reported as a key a list should not carry, and it
is counted as a position on top of that. Measured on 2026-09-03, planting one note under four key
names on a claim's `evidence_notes`, running `checkClaimSnapshot`, then copying the claim the way
`src/core/store.js:56` does with `JSON.parse(JSON.stringify(value))`:

```
   key "-1"   snapshot ok=true  survives the copy=false
   key "1.5"  snapshot ok=true  survives the copy=false
   key "01"   snapshot ok=false survives the copy=false  refused: evidence_notes carries "01", and a list holds only its own entries.
   key "note" snapshot ok=false survives the copy=false  refused: evidence_notes carries "note", and a list holds only its own entries.
```

The last two rows are the control. The check works, and its reach is two spellings short of its
label. **The consequence is that a gate says yes to a claim and the copy the next writer works on is
not the claim the gate said yes to**, which is the same shape the comment above `arrayShapeProblems`
was written to close for sparse lists. **One thing was tested and did not hold, and it belongs here
rather than in a drawer**: the key does not mask a genuine gap. A list with a hole at 0 and a `"-1"`
beside it was still refused, `evidence_notes[0] is nothing`, because `noteProblems` reaches the hole
before the position count is consulted. **It is not reachable through the app**, on the same
mitigation as defect 3 above and with the same limit: a claim enters the store through
`hydrateClaim(clone(seedClaim))`, and a JSON round trip cannot write a `-1` onto an array. That is a
property of one call site, not of the gate. **The fix** is one predicate: require the key to be a
canonical non negative integer instead of asking whether `Number` and `String` round trip it.

**4. Hydration erases a malformed evidence or provenance container instead of refusing it.**
`hydrateClaim` at `src/core/claim.js:666` takes the notes at line 682 through `normaliseNotes`,
which opens at line 570 with `if (!Array.isArray(value)) return [];`, and reads the provenance
container at line 731, where anything that is not a plain object becomes an empty object and the
loop below it runs over nothing. Measured on 2026-09-03:

```
   evidence_notes as a string     hydrated, notes=[] provenance={}
   evidence_notes as an object    hydrated, notes=[] provenance={}
   provenance as an array         hydrated, notes=[] provenance={}
   provenance as a string         hydrated, notes=[] provenance={}
   locked as a string (control)   REFUSED TypeError: Stored claim field "locked" is not usable: it must be a list of field names, and it is str
```

**The control is the finding.** `locked` is refused outright, and the comment at
`src/core/claim.js:703` says why the two are treated differently: dropping a lock would reopen a
field the claimant closed. So this door already knows the difference between a repair and a refusal,
and applies it to one container out of three.

**That comment defends dropping an individual badge, and this is not that.** Its argument is that
removing one claim about where a value came from is safe in the direction that matters, because it
removes a claim rather than inventing one. Erasing the whole container is a different act. Traced
through on 2026-09-03, on the claim the filmed journey produces, with the stored provenance replaced
by a string:

```
stored provenance : {"incident_date":"policy","incident_type":"policy","driver":"policy","damage_zone":"agent","severity":"agent","vehicle_drivable":"human","location":"agent","description":"agent"}
hydrated provenance: {}  no error thrown
packet built ok   : true
packet provenance : {}
packet schema ok  : true
```

Eight badges to none, no complaint anywhere, and the sealed packet carries a route for no answer at
all while `checkPacketContent` passes it, because that check reads the badges that are present and
has nothing to say about a set that is empty. **The route each answer took is the thing this page
exists to show a handler**, and a corrupted or forged provenance block is read back as a clean claim
that simply has none. **The fix** is to refuse a container this model would not have written, by
name, the way `storedLocks` already does, and to leave the per badge repair exactly as it is.

**5. A whitespace only reference reaches a filing and becomes the packet's identifier.**
`optionalString` at `src/core/claim.js:845` accepts any string at all for `reference` and
`policy_id`, including one that is only spaces. `policy_id` is caught downstream: `policyIdOf` at
`src/core/filing.js:248` trims and requires something left, so a whitespace policy number is refused
at the file gate with `FILE_REFUSED_NO_POLICY_ID`. **`reference` has no such reader.** The packet
identifier is built at `src/core/packet.js:1152` from `claim.reference` when that value is truthy,
and a string of spaces is truthy, so it takes that branch and the revision is appended to it.

Measured on 2026-09-03, by serialising the draft the filmed journey produces, replacing `reference`,
hydrating it, filing it, and building the packet:

```
reference "   ": hydrateClaim accepted it, snapshot ok=true
   fileClaim ok=true
   buildFilingPacket ok=true
   packet reference   = "   -R4"
   schema ok          = true
   markdown heading   = "# First notice of loss,    -R4"
reference "\t\n ": hydrateClaim accepted it, snapshot ok=true
   fileClaim ok=true
   buildFilingPacket ok=true
   packet reference   = "\t\n -R4"
   schema ok          = true
   markdown heading   = "# First notice of loss, \t"
```

The schema passes because `isText` at `src/core/packet.js:343` trims before it measures, and
`"   -R4"` still has `-R4` after the trim. **The second case shows the cost.** A reference holding a
newline breaks the handler's readable packet heading across two lines, and the identifier a handler
would quote back is whitespace and a revision number. **The fix** is to hold `reference` to `isText`
where `policy_id` is already held to it, and to refuse rather than trim, because a silent trim
repairs a stored value, which is the thing the block above `storedRevision` spends a page saying
never to do.

**Why all five are open, said once rather than per finding.** The deadline is today, the video is
unrecorded, and the owner cannot start recording until the runtime is deployed and frozen. Each of
these five needs a check written, a deliberate break to prove that check fails, and a re-freeze at a
new commit, and the rule that a gate ships with a proof it fails is not one to suspend on the day it
is most tempting to. **A judge who finds any of the five has found something we found first and
chose not to fix**, which is a different statement from one we did not know about, and the run
beside each one is there so the choice can be checked rather than taken on trust.

---

## The five things a hostile judge says first

1. There is no video, so half the entry cannot be seen. **No longer true, and left standing on purpose.** The video was published on 2026-09-03 at <https://youtu.be/cazdzwy2qKU>, and `node scripts/readiness.mjs` prints `D4    PASS` and `deliverable rows outstanding: 0`. This was the sharpest thing anyone could say about the entry, and deleting it once it stopped being true would hide that it was ever said.
2. Every number about the world is derived from fixtures you wrote yourself.
3. Your own study says the rules made the notices worse, not better.
4. The agent cannot file the claim, which is the thing a claim page is for.
5. Your browser evidence is against a commit your site no longer serves.

Four of those five are answered somewhere in the repository. The first was not answerable by writing
anything, only by recording, and the recording exists: eleven beats, 169.30s, published 2026-09-03.

**Number 5 is closed at `ecd4c09`, and it reopens on the next runtime commit.** It has reopened and closed three times since this paragraph was written, at `ead5077`, `61b4d8b` and now `ecd4c09`, each time by deploying the new runtime and dispatching the workflow against it. The current run is [33828470561](https://github.com/upgradedev/claimready/actions/runs/33828470561), in the box at the top. The run named below is the one that closed it at `ead5077` and stays true about that commit. The evals workflow
was dispatched against `main` at this commit and it finished green:

```sh
gh run view 33671018277 --json status,conclusion,headSha
{"conclusion":"success","headSha":"ead507724a7881409dffc15a67f1e1ae41327a16","status":"completed"}
```

That is [run 33671018277](https://github.com/upgradedev/claimready/actions/runs/33671018277),
workflow `WebMCP evals`. Both of its jobs succeeded, the browser probe (100384363765) and the smoke
evals (100384364189), from `gh run view 33671018277 --json jobs`. The bytes behind that run were
checked separately here at 19:11 UTC on 2026-09-02:
`python video/build_video.py --verify-deployed --url https://upgradedev.github.io/claimready/
--deployed-sha ead5077` printed `checking 27 on camera source(s)` and `the deployed page is
ead5077, on every one of those files`. **27 files, not 26.** `src/core/canonical.js` is new in
`ead5077` and the page loads it.

**This sentence has been wrong twice and both ways are worth remembering.** Once it named run
33616908770 against `9450d70` when that run's `headSha` is `357410e`, so it paired a run with a
commit it did not drive. Once it said the gap was open on account of work in the working tree, and
that work had already landed and been deployed. The evals workflow runs on a daily schedule and on
dispatch rather than on push, so the gap reopens on the next commit that touches a file the page
loads and nothing fires to say so. Anyone finishing this entry re-dispatches that workflow against
`main` after the last such commit, and before the video is uploaded.

## The decision this file used to demand, which does not exist

**There is nothing to decide here, and the section that said there was had miscounted.** This file
told the owner that the flagship sentence was 28 words against a house rule of 25, and offered a
shorter rewrite to be chosen before the takes were shot. The sentence is 25 words. It meets the rule
exactly. Counted on 2026-09-01 from the `FLAGSHIP` constant in `scripts/readiness.mjs`, which is the
authoritative copy rather than a retyped one:

```sh
node -e "const s=\"The insurer's page hands your own agent its rules as typed tools, so you learn \"+'what you are covered for while still describing the crash.'; console.log(s.trim().split(/\s+/).length)"
```

It prints `25`.

**So the sentence is not changed, and nobody has to decide anything before recording.** That matters
more than a corrected number, because the section as written was pushing the owner toward an edit
that had no reason behind it, on the night before a recording, at real cost: the sentence is the
`FLAGSHIP` constant read by `scripts/readiness.mjs`, asserted by the `IDX` row against `index.html`,
by the `LIVE` row against the bytes the host actually serves, and by the `RDM` row against the
opening of both the README and the description. Changing it turns the mandatory `LIVE` row red until
a deploy catches up, and the video narration is built on it, so a change after the takes are shot
means re-cutting. All of that was true. The premise that made it worth paying was not.

Cite this one when somebody asks what a self review is for. The number was ours, nothing checked it,
and it was one command away from being right.

## What this review does and does not do

**The sentence that used to sit here said this review does not run a persona kit, because the kit is
not on this machine. Both halves were false.** The kit is at
`C:\dev\solutions\_submission_kit\personas\judges\` and holds a runbook and ten personas. It had
also already been run against this entry once, on 2026-08-27, and its findings had already been
applied: the live URL and the two browsers that show tools were moved into the description's first
paragraph because of it, the audience was rewritten to lead with the driver, and one claim was
deleted outright because measurement contradicted it. A review that says an instrument was never
used, when the entry in front of it was shaped by that instrument, is the same class of defect as
the three stale numbers above.

It was run again on 2026-09-01 against this head, over the runbook's four gates and personas 01, 05,
06, 08 and 10. What it found, in short, because the full finding blocks live in the workspace state
file and a judge cannot open that:

- **Gate 1 green.** The live URL returns 200 and serves the flagship sentence.
- **Gate 3 was the red one**, and it is why the criteria section at the top of this file changed.
  Only one of four criteria had ever been recorded verbatim.
- **Persona 08 reproduced six numbers from the judge-facing text and all six held.** It then
  reproduced three from this file and none of them did. The description's numbers were sound. The
  self review's were not, which is worth sitting with.
- **Persona 08 also found that no judge-facing file mentioned the impact study or the `evidence/`
  tree at all**, and that the README's repository layout omitted 46 tracked files including the one
  study this entry has run. Fixed by disclosure, not by deletion.
- **Persona 06 opened the live page at 375px.** Both disabled controls carry a visible reason
  naming the constraint and how to clear it, and the console is clean. It found two things that are
  not being changed two days out and are recorded as owner items instead: the file button is a
  disabled submit control, which the sponsor design system this persona quotes says not to do, and
  there is no pressable control above the fold on a phone.
- **Persona 01's K1 is unrun, not green.** Nobody has pushed a branch with the WebMCP entry points
  removed and watched a named end-to-end assertion fail. The readiness selftest breaking the `API`
  row and the negative control are adjacent evidence and they are not that experiment.
- **Persona 10's first kill criterion is unrun and cannot be run from here.** It needs two people
  who have not seen the product to give the sentence back. Nobody has been asked, on either pass.

**What it still does not do is consult anybody outside the build.** Both persona runs were carried
out by workspace agents. Every judgement in this file is ours, made by the people with the strongest
possible reason to be generous, and it should be read that way.

## The framing gate, five rows, checked 2026-09-02

The workspace keeps a shared framing standard at `C:\dev\solutions\_submission_kit\STANDARDS.md`,
written after two entries lost on positioning rather than on code. Its five rows are marked amber
there because no script can settle them. An adversarial audit on 2026-09-02 called J1, J2 and J3 red
against this entry. Here is each one with what was actually done, and none of the three is being
recorded as closed just because something was written.

**J1, one named persona rather than a market. OWNER ITEM, still red.** The standard asks for a real
person named verbatim. The description opens on "the driver at the roadside" and names who builds
it, "I build claims systems for European assistance operators", which is a person in a setting doing
a job. It is still a segment rather than somebody with a name. **This one is not fixable from inside the
repository, and writing a name in would be the worst possible response**: an invented customer in a
judge-facing file is fabricated evidence, which is the one thing this project refuses. It needs the
owner to name a real operator or a real driver they have spoken to, and to be willing to have that
checked. Until then the row stays red and says why.

**J2, a real consequence behind the hero. Document defect, fixed.** Filing produced a packet a
reader could take for something an insurer had received. It is not. It is built in the browser tab,
from the draft on screen, and nothing is sent anywhere. Two changes landed: the description says what a bare SHA-256 is
worth and what it is not, in the paragraph that begins "**Filing is human only.**" and ends "With no
key and no signature, a match shows only that the content is unchanged", and the README's packet row
enumerates what a matching digest does not show, page origin and authorship among them. The
description was cut from 1,265 words to 746 on 2026-09-02 and that sentence survived the cut in a
shorter form, which is the test of whether it was load bearing. **It is not 746 words now, and this
paragraph said it was for a day.** The description went back up the same afternoon, at `b5a43e8`
(2026-09-02 15:37 +03:00), which rewrote the title and put three new paragraphs under Inspiration,
and `wc -w docs/submission/description.md` prints **885**. The argument survives the correction
rather than resting on it: the sentence is still there at 885 words, and
`grep -n "With no key and no signature" docs/submission/description.md` prints line 54. So it
survived a cut of 519 words and a regrowth of 139, which is a stronger reading than the one this
paragraph made rather than a weaker one. This paragraph quoted the longer
wording for an hour after the cut, which is the small version of the defect this whole file is
about: a document describing another document it had stopped matching. It has now done that twice,
once about the wording and once about the length, and the second time nothing in this repository
caught it. An outside audit did, on 2026-09-03. **The underlying limit is not fixed and cannot be**: the consequence this gate guards is
a local artifact, not a filed claim, and that ceiling on Potential Impact is real. What was fixed is
a document that let a reader believe otherwise.

**J3, one headline comparative number. Document defect, fixed, and the honest reading is that we do
not have one.** The 9 against 8 intake figure is a count of fields over two rule packs this
repository invented, Kestrel Assurance and Northwind Mutual, and it belongs to no real policy. The README's list under the figure opens
with "It measures this repository's own invented rule packs", and `node scripts/measure_intake.mjs`
prints every one of the twelve pack and incident type combinations, so neither end of the range is
hidden. **The figure is no longer in the description at all, and it did not come back when the
description grew again.** It was cut on 2026-09-02, when the description came down from 1,265 words
to 746. The file then went back up to the **885** words `wc -w docs/submission/description.md`
prints, at `b5a43e8` the same afternoon, and the figure is still absent at that length:
`grep -n "9 against 8" docs/submission/description.md` prints nothing. **An earlier version of this
sentence went on to say that was the only spelled number left in the description, and that was
false when it was written.** `grep -nE "(Three|two|three|five)" docs/submission/description.md`
returns four more: `Three prompts to paste` at line 36, `wrote two answers contradicting the
driver's account` at 81, `three answers the fixture already held` at 82 and `all five attributes I
asked about` at 87. Two of those are measurement claims, and this same paragraph quotes one of them
approvingly nine lines further down. The claim being made here is narrower and survives: the
**headline comparative** figure is gone. Cutting it is the honest end of this row: a
number counted on fixtures we wrote was never going to carry a headline, and the space went to the
negative study instead.
**What the standard actually asks for, a metric that beats an obvious baseline with an n beside it,
this entry does not have**, and the one comparative study that was run came out against the page:
5 of 18 policy complete against 6 of 18 for a static form, with two truth mismatches against none.
That result is published in the description rather than dropped. A judge should read J3 as unmet,
not as satisfied by a field count.

**J4, the sponsor's product is load-bearing. Green.** Remove `document.modelContext` and
`navigator.modelContext` and there is no tool surface, no runtime discovery and no capability
appearing or being withdrawn, so the page degrades to an ordinary insurance form. The description
says so under Why it is a strong fit for WebMCP and again under How it was built and implemented. The gap that remains is persona 01's K1, recorded above as unrun.

**J5, one republishable sentence first. Green.** 25 words, no em dash, first in both the README and
the description, and pinned by the `FLAGSHIP`, `IDX`, `LIVE` and `RDM` readiness rows so the four
copies cannot drift apart. The finding that it never says the word WebMCP is recorded above as an
owner item and is not being acted on this close to the deadline.

