# ClaimReady

The insurer's page hands your own agent its policy rules as typed tools, so a claim is checked
against your actual cover while you describe it, and only you can file it.

## Who this is for

The first notice of loss intake desk at a regional motor insurer, and the driver at the roadside.

I build claims and policy systems for European assistance operators. The intakes that arrive wrong
are almost never wrong about what happened, they are wrong about what this particular policy
needed. The driver's own assistant is already open and the trigger is the sentence they were going
to say anyway, so what this removes is the retyping.

## Why this fits WebMCP

A policy is not general knowledge. What is covered, what the deductible is and what the intake
needs live on one origin and change per customer. The insurer publishes typed tools and
deterministic rules, the visitor brings their own agent. No model runs here, no API key exists here,
and no model decides anything about cover. Remove WebMCP and the agent is back to guessing. Two
synthetic insurers ship with the demo, and their rule packs make the same tools return different
requirements, so this is a contract rather than one app.

## A better experience

The driver learns what their own policy says while they are still describing what happened, instead
of after a call queue and a letter. The person keeps the truth and the final action: every field
shows who set it last, any field can be pinned against an agent, and the page works fully without
one.

## What people and agents can now do together

Two of us can write to the same document at once and neither one silently overwrites the other.

The draft carries a revision number. An agent must quote the revision it last read, and the page
refuses a stale patch, naming both numbers so it knows to read again. Provenance is recorded per
field, and patches are atomic, so a partly invalid batch changes nothing.

The agent reads the policy and fills the draft. The person corrects something material, say the car
cannot actually be driven. The agent reads back, sees it, and the page recomputes what the intake
now requires: an assistance requirement appears, along with a tool that did not exist a moment
earlier. The agent then asks only for what just became necessary.

## How it is implemented

Tools are registered on document.modelContext, with a fallback to navigator.modelContext. They are
a thin mapping over a pure domain core, and the page and the tools drive one store, so an agent
action is always visible on screen. Read tools carry readOnlyHint, and the tool returning other
people's notes carries untrustedContentHint. Each registration is held with its own AbortController
and the set is reconciled on every change, which is how a tool appears and disappears with the
claim. Inputs are validated strictly in code, and refusals come back as messages a model can act on.

## What is deliberately not a tool

Filing, requesting assistance, and unlocking a pinned field. A WebMCP agent inherits the visitor's
session, so the demo ships a third party note instructing the reader to file the claim. Following
it changes nothing: policy facts, the validation result and the filing state are protected paths,
and the refusal shows as plainly as a success.

## Honest limits

Everything in the demo is invented: the insurers, the policy, the vehicle, the claimant. There is
no insurer integration and no adjudication. What I say above about intakes comes from building
these systems for a living, not from a measured study.
