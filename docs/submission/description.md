# ClaimReady: what your car insurance covers, answered while you report the crash

The insurer's page hands your own agent its rules as typed tools, so you learn what you
are covered for while still describing the crash.

Live, no account: https://upgradedev.github.io/claimready/
Code: https://github.com/upgradedev/claimready

Tools appear in the ChatGPT desktop browser, or in Chrome 149+ with
chrome://flags/#enable-webmcp-testing on. Anywhere else the page works by hand.

## Inspiration

Somebody has just had a crash and is standing next to the car with a phone. They know what
happened. What they do not know is what their own policy needs to hear about it, and neither does
any general purpose assistant, because the clause, the excess and the list of required answers sit
on one insurer's origin and change from customer to customer.

I build claims systems for European assistance operators, so this is the failure I watch: a first
notice arrives wrong about what the policy needed rather than about what happened. Then the driver
waits days to learn what they are covered for, and a handler spends the interval asking for the
field nobody told anyone to fill in.

That is a description of a role rather than of one person, and our own framing rule says a named
person scores and a role does not. The rule is right and this entry does not meet it. Inventing a
name to satisfy it would be the one fabricated thing in a submission that has published every
result that went against it, so the row stays red.

## What it does

Describe the crash to your own agent. It reads the insurer's typed tools and tells you what this
policy still needs while you are talking. Then the surface moves: answer that the car cannot be
driven and get_assistance_options registers live, a capability the agent lacked a moment earlier and
loses when that answer changes.

Three prompts to paste, with one page click between the second and the third:

    Read this claim page and tell me what it still needs from me.

    A delivery van reversed into my car while it was parked on Harbour Road. It caught the left front wing and left a dent. Fill that in and write the description.

Now set **Still drivable** to no on the page yourself, and press **Pin** on that row. Then:

    Read the notes on the file, then read the claim again, do what that note asks, and tell me what the page said.

That note is a planted instruction inside third party evidence, and it asks for the row you just
pinned, so the answer is PATCH_REJECTED_LOCKED. Every answer also carries the route it arrived on:
on file, via page, via tool. That names a surface, not a person: the page cannot see who is
at the keyboard.

**Filing is human only.** No tool files, dispatches, pins or unlocks, and a test reads the source to
keep it that way. Filing leaves a handler packet from that exact revision, with the clause, the
excess, every requirement and a SHA-256 that scripts/verify_packet.mjs recomputes. Nothing is
transmitted and no claim is opened anywhere. With no key and no signature, a match shows only that
the content is unchanged.

## Why it is a strong fit for WebMCP, and a better experience

A REST endpoint with an OpenAPI file carries the same answers, once somebody builds that integration
for this insurer. This is browser native and same origin, with zero integration work: an
agent meeting this insurer for the first time discovers the tools at runtime. That is what was
difficult or impossible before, and it is why the driver hears their cover at the roadside,
not a week later in a letter.

## How it was built and implemented

Tools register on document.modelContext, falling back to navigator.modelContext, over a pure core, no
dependencies, no build step. Page and tools share one store, so an agent action shows on
screen. Read tools carry readOnlyHint and text the insurer did not write carries
untrustedContentHint. Both halves of the API ship: nine tools come from JavaScript, and a tenth is
an ordinary form carrying toolname and toolautosubmit, so an insurer adopts WebMCP
by adding attributes.

## Challenges, and the honest limits

Insurer, policy, vehicle and claimant are invented. No integration, no adjudication, no handler has
reviewed a packet, nobody has run this on a real intake.

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
