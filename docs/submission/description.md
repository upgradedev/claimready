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
assistance operators. My judgement, not a study: intakes that arrive wrong are rarely wrong about
what happened, but about what this policy needed. The assistant is already open, the
trigger is the sentence they were going to say anyway, and what goes is the retyping.

## Why this is a strong fit for WebMCP

A policy is not general knowledge. What is covered, the deductible and what the intake needs live
on one origin and change per customer. The insurer publishes typed tools and deterministic rules,
the visitor brings their own agent. No model runs here and no key exists. Remove WebMCP and the
agent is back to guessing.

The honest alternative is REST with an OpenAPI file, and it loses twice. It must be built for
this insurer in advance, so it does nothing for an agent meeting the origin for the first time:
here, a second rule pack in fixtures/insurers makes the same nine tools answer differently, nothing
rebuilt. And it says what a service offers, never what it offers right now, for this claim.

## A better experience

The driver hears what their policy says instead of after a call queue and a letter. Every field
shows who set it last, and any can be pinned.

## What people and agents can do together that was difficult or impossible before

An agent that has never met this insurer learns what this policy requires, from the insurer, while
the driver describes the crash. Then the surface moves: the driver says the car
cannot be driven, get_assistance_options is registered live, and the agent has a capability it did
not have a moment ago, then loses it when that answer changes.

Tested, not asserted. evals/negative-control.json must FAIL: it applies a patch
putting the car back on the road, then requires the ninth tool to be gone. Its companion requires
that tool to survive a refused patch. The surface moves when a patch lands and holds still
when one does not.

## How it is implemented

Tools register on document.modelContext, falling back to navigator.modelContext, over a pure domain
core. Page and tools share one store, so an agent action shows on screen. Read tools carry
readOnlyHint; anything returning words the insurer did not write carries untrustedContentHint. Each
registration holds its own AbortController and the set is reconciled on every change. Input is
validated in code, not by schema.

## Not a tool

Filing, requesting assistance and pinning reach no tool. A browser agent can still click a button,
so the claim is about the tool surface, not the click. The demo ships a third party note telling
the agent to change a pinned field and file: the patch returns PATCH_REJECTED_LOCKED naming the
field, and for the filing there is nothing to call.

## Honest limits

Insurer, policy, vehicle and claimant are invented. No integration, no adjudication. Nobody has run
this on real intakes, so there is no measurement of claims arriving more complete, and I have not
invented one.
