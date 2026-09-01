# ClaimReady, motor first notice of loss

The insurer's page hands your own agent its policy rules as typed tools, so you learn what you
are covered for while you are still describing the crash.

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

The driver hears what their policy says, not after a call queue and a letter. Every field shows the
route its answer arrived on, via page or via tool, and any row can be pinned so no patch moves it.

Filing leaves something behind: a handler packet built from that exact revision, carrying the
facts, the clause and excess, every requirement with what answered it, the pinned rows, the tool
calls and a SHA-256 that scripts/verify_packet.mjs recomputes.

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
