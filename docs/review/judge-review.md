# Judge review, written against ourselves

**Every score in this file is an ESTIMATE made by the people who built the entry, and it is not a
measurement of anything.** This is an internal working document. Nothing in it is written for a
judge to read, no number in it may be quoted into the README, the description, the video or the
submission form, and if any figure here ever turns up in a judge-facing file, that is the defect,
not the figure.

Run against `7b50d4a`, which is the working commit. The public repository has the same work merged
as `39f72f6`, and `39f72f6` is what the live page serves on 2026-09-01. Reviewed 2026-09-01,
two days before the deadline, with the video still unrecorded.

## What the criteria actually are

Taken from the workspace state file, which recorded them from the organizer's rules page on
2026-08-26. Four criteria, 25 percent each, plus a pass or fail first stage on theme fit and on
whether WebMCP is genuinely used.

Only one of the four is written out in full in our notes, so only one is quoted here:

> WebMCP Leverage. "How thoroughly and skillfully does the project use WebMCP? Does the code
> reflect genuine effort and a working, non-trivial implementation?"

The other three are recorded by label only: Execution, Potential Impact, Creativity. Reviewing
against a label instead of against the organizer's sentence is weaker, and it is a gap in our own
preparation rather than in the entry. **Anyone finishing this entry should re-read the live rules
page before the deadline and replace the three labels below with the real wording.** That is one
page load and it re-aims everything under it.

## The way to read this file

Each section says what a judge would credit, then what a judge would mark down, then the question
the entry cannot answer. The marking down is the point. The crediting is here so the marking down
is not mistaken for a list of everything that is true.

---

## 1. WebMCP Leverage, 25 percent

**Estimate: 8.5 out of 10. Ours, not measured.**

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
  file it has met a smaller product than the sentence promised. The description does say this. It
  says it in the last third, after the claim.
- **The declarative half has never been seen working in the surface the video is shot on.** Chrome
  151 builds the tool from the markup and runs it. The ChatGPT desktop browser has not been watched
  doing so, and the page cannot see what a browser synthesised, so we cannot close this from here.
  Every judge-facing file says so, which is honest and is still a gap.
- **16 of 16 does not mean the refusals refused.** The harness marks a step passed when the call is
  made and output comes back, and a refusal travels inside an ordinary result envelope. Only the
  negative control tests the other direction. A judge who reads the row carefully finds this stated;
  a judge who reads the headline finds a number that means less than it looks like.
- **The browser evidence is against bytes the host no longer serves.** On 2026-09-01 the newest
  eval run drove `a9c3ba4` and the page serves `39f72f6`, with four commits in between that changed
  files the page loads. The workflow runs on a daily schedule rather than on push, so this gap is
  structural and will reappear. It is written into the Status row now instead of being smoothed over.

Cannot answer: whether a model, rather than a script, drives the declared form in any browser.

---

## 2. Execution, 25 percent

**Estimate: 8 out of 10 if the video lands. 5 out of 10 if it does not. Ours, not measured.**

What earns it. No dependencies, no build step, no lockfile, so what a judge clones is what the host
serves and it can be proved in one command. 658 unit tests on `node --test`. A style gate. A
readiness gate that prints one row per deliverable and breaks every row it prints, in its own copy
of the repository, to show that each one refuses. Numbers in the README come with the command that
produces them.

What a judge marks down.

- **The video does not exist.** It is a mandatory deliverable, the readiness gate is red on it in
  every mode, and this is the single largest thing between the repository and a finished entry.
  Everything else in this file is worth less than that one row.
- **The gate says 17 of 24, not 24 of 24.** Reading only the green badges overstates the position.
  This is by design and it is still what a judge sees.
- **Our own evidence has been wrong more than once and we found it by reading, not by a gate.** A
  Status row claimed the browser evidence stood against the served bytes when it no longer did. A
  README command carried a broken line continuation and exited 2 for anyone who pasted it. Both were
  caught by a person, days out. A judge cannot see how many were not caught.
- **The impact study went against us and we published it anyway.** That is the right thing to have
  done and it does not score points. It scores points for honesty and it removes the number that
  would have scored points for impact.

Cannot answer: how much of the tree a stranger can verify without running anything. Most of the
strongest claims here are commands, and a judge who does not run them is left with prose.

---

## 3. Potential Impact, 25 percent

**Estimate: 6 out of 10. Ours, not measured. This is the weakest of the four and we know why.**

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
- **The 36 run study is negative.** Published rules produced 5 of 18 policy-complete notices against
  6 of 18 for the static form, with two truth mismatches against none. We published it. It does not
  lift this criterion and a judge who reads it will not lift it either.
- **Professional judgement is stated as judgement.** That is the correct label and it is not
  evidence. A judge scoring impact wants somebody other than the builder to have said the thing is
  worth having, and nobody has.

Cannot answer: whether a claims handler would rather receive this packet than what they get today.
There is no handler in the loop, and there was never going to be one in the time available.

---

## 4. Creativity, 25 percent

**Estimate: 7 out of 10. Ours, not measured.**

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

## One decision that has to be made BEFORE the takes are shot

The flagship sentence is 28 words. The house rule for it is 25. It reads:

> The insurer's page hands your own agent its rules as typed tools, so you learn what you
> are covered for while still describing the crash.

A 23 word version that keeps one mechanism and one consequence:

> The insurer's page hands your own agent its rules as typed tools, so you learn your cover
> while you describe the crash.

**It is NOT applied, and it must not be applied casually.** The sentence is not just prose. It is
the `FLAGSHIP` constant at `scripts/readiness.mjs:60`, it is asserted by the `IDX` row against
`index.html`, by the `LIVE` row against the bytes the host actually serves, and by the `RDM` row
against the opening of both the README and the description. Changing it turns `LIVE` red, and
`LIVE` is mandatory, until a deploy catches up. The video narration is built on it too, so a change
after the takes are shot means re-cutting.

So it is a decision for before recording, not after, and it is the owner's. Leaving it at 28 words
is a defensible choice: the cost of changing it now is a mandatory row going red two days out, and
the cost of leaving it is three words over a rule we wrote ourselves.

## What this review does not do

It does not run a persona kit. The workspace persona kit is not on this machine and nothing here is
attributed to it. It does not consult anybody outside the build. Every judgement above is ours, made
by the people with the strongest possible reason to be generous, and it should be read that way.
