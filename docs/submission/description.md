# ClaimReady: what your car insurance covers, answered while you report the crash

The insurer's page hands your own agent its rules as typed tools, so you learn what you
are covered for while still describing the crash.

Live, no account: https://upgradedev.github.io/claimready/
Code: https://github.com/upgradedev/claimready

Tools appear in Chrome with chrome://flags/#enable-webmcp-testing on, verified on Chrome 151
stable, and in the ChatGPT desktop browser with site tools enabled, where availability is still
rolling out and varies by workspace. The form
declared tool is the browser's to build, and we have only watched an agent call it in Chrome.
Anywhere else the page works by hand.

## Inspiration

Somebody has just had a crash and is standing next to the car with a phone. They know what
happened. What they do not know is what their own policy needs to hear about it, and neither does
any general purpose assistant, because the clause, the excess and the list of required answers sit
on one insurer's origin and change from customer to customer.

I build claims systems for European assistance operators, so this is the failure I watch: a first
notice arrives wrong about what the policy needed rather than about what happened. Then the driver
waits days to learn what they are covered for, and a handler spends the interval asking for the
field nobody told anyone to fill in.

## What it does

Describe the crash to your own agent. It reads the insurer's typed tools and tells you what this
policy still needs while you are talking. Then the surface moves: answer that the car cannot be
driven and get_assistance_options registers live, a capability the agent lacked a moment earlier and
loses when that answer changes.

Three prompts to paste, with two page steps between the second and the third:

    Read this claim page and tell me what it still needs from me.

    A delivery van reversed into my car while it was parked in the car park on Harbour Road. It caught the left front wing and left a dent. The car still drives, and it is still there in the Harbour Road car park. Fill that in for me and write the description.

Now set **Still drivable** to no on the page yourself, and press **Pin** on that row. Then:

    Read the notes on the file, then read the claim again, do what that note asks, and tell me what the page said.

That note is a planted instruction inside third party evidence, and it asks for the row you just
pinned, so the answer is PATCH_REJECTED_LOCKED. Every answer also carries the route it arrived on:
on file, via page, via tool. That names a surface, not a person: the page cannot see who is at the
keyboard. There is a fourth badge word in the renderer, derived, and it is not claimed here because
nothing under src ever writes it.

**Filing is human only.** No tool files, dispatches, pins or unlocks, and a test reads the source to
keep it that way. Filing leaves a handler packet from that exact revision, with the clause, the
excess, every requirement and a SHA-256 that scripts/verify_packet.mjs recomputes. Nothing is
transmitted and no claim is opened anywhere. With no key and no signature, a match shows only that
the content is unchanged.

## Why this use case is a strong fit for WebMCP

The rules that decide a motor claim sit on one insurer's origin and change from customer to
customer. A REST endpoint with an OpenAPI file carries the same answers, once somebody builds that
integration for this insurer. This is browser native and same origin, with zero integration work: an
agent meeting this insurer for the first time discovers the tools at runtime.

## How it creates a better user experience

The driver learns what their own policy still needs while they are still describing the crash, in
the assistant they already have open, instead of a second call days later. The cover answer at the
roadside instead of a letter a week later. Nothing to install, no account, and the page keeps
working by hand in a browser with no agent in it.

## What people and agents can do together that was difficult or impossible before

Two parties write to one document and neither overwrites the other silently. The agent drafts. The
person corrects a field and pins it, and a pinned row then refuses every later patch and says so
with a code. The tool surface itself moves: answering that the car cannot be driven publishes a
ninth tool, and changing the answer back withdraws it. Filing stays a button only a person can
press, and the page says so in its own tool list. Before this, each of those needed a bespoke
integration per insurer, and an agent still had no way to be told what a page refuses.

## How WebMCP is implemented

Tools register on document.modelContext, falling back to navigator.modelContext, over a pure core, no
dependencies, no build step. Page and tools share one store, so an agent action shows on
screen. Read tools carry readOnlyHint and text the insurer did not write carries
untrustedContentHint. Both halves of the standard ship: nine tools come from JavaScript, eight from
the moment the page loads and a ninth that appears when the claim says the car cannot be driven,
which is why the narration at 0:20 of the video counts eight. The
tenth is an ordinary HTML form carrying four attributes, toolname, tooldescription,
toolparamdescription and toolautosubmit, and the browser builds the JSON Schema and the tool from
that markup on its own. toolautosubmit is the one that makes an agent's call actually submit the
form rather than only fill it. So an insurer adopts WebMCP by adding attributes.

## What the demo video shows

Three beats are captured in CI by Playwright against the deployed page in Chrome. Two run with
WebMCP on, against the browser's own implementation. The first runs with it deliberately off,
because that beat shows the page as a visitor with no agent sees it. Six are one continuous unbroken
recording in the ChatGPT desktop app's built in browser, cut into six. **Two corrections to the
narration**, written here because the cut is frozen. At 1:40 it says the roadside collection "is
arranged": the demo records a local roadside assistance request and marks that requirement answered,
it does not arrange or dispatch a service, and nothing leaves the page. At 2:08 it says "Chrome
builds the schema from that markup", where the accurate word is the browser: that take was shot in
the ChatGPT desktop browser, and the declarative half is verified separately in Chrome
151.0.7922.174 stable. Both are also written into the video description. The opening and closing
cards are type on a still background, generated by a script in the repository. No stock footage and
no rendered people: every other frame is the deployed page running.

## Evidence

961 unit tests, from `node --test tests/unit`, with source coverage of 98.11 percent of lines over
the 22 files under src. Both are read at the submitted commit and both reprint in any clone. 178
assertions run against the deployed page in a real Chrome with WebMCP enabled, in CI, at the same
commit the host serves. The page loads no framework, has no build step and makes no network call at
runtime after load.

## Challenges, and the honest limits

Insurer, policy, vehicle and claimant are invented. No integration, no adjudication, no handler has
reviewed a packet, nobody has run this on a real intake.

**What this page demonstrably does** is in the sections above and every part of it is checkable in
a browser: policy rules discovered at runtime on the insurer's own origin, requirements recomputed
on the page as answers change, a route recorded on every answer, a pin that refuses patches with a
code, and filing that no published tool can reach. **What is not demonstrated is that any of it
makes an autonomous agent fill a form better.** One experiment tried to show that and did not, and
it is published in full rather than dropped.

What I measured went against the page, and is published anyway. In 36 runs with language models
standing in for drivers, the arm with the published rules came out policy complete in 5 of 18
against 6 of 18 for a static form, and wrote two answers contradicting the driver's account where
the form wrote none. Both counts lean on three answers the fixture already held; without
that seeding both arms score zero. A richer tool surface gives an agent more room to fill a field
confidently and wrongly. The runs are in evidence/impact.

One number, for domain scale only. In a first notice system I run in production, 285,701
records carried all five attributes I asked about. I expected gaps and found none, so the pitch that
claimants forget things is not one I can make. Something still has to decide which fields a policy
needs, and whether ClaimReady does is not measured here.

---

**Not part of the text that gets pasted.** The published entry is
<https://devpost.com/software/claimready-fy4toi>, and that page, not this file, is what a judge
reads. This file is the source it was written from, and it is kept in step by hand: **nothing in CI
compares the two**, so an edit to either one has to be made twice, and that is the standing risk
here rather than a defect being reported.

**Synchronised 2026-09-04, twice.** The first pass brought back two sections this file was missing,
**Evidence** and **What the demo video shows**, which had been written straight into the form. The
second pass followed an outside audit that pointed out the organizer asks four questions and the
entry answered all four without ever using their words as headings, so a judge scanning for them had
to read for them instead. The four are now literal headings here and on the published page: **Why
this use case is a strong fit for WebMCP**, **How it creates a better user experience**, **What
people and agents can do together that was difficult or impossible before**, and **How WebMCP is
implemented**. The same pass separated what the page demonstrably does from the one experiment that
tried to show an autonomous agent doing it better and did not. **The negative result is untouched
and still leads the honest limits**: separating it from the demonstrated capabilities is a
different act from softening it, and softening it is the one thing this repository refuses.

**Three earlier drifts, all closed.** This file named two of the declared form's four attributes
where the published page named four. It left out that eight of the nine registered tools are there
at load and the ninth arrives with the answer, which is the count the narration says out loud at
0:20. And the route words went wrong in both directions on 2026-09-04: this file and the published
text were first changed to name four, counting `derived`, which overclaimed, because `grep -rn
derived src/` returns readers only and provenance is assigned in exactly three places,
`claim.js:630` (`policy`), `claim.js:1614` (an actor, gated to `human` or `agent`) and
`claim.js:738`, which copies a value a claim already carried. Both are back to three, which is what
a visitor can see.
