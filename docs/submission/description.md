# ClaimReady

The insurer's page hands your own agent its policy rules as typed tools, so you learn what you
are covered for while you are still describing the crash.

Live, no account: https://upgradedev.github.io/claimready/. Tools appear in the ChatGPT desktop
app's browser, or Chrome 149 or later with chrome://flags/#enable-webmcp-testing on. Anywhere else
the page still works by hand and says no agent was found.

## Who this is for

The driver at the roadside with a damaged car and a phone. The first notice of loss handler who
opens it next morning gains too, but the demo is the driver's half.

I build claims and policy systems for European assistance operators. Intakes that arrive wrong are
almost never wrong about what happened, they are wrong about what this policy needed. The driver's
assistant is already open and the trigger is the sentence they were going to say anyway, so what
this removes is the retyping.

## Why this is a strong fit for WebMCP

A policy is not general knowledge. What is covered, the deductible and what the intake needs all
live on one origin and change per customer. The insurer publishes typed tools and deterministic
rules, the visitor brings their own agent. No model runs here and no API key exists. Remove WebMCP
and the agent is back to guessing. Two synthetic insurers ship with it, and their rule packs
make the same tools return different requirements, so this is a contract, not one app.

## A better experience

The driver hears what their policy says, instead of after a call queue and a letter.
The person keeps the final action, every field shows who set it last, and any field can be pinned.

## What people and agents can do together that was impossible before

Two of us can write to the same document at once and neither silently overwrites the other.

The draft carries a revision number. An agent must quote the one it last read, and a stale
patch is refused with both numbers named, so it knows to read again. Provenance is per field, and
patches are atomic, so a partly invalid batch changes nothing.

The agent fills the draft from the policy. Then the person corrects something material, say the
car cannot be driven. On the next read the agent sees it, the page recomputes what the intake
needs, and a tool that did not exist a moment ago appears with it.

## How it is implemented

Tools are registered on document.modelContext, falling back to navigator.modelContext, over a pure
domain core. Page and tools drive one store, so an agent action shows on screen. Read
tools carry readOnlyHint, and tools returning words the insurer did not write carry
untrustedContentHint. Each registration has its own AbortController and the set is
reconciled on every change, which is how a tool appears and disappears with the claim. Inputs are
validated in code, and refusals are messages a model can act on.

## What is deliberately not a tool

Filing, requesting assistance, and pinning or unpinning a field. No tool reaches any of them. A
browser agent can still click a button, so the claim is about the tool surface, not the click.

The demo ships a third party note asking the agent to change a field the claimant pinned, then
file. The patch comes back PATCH_REJECTED_LOCKED naming that field, and for the filing there is no
tool to call. Both land in the ledger, where a refusal reads as plainly as a success.

## Honest limits

Everything here is invented: insurers, policy, vehicle, claimant. There is no insurer integration
and no adjudication. What I say about intakes is experience, not a measured study.
