# ClaimReady, motor first notice of loss

The insurer's page hands your own agent its policy rules as typed tools, so you learn what you
are covered for while you are still describing the crash.

Live, no account: https://upgradedev.github.io/claimready/
Code: https://github.com/upgradedev/claimready
Unrelated home inventory products share the name. These two links are this entry.

Tools appear in the ChatGPT desktop browser, or Chrome 149+ with
chrome://flags/#enable-webmcp-testing. Elsewhere it works by hand.

## Who this is for

The driver at the roadside with a damaged car and a phone. I build claims systems for European
assistance operators. My judgement, not a study: intakes arrive wrong about what the policy needed,
not what happened. The assistant is already open, the trigger is the sentence they were going to say
anyway, and what goes is the retyping.

One part is countable. A static form has to ask everyone for 9 questions because it cannot know
which policy it is looking at, while for the policy and collision claim this demo opens on it asks
for 8. Count both with node scripts/measure_intake.mjs. It measures the two invented packs here,
not any real form, and extrapolates nothing.

## Why this is a strong fit for WebMCP

A policy is not general knowledge. What is covered, the deductible and what the intake needs live
on one origin and change per customer. The insurer publishes typed tools, the visitor brings their
own agent. No model runs here, no key exists.

REST with an OpenAPI file has to be built for this insurer in advance, and says what a service
offers, never what it offers right now for this claim.

## A better experience

The driver hears what their policy says, not after a call queue and a letter. Every field shows
who set it last, and any can be pinned.

## What people and agents can do together that was difficult or impossible before

An agent that has never met this insurer learns what this policy requires, from the insurer, as
the driver describes the crash. Then the surface moves: say the car cannot be driven and
get_assistance_options registers live, a capability the agent did not have a moment ago and
loses when that changes.

Tested, not asserted: evals/negative-control.json must FAIL, requiring the ninth tool to vanish
once a patch puts the car back on the road.

## How it is implemented

Tools register on document.modelContext, falling back to navigator.modelContext, over a pure core.
Page and tools share one store, so an agent action shows on screen. Read tools carry
readOnlyHint, free text the insurer did not write carries untrustedContentHint, and each
registration holds its own AbortController. Input is validated in code, not by schema.

Both halves of the API ship: nine tools come from JavaScript. A tenth, record_supporting_details, is an
ordinary form with toolname, tooldescription, toolautosubmit and toolparamdescription: an insurer
with an intake form adopts WebMCP by adding attributes, not a rewrite. Same store, same refusals.
Verified as a form and against a constructed submit event, not yet in a browser that implements it.

Filing, assistance and pinning reach no tool. A browser agent can still click a button, so the
claim is about the tool surface, not the click. The demo ships an injected note: its patch comes
back PATCH_REJECTED_LOCKED, and filing has no tool.

## Honest limits

Insurer, policy, vehicle and claimant are invented. No integration, no adjudication. Nobody has run
this on real intakes, so there is no measurement of claims arriving more complete, and I have not
invented one.
