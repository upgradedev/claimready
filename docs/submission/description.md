# ClaimReady, motor first notice of loss

The insurer's page hands your own agent its rules as typed tools, so you learn what you
are covered for while still describing the crash.

Live, no account: https://upgradedev.github.io/claimready/
Code: https://github.com/upgradedev/claimready
Unrelated home inventory products share the name. These two links are this entry.

Tools appear in the ChatGPT desktop browser, or Chrome 149+ with
chrome://flags/#enable-webmcp-testing. Elsewhere it works by hand.

## Who this is for

The driver at the roadside with a damaged car and a phone, and the handler who works what they
send. I build claims systems for European assistance operators. My judgement, not a study: intakes
arrive wrong about what the policy needed rather than about what happened.

One part is countable, on the two invented packs here and nowhere else: a static form must ask
everyone 9 questions, this page derives 8 for the policy it opens on. Count both with
node scripts/measure_intake.mjs.

## Why this is a strong fit for WebMCP

A policy is not general knowledge. What is covered, the excess and what the intake needs live on
one origin and change per customer, so the insurer publishes typed tools and the visitor brings
their own agent. No model runs here and no key exists. REST with an OpenAPI file must be built for
this insurer in advance, and says what a service offers, never what it offers right now.

## A better experience

The driver hears what their policy says, not after a call queue and a letter. Every answer on the
draft carries the route it arrived on. on file is what the insurer already had, via page came
through a control on this page, via tool came through a WebMCP call. A field nobody has answered
reads not set. Any row can be pinned so no patch moves it.

That badge names a surface, and it is worth saying what it does not name. The page cannot see who
is at the keyboard, so an agent that clicks a control instead of calling a tool is recorded via
page exactly as a person is. A tool call records the word the caller used for itself, and nothing
here authenticates that word. It is a route, not an identity, and the badge says so when you hover
it.

Filing leaves something behind: a handler packet built from that exact revision, carrying the
facts, the clause and excess, every requirement with what answered it, the pinned rows, the tool
calls and a SHA-256 that scripts/verify_packet.mjs recomputes. That script shares a module with
the thing that made the digest, so docs/handler-verification.md gives two routes that share
nothing with it, and one worked example where all three agree.

## What people and agents can do together that was difficult or impossible before

An agent that has never met this insurer learns what this policy requires, from the insurer, as the
driver describes the crash. Then the surface moves: say the car cannot be driven and
get_assistance_options registers live, a capability the agent did not have a moment before and
loses when that answer changes.

Tested, not asserted: evals/negative-control.json must FAIL, requiring that tool to vanish once a
patch puts the car back on the road.

## How it is implemented

Tools register on document.modelContext, falling back to navigator.modelContext, over a pure core.
Page and tools share one store, so an agent action shows on screen. Read tools carry readOnlyHint,
text the insurer did not write carries untrustedContentHint, each registration holds its own
AbortController, and input is checked in code rather than by schema.

Both halves of the API ship: nine tools come from JavaScript, and a tenth,
record_supporting_details, is an ordinary form carrying toolname, tooldescription, toolautosubmit
and toolparamdescription, so an insurer adopts WebMCP by adding attributes rather than rewriting.
Same store, same refusals. Chrome 151 builds that tool from the markup and executes it. The ChatGPT
desktop browser has not been seen doing so.

Filing, assistance and pinning reach no tool. A browser agent can still click a button, so the
claim is about the tool surface, not the click. The demo ships a planted note: the patch it asks
for comes back PATCH_REJECTED_LOCKED.

## Honest limits

Insurer, policy, vehicle and claimant are invented. No integration, no adjudication. Nobody has run
this on real intakes, so there is no measurement of claims arriving more complete and I have not
invented one.

## Display title, three options. Not chosen

The submission form needs one display title and none of these is picked. The owner chooses, and
until then no file in this repository names one as the title.

1. ClaimReady
   Leads with the name alone. Aimed at a judge who checks that the entry, the repository and the
   live page are one thing, and who will search the name and find the unrelated products.

2. ClaimReady, the insurer hands your agent its policy rules
   Leads with the mechanism. Aimed at a judge skimming a gallery who has a few seconds and needs
   to see what WebMCP is doing here before they open anything.

3. ClaimReady, first notice of loss for the driver at the roadside
   Leads with the buyer and the moment. Aimed at a judge scoring impact, who wants to know whose
   problem this is before they judge whether the mechanism is worth it.
