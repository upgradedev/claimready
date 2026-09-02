# Judge review, written against ourselves

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
`c93b138`. Revised 2026-09-01 against `ab2db69`. **Revised again 2026-09-02, and again not against
a released commit**, which is a weaker footing and is said rather than hidden: `origin/main` is
`12f7935`, the deployed runtime is `9450d70`, and filing integrity work is sitting in the working
tree unreleased. It changes `src/core/claim.js`, one of the 26 files the page loads, so the live
page no longer serves what this review read. Every count below was taken from a command run in that
working tree on 2026-09-02, on Windows, and every one has to be taken again from a fresh clone at
the released commit. Reviewed one day before the deadline, with the video still unrecorded and no
freeze commit declared.

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
- **The browser evidence goes stale on every push, and did twice.** When this review was written
  the newest eval run drove `a9c3ba4` while the page served a commit five changes later. It was
  closed the same day by dispatching the workflow against `main`: run 33560224732 drove `c93b138`,
  which was the commit the host served on 2026-09-01 and is not what a take will show. It is open
  again on 2026-09-02, and this time because unreleased work in the tree changes files the page
  loads. The workflow runs on a daily schedule and on dispatch rather
  than on push, so the gap reappears on the next commit that touches a file the page loads. That is
  written into the Status row instead of being smoothed over, and a judge should re-check it with
  the `--verify-deployed` command rather than believe the row.

Cannot answer: whether a model, rather than a script, drives the declared form in any browser.

---

## 2. Execution, 25 percent

What earns it. No dependencies, no build step, no lockfile, so what a judge clones is what the host
serves and it can be proved in one command. 885 unit tests, from `node --test tests/unit` printing
`# tests 885`, `# pass 885` and `# fail 0` on 2026-09-02, which is the command this file is required
to carry rather than a number somebody typed. A style gate over 190 text files, from
`node scripts/check_style.mjs`. Coverage of `src` alone, from
`node --test --experimental-test-coverage --test-reporter=./tests/support/coverage_report.mjs --test-reporter-destination=stdout tests/unit`,
which printed `src, 21 files` at 98.29 percent of lines, 88.75 percent of branches and 97.87 percent
of functions against floors of 97, 86 and 96. **Read the branch figure as a band rather than a
constant.** It moves between runs, because `src/ui/render.js` has timing dependent branches, and
this file quoted 88.53 once as though it were fixed. Anything from about 88.4 to 88.8 is the same
tree. A
readiness gate that prints one row per deliverable and breaks every row it prints, in its own copy
of the repository, to show that each one refuses. Numbers in the README come with the command that
produces them.

What a judge marks down.

- **The video does not exist.** It is a mandatory deliverable, the readiness gate is red on it in
  every mode, and this is the single largest thing between the repository and a finished entry.
  Everything else in this file is worth less than that one row.
- **The gate says 25 of 31, not 31 of 31.** From `node scripts/readiness.mjs` on 2026-09-02:
  `READY TO SUBMIT: 25 of 31 proven, 80.6 percent`, with `automated rows: 25 of 27 PASS, 92.6 percent`,
  mandatory at `4 of 5` and recommended at `21 of 22`. It exits 1. Offline, from
  `node scripts/readiness.mjs --ci --allow-undeployed`, it is `24 of 27 PASS, 88.9 percent` and
  `24 of 31 proven, 77.4 percent`, because the live row then proves nothing. **The total is the same
  as on 2026-09-01 and it is not the same rows.** `TST` went green when the Windows line-ending
  defect was fixed, and `FRZ` went red in the same pass, because the freeze declaration was found to
  be naming a commit no take could be shot against. Two deliverable rows are outstanding, `D4` and
  `FRZ`, and no engineering row is. `node scripts/readiness.mjs --selftest` reports
  `46 breaks over 27 rows` and passes. Reading only the green badges overstates the position. This
  is by design and it is still what a judge sees. The figure in this bullet was 17 of 24 and had
  been left behind by two rows going green, which is the same defect this file exists to catch.
- **Our own evidence has been wrong more than once and we found it by reading, not by a gate.** A
  Status row claimed the browser evidence stood against the served bytes when it no longer did. A
  README command carried a broken line continuation and exited 2 for anyone who pasted it. Both were
  caught by a person, days out. A judge cannot see how many were not caught. The newest of them is
  the reason the freeze is broken on 2026-09-02: the private filing receipt attested the identity of
  the object that was filed rather than the state that was filed, so a value changed after filing was
  sealed and hashed into a packet that went on saying the filing happened through a control on the
  page. It is closed, with the measured before values kept in
  `tests/unit/filing_receipt_state.test.js`. A previous refutation pass had named that exact gap and
  written it down instead of fixing it, which is the part a judge would mark.
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

## The five things a hostile judge says first

1. There is no video, so half the entry cannot be seen.
2. Every number about the world is derived from fixtures you wrote yourself.
3. Your own study says the rules made the notices worse, not better.
4. The agent cannot file the claim, which is the thing a claim page is for.
5. Your browser evidence is against a commit your site no longer serves.

Four of those five are answered somewhere in the repository. The first is not answerable by writing
anything. It is answerable by recording.

**Number 5 is closed today, and it reopens on the next runtime commit.** It closed on 2026-09-01,
reopened twice on 2026-09-02 as work landed on the runtime, and closed again each time. Run
33616908770 drove the `9450d70` the host serves, and
`python video/build_video.py --verify-deployed --url https://upgradedev.github.io/claimready/
--deployed-sha 9450d70` says so over all 26 files the page loads. It is open a third time as this is
written, because filing integrity work in the working tree changes `src/core/claim.js`, which is one
of those 26 files. The evals workflow runs daily and on dispatch rather than on push, so the gap
reopens on every commit that touches them. Anyone finishing this entry re-dispatches that workflow
against `main` after the last such commit, and before the video is uploaded.

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
shorter form, which is the test of whether it was load bearing. This paragraph quoted the longer
wording for an hour after the cut, which is the small version of the defect this whole file is
about: a document describing another document it had stopped matching. **The underlying limit is not fixed and cannot be**: the consequence this gate guards is
a local artifact, not a filed claim, and that ceiling on Potential Impact is real. What was fixed is
a document that let a reader believe otherwise.

**J3, one headline comparative number. Document defect, fixed, and the honest reading is that we do
not have one.** The 9 against 8 intake figure is a count of fields over two rule packs this
repository invented, Kestrel Assurance and Northwind Mutual, and it belongs to no real policy. The README's list under the figure opens
with "It measures this repository's own invented rule packs", and `node scripts/measure_intake.mjs`
prints every one of the twelve pack and incident type combinations, so neither end of the range is
hidden. **The figure is no longer in the description at all.** It was cut on 2026-09-02, when the
description came down from 1,265 words to 746, and cutting it is the honest end of this row: a
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

