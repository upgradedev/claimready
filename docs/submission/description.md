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
their own agent. No model runs here and no key exists. A REST endpoint with an OpenAPI file beside
it can carry the same answers, once somebody has built that client integration for this insurer.
What this page does instead is browser native and same origin: an agent meeting this insurer for
the first time discovers the tools at runtime, with nothing built for it in advance.

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

Filing leaves something behind, in this browser tab and nowhere else: a handler packet built from
that exact revision, carrying the facts, the clause and excess, every requirement with what answered
it, the pinned rows, the tool calls and a SHA-256 that scripts/verify_packet.mjs recomputes. Nothing
is transmitted. No insurer receives it, no handler is notified, and no claim is opened anywhere. It
is a file this page hands you, and the word filed on it means this page filed it. That script shares a module with
the thing that made the digest, so docs/handler-verification.md gives two routes that share
nothing with it, and one worked example where all three agree.

That digest is a plain SHA-256 over the exported content and there is no key and no signature
anywhere here. A match says the content in front of you is the content the digest was taken
over, so it catches a packet changed on the way to a handler and two copies that have drifted
apart. It does not show which page made it, who wrote it, that nobody edited the content and
recomputed the digest to match, or that any insurer received it.

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

I did not design this from a guess about how claims arrive. I run a first notice system in
production, and I queried it before I wrote this. In 285,701 records that operator classifies as
first notices, all five attributes I asked about were present: date, location, driver, vehicle,
policy. That is a count of fields existing, not a judgement that any answer is right or usable, and
it is one operator on one line of business.

I am reporting it because it went against me. I expected gaps and there were none, so the pitch that
claimants forget things is not one I can make. What the number does establish is the scale of the
domain: a first notice carries these fields, hundreds of thousands of times, and something has to
decide which ones this policy needs. That is the problem ClaimReady addresses. Whether it addresses
it better is not measured here and I do not claim it is. The method, the limits, and the wrong
number I published first and then corrected are in evidence/production-intake. No record left that
account and the operator is not named.

What I did measure on this page went against it, and it is published rather than dropped. In 36 runs with
language models standing in for drivers, the arm that got the published rules came out policy
complete in 5 of 18 against 6 of 18 for a static form. Read those two counts with the thing that
sits under them: the scorer fills in the date, the incident type and the driver from the file the
claim already had, so neither number is what a model produced on its own. Take that seeding away and
both arms score zero of eighteen, which is the sensitivity result published beside the headline. It
also wrote two answers that contradicted
the driver's own account, the damage position in one run and the location in another, where the
static form wrote none. So the specific thing this gets wrong is that a richer tool surface gives an
agent more room to fill a field confidently and incorrectly. The runs, the protocol written before
them, the errata and what none of it licenses anyone to conclude are in evidence/impact.
