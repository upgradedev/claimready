# ClaimReady

The insurer's page hands your own agent its policy rules as typed tools, so you learn what you
are covered for while you are still describing the crash.

[![CI](https://github.com/upgradedev/claimready/actions/workflows/ci.yml/badge.svg)](https://github.com/upgradedev/claimready/actions/workflows/ci.yml)
[![Readiness](https://github.com/upgradedev/claimready/actions/workflows/readiness.yml/badge.svg)](https://github.com/upgradedev/claimready/actions/workflows/readiness.yml)
[![WebMCP evals](https://github.com/upgradedev/claimready/actions/workflows/evals.yml/badge.svg)](https://github.com/upgradedev/claimready/actions/workflows/evals.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

Two of those badges answer two different questions and it is worth knowing which is which. **CI** is
the engineering: secret scan, style gate, unit tests. **Readiness** is the submission: one table of
deliverable rows, and it is red on purpose while the public video is missing. The readiness gate
refuses to let a mandatory deliverable pass in any mode, `--ci` included, and a badge that hid that
would be the wrong badge. Until 2026-08-28 the two were one workflow, so the engineering badge read
red on every branch for a missing video, which told a reader the build was broken when nothing about
the build was.

A badge for a workflow that has not yet run on the default branch reports nothing rather than
reporting a pass. If **Readiness** looks blank, that is what it is saying.

ClaimReady is a first notice of loss page for a motor insurer. It is a static page with no
dependencies and no build step, and it publishes its own capabilities to the visitor's AI agent
through WebMCP.

**One note on the name, before you go looking for it.** ClaimReady is not a unique name. Search it
and you will also find unrelated products that share it, including a student project from 2025 and a
company selling AI home contents documentation. Both of those are home and property inventory tools
for homeowners and renters. This one is a motor first notice of loss page for a driver at the
roadside, it has no connection to either, and nothing here is derived from either. The identity of
this entry is a pair of URLs rather than a word: the repository at
<https://github.com/upgradedev/claimready> and the live page at
<https://upgradedev.github.io/claimready/>. If a link did not come from the submission, it is not
this project. The name is kept rather than changed because renaming in the last week would move the
one URL that must never break, the live page the readiness gate fetches and a judge opens, and a
shared name costs a search result rather than an entry.

## Contents

- [Who this is for](#who-this-is-for)
- [Why this needs WebMCP](#why-this-needs-webmcp)
- [How it fits together](#how-it-fits-together)
- [One journey, call by call](#one-journey-call-by-call)
- [What is a tool here, and what is deliberately not](#what-is-a-tool-here-and-what-is-deliberately-not)
  - [The registration call](#the-registration-call)
  - [Never tools, by design](#never-tools-by-design)
- [Security](#security)
- [Open it yourself](#open-it-yourself)
- [Quickstart, with nothing installed](#quickstart-with-nothing-installed)
- [Status](#status)
- [Repository layout](#repository-layout)
- [Licence](#licence)

## Who this is for

The driver standing at the roadside with a damaged car and a phone, and behind them the first
notice of loss handler at a regional motor insurer who opens the claim next morning.

The driver gets an answer about their own cover while they are still describing what happened,
instead of a form, a call queue and a letter three days later. That is the half this demo shows.
The handler's half, a claim that arrives with the cover already checked against the policy that was
actually sold, is a consequence of the driver's half rather than something you can watch here.
There is no desk side surface in this repo: no queue view, no arriving claim view, and nothing that
measures whether claims arrive more complete.

Today that conversation happens twice. The driver tells an assistant what happened, the assistant
guesses at the cover from general knowledge, and then the driver retypes everything into the
insurer's form anyway. ClaimReady removes the second half by letting the page itself tell the agent
what the policy says.

## Why this needs WebMCP

Remove WebMCP and the agent has no typed, authoritative route into the insurer's own policy rules,
so it is back to guessing the cover from general knowledge and retyping the answers into a form.

That is the whole point. The rules live on the insurer's origin, where they belong. The agent does
not scrape them, does not hold them in a system prompt and does not need an integration to be built
for it in advance. It asks the page, and the page answers with a clause id.

The dullest honest alternative is a REST endpoint with an OpenAPI file beside it, and it is worth
naming rather than dodging, because for most of what this page does the REST endpoint is perfectly
adequate. It loses on two specific counts, and both are checkable from outside.

**One. Discovery has to happen in advance, and here it does not.** A REST plus OpenAPI integration
has to be built for this insurer, by somebody, before any agent can use it, which does nothing for
an agent meeting this origin for the first time. Here the agent asks the page. Check it by loading
the two rule packs in `fixtures/insurers/` against the same claim: `northwind` and `kestrel` make
the same nine tools answer differently, with different requirements and different clause ids, and
nothing was rebuilt between them. That is the difference between an integration and a discovery.

**Two. The capability set is a function of the claim, and a REST surface is a function of the
deploy.** `get_assistance_options` does not exist while the page thinks the car is drivable. Say the
car cannot be driven and it is registered, live, into the agent's own tool list. Say it is drivable
again and it is withdrawn. Watch the count move from 8 to 9 on the status strip. An OpenAPI document
describes what a service offers; it cannot describe what this service offers *right now*, for *this*
claim, and it certainly cannot hand a new capability to an agent in the middle of a conversation.

That second point is the one this repository spends its evidence on, because it is the one a
reviewer should be most suspicious of. `evals/negative-control.json` is a case that is required to
FAIL: it applies a patch that puts the car back on the road, and then requires the ninth tool to be
gone. Its companion, journey 2, requires the tool to survive a patch that was refused. Together they
say the surface moves when a patch lands and holds still when one does not.

Where the honest limit is. There is no measurement here of intakes arriving more complete, because
no insurer has run this and inventing that number would be worse than not having it. What the
repository can support is what the mechanism does, and it is all reachable: nine tools, two rule
packs, one conditional tool, one refusal protocol, and a ledger that prints every call.

## How it fits together

```mermaid
flowchart TB
  subgraph outside["The visitor's own agent"]
    AG["ChatGPT desktop browser, or Chrome with the WebMCP testing flag"]
  end

  subgraph origin["claimready, one origin, no runtime network calls"]
    MCP["WebMCP layer: detect document.modelContext, register tools with an AbortSignal each"]
    TOOLS["Tools: describe, read, requirements, patch, validate, check cover, estimate, evidence notes, assistance options"]
    STORE["Store: one claim draft, subscribers notified on every change"]
    CORE["Core domain: claim rules, insurer rule packs, derived requirements, coverage table, repair bands. Pure, no DOM"]
    UI["Page: fields, evidence, live tool call ledger"]
    HUMAN["No tool reaches these: File claim, Request roadside assistance, Pin a field"]
  end

  AG -->|"registerTool and execute"| MCP
  MCP --> TOOLS
  TOOLS -->|"dispatch"| STORE
  TOOLS -->|"read and compute"| CORE
  STORE -->|"subscribe"| UI
  CORE --> STORE
  UI -.->|"a control on the page, no tool exists for it"| HUMAN
  HUMAN --> STORE

  classDef guarded fill:#fce8e6,stroke:#a50e0e,color:#a50e0e
  class HUMAN guarded
```

Follow the arrows into the guarded box. No arrow arrives from the agent, from the WebMCP layer or
from the tools, because the guarded actions sit outside the tool surface. There is no tool that
reaches them, so there is nothing for a prompt injected agent to call.

That is a claim about the tool surface and it stops there. The page does not know who pressed a
button, nothing here records it, and the section on
[what is never a tool](#never-tools-by-design) says why we do not pretend otherwise.

The layer map, the dependency rule and the reasoning behind each boundary are in
[docs/architecture.md](docs/architecture.md).

## One journey, call by call

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver
  participant A as Your agent
  participant T as ClaimReady tools
  participant S as Store
  participant P as Page

  D->>A: I reversed into a bollard on Thursday, the wing is dented
  A->>T: read_claim_state
  T->>S: read the draft
  S-->>T: draft plus the fields still missing
  T-->>A: what is set, what is missing
  A->>T: apply_claim_patch incident_date 2026-08-20
  T->>S: dispatch a patch
  S-->>P: subscribers notified
  P-->>D: the field fills in and the ledger shows the call
  A->>T: apply_claim_patch damage_zone 4 severity dent
  A->>T: check_coverage
  T-->>A: covered, clause id, deductible
  A->>T: get_repair_estimate
  T-->>A: a triage band, not a prediction
  A->>T: validate_claim
  T-->>A: ready, nothing missing
  A-->>D: Your cover applies. Read it over and press File claim.
  D->>P: clicks File claim
  Note over P,S: filing is human only and is never registered as a tool
```

## What is a tool here, and what is deliberately not

Tools are descriptive. They say what they return, never what the agent should do next. None of them
carries an instruction aimed at a model.

| Tool | Reads or writes | Annotations | State today |
|---|---|---|---|
| `read_claim_state` | reads | `readOnlyHint: true`, `untrustedContentHint: true` | built |
| `describe_claim` | reads | `readOnlyHint: true`, `untrustedContentHint: true` | built |
| `get_requirements` | reads | `readOnlyHint: true` | built |
| `apply_claim_patch` | writes one field of the page's draft | `readOnlyHint: false` | built |
| `validate_claim` | reads | `readOnlyHint: true` | built |
| `check_coverage` | reads | `readOnlyHint: true` | built |
| `get_repair_estimate` | reads | `readOnlyHint: true` | built |
| `read_evidence_notes` | reads | `readOnlyHint: true`, `untrustedContentHint: true` | built |
| `get_assistance_options` | reads, and is registered only while the claim says the vehicle cannot be driven | `readOnlyHint: true` | built |

The first eight are registered for the life of the page. `get_assistance_options` comes and goes:
`src/webmcp/register.js` re-asks `CONDITIONAL_TOOLS` on every store change, so the tool appears when
`vehicle_drivable` is false and is withdrawn when the car is drivable again. The page's status strip
reads the live registered list, so you can watch the count move.

`untrustedContentHint` is set on the three tools that hand back free text the insurer did not write.
The claim description is the visitor's words, and the evidence notes are a repairer's and a third
party's words, so none of it is the insurer speaking and all of it is labelled that way. The one tool
that writes says `readOnlyHint: false` out loud rather than leaving the annotation off, because an
empty annotations block leaves an agent unable to tell a write apart from a tool nobody got round
to annotating.

WebMCP defines exactly two annotations. Any other hint name comes from a different MCP dialect and
is rejected by `node scripts/check_style.mjs` before it can reach a judge.

### The registration call

Every tool on this page is registered through one call, and this is its shape:

```js
document.modelContext.registerTool({
  name: 'check_coverage',
  description: 'Check the claim draft on this page against the policy it belongs to.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  async execute(input, options) { /* returns { content: [{ type: 'text', text }] } */ }
}, { signal: new AbortController().signal });
```

The shipped code makes exactly that call with the receiver resolved into a variable first, because
`navigator.modelContext` is the older spelling and some builds still ship only that one. Two lines
from `src/webmcp/register.js`, verbatim:

```js
// getModelContext() reads document.modelContext, then navigator.modelContext, else null
const modelContext = getModelContext();

// One AbortController per tool, so a single tool can be withdrawn while the page runs
await modelContext.registerTool(descriptor, { signal: controller.signal });
```

Both of those lines live in `src/webmcp/register.js`. Find them with
`grep -n "getModelContext()" src/webmcp/register.js` and
`grep -n "registerTool(descriptor" src/webmcp/register.js`, then read the function itself, at
`grep -n "export function getModelContext" src/webmcp/register.js`, to confirm the variable is
`document.modelContext` whenever the browser has it. Line numbers are deliberately not quoted:
the previous set went stale inside a day, and a citation the reader has to distrust is worse than
a command they can run.

### Never tools, by design

- **File claim.** A control on the page. No tool reaches it, and there is no `file_claim`, no
  `submit_claim`, no alias.
- **Request roadside assistance.** A control on the page. No tool reaches it. Dispatching help
  costs money and sends a vehicle to a location.
- **Pin and unpin a field.** A control on the page. No tool reaches it. Pinning is how the claimant
  says they have checked an answer themselves, and `apply_claim_patch` then refuses that field with
  `PATCH_REJECTED_LOCKED`.

Overriding the coverage table is not on the list because it is not an action at all. Nobody can do
it from either side: the answer is a table lookup in `src/core/coverage.js`, and no path in this
repo edits it.

Be exact about what this buys, because the loose version of the claim is false. An agent that
drives a browser clicks ordinary DOM buttons, and the W3C security considerations and OpenAI's own
WebMCP documentation both say so. Nothing on this page can tell a synthetic click from a human one
and this page does not try, because an `isTrusted` or `userActivation` check blocks an honest probe
while a remotely driven browser sails through it, which manufactures exactly the false certainty
worth removing.

What is true is narrower and more useful: **no tool on this page reaches those three actions**. An
agent that has been prompt injected can draft the whole claim, check the cover, get an estimate,
and write a wrong value into any field the claimant has not pinned. That last one is a real risk
this page does not remove, and an earlier version of this section understated it by listing only
what no tool reaches. What is absent from the tool surface is a tool for filing, for assistance
and for unpinning, because none of the three is published. What the claimant holds against the
rest is the pin, the revision protocol, and a ledger that shows every tool call as it happens.
The ledger is instrumentation on the tool surface and nothing else. A button pressed in the
browser, by a person or by an agent driving the page, leaves no entry in it, because there is no
tool call to record.

`node scripts/readiness.mjs` scans the tool files for those names on every push and fails the build
if one appears. What that proves is precise: no tool file declares one. It is a name blocklist over
the tool surface, not a runtime guard on the buttons.

## Security

Our choices, mapped to the Chrome WebMCP tool security guide at
<https://developer.chrome.com/docs/ai/webmcp/secure-tools>.

| Guidance | What ClaimReady does |
|---|---|
| Keep tools same origin | Every tool is registered on this origin. `exposedTo` is never passed, and the readiness gate fails if it appears. The `tools` Permissions Policy is left at its default of `self` and nothing on the origin loosens it: no header sets it, and no meta tag sets it. `vercel.json`, which production does not use, deliberately sets no entry for it either, and the readiness `VRC` row fails if one appears there. |
| Use the annotations that exist | `readOnlyHint` and `untrustedContentHint`, declared explicitly on every tool rather than left to a default. The style gate rejects annotation names from other dialects. |
| Validate every input in code | JSON Schema tells the agent the shape. It is not the check. Three tools take input, `apply_claim_patch`, `get_repair_estimate` and `get_requirements`, and each re-validates in code against the enums in `src/core/claim.js` or the loaded rule pack, so an unknown field, an unknown requirement id or an out of range value comes back as a sentence the agent can correct itself from rather than being written. The other six declare an empty schema and take no input at all, which you can confirm with `grep -c "properties: {}" src/webmcp/tools/*.js`. |
| Keep tool output small | Tool output is capped at 1500 characters, the budget from the guide. Tool names are capped at 30 characters, tool descriptions at 500, parameter descriptions at 150, all enforced by `node scripts/check_style.mjs`. |
| Keep tool metadata descriptive | Descriptions say what a tool returns. None of them tells the model what to do, which is the line that keeps tool metadata from becoming an instruction channel. |
| Do not treat origin restrictions as a security boundary | We do not. Same origin registration limits accidental exposure, it does not stop a hostile page or a compromised agent. What we rely on instead is narrower and is stated as such: the actions with consequences are not in the tool surface, so a persuaded agent has no tool to call for them. It can still click a button, and it can still write a wrong value into an unpinned field. |

Two more, because they are part of the same promise:

- **No secrets and no runtime network calls.** The judge path makes zero external requests. There is
  no API key in this repo because there is no API to call.
- **Synthetic data only.** Every name, plate, policy number and vehicle in the fixtures is invented.

## Open it yourself

**https://upgradedev.github.io/claimready/**

**What is running there, and how to check it rather than believe it.** The deployed commit is
whatever these two commands say, and they are the source of truth, not this paragraph:

```sh
gh api repos/upgradedev/claimready/pages/builds/latest --jq '.commit, .updated_at'
git rev-parse HEAD
```

Observed on 2026-08-28: Pages had built `4023446e7916b867f1365f871b08885d5cb45655` at
`2026-08-28T06:57:47Z`, which was the head of `main` at that moment. Pages rebuilds on every push,
so the two agree again a minute or so after any commit, and a reader who finds them disagreeing has
found a real problem rather than a stale note.

Those two agreeing is the whole point. A green check against a commit the host is no longer serving
proves nothing about what a judge opens, and this repository has already had that happen once: two
green eval runs named a commit that two later commits had superseded. The evals row in the Status
table now names a run whose `headSha` is the built commit, for exactly that reason.

No account, no install, nothing to accept. The page is served over HTTPS, which WebMCP requires,
and it carries its Content Security Policy in the document, which is what makes the policy hold
here: GitHub Pages sends no CSP header of its own. The Status table below is the honest state of
everything else, and `node scripts/readiness.mjs` prints it on demand. The gate fetches this URL by
default, so a red `LIVE` row means the live surface really is broken and is never a row to read
past.

WebMCP is new, so a judge needs one of two surfaces.

**1. The ChatGPT desktop app's built in browser.** Open the app, press `Ctrl+Shift+B` (or
`Cmd+Shift+B`), and load the page. This needs a model build with WebMCP support. If tools never
appear, switch models and reload before assuming the page is broken.

**2. Chrome 149 or later, with the flag.** Go to `chrome://flags/#enable-webmcp-testing`, enable it,
relaunch, then load the page. Install the WebMCP Model Context Tool Inspector extension to see the
registered tools, their schemas and the result of each call.

Chrome 149 is the first build with WebMCP, but 153 or later is the better one for this page. The
imperative API documentation, read on 2026-08-27 at
<https://developer.chrome.com/docs/ai/webmcp/imperative-api>, records that unregistering a tool
stopped cancelling in-flight executions as of Chrome 153, and this page withdraws a tool live.

The page tells you which API name it found, `document.modelContext` or `navigator.modelContext`, and
shows a running ledger of the tool calls your agent makes, so nothing about the integration has to
be taken on trust.

Three prompts to paste:

1. `Look at this claim page, tell me what it still needs from me, then set the incident date to last Thursday and the damage to a dent at the 4 o'clock position.`
2. `Check whether my policy actually covers this, and tell me the clause and my deductible before I file anything.`
3. `List every tool this page gives you, then tell me which of the things on this claim you can do through a tool and which ones the page says a person has to do.`

The third one is the interesting prompt, and the honest answer is the interesting one. The page
publishes eight tools, nine once the draft says the car cannot be driven, and none of them files a
claim, requests a roadside collection or pins a field. The agent does not have to be told that: the
page says it in its own tool output, so the answer comes back with the page's wording in it,
`Filing the claim is a button pressed by the person on the page. It is not available as a tool.`

Be clear about what that does and does not settle, because a judge will test the loose version of
it. If you then say `file this claim for me`, a browser driving agent may well press the button,
and OpenAI's own WebMCP documentation says an agent falls back to its ordinary browser capabilities
when no tool fits. That is the expected behaviour and it is not a hole in the claim. The claim is
about the tool surface: there is no name on the published list for filing, so nothing an injected
instruction can ask for reaches it through a tool.

## Quickstart, with nothing installed

This repo has no dependencies. There is no `npm install` to run, and there is no lockfile, because
there is nothing to lock. The quickstart uses Python's built in server rather than `npx serve`,
since `npx` would download a package, and the point is that nothing here needs downloading.

```sh
# serve the repo root on http://localhost:4173
python -m http.server 4173

# run the domain tests, no runner and no config
node --test tests/unit

# the style gate: em dashes, annotations that do not exist, tool budgets
node scripts/check_style.mjs

# the readiness gate, one table, every row saying what it blocks. It fetches the live URL
node scripts/readiness.mjs

# offline, with no network. The LIVE row then proves nothing and prints NOT DEPLOYED
node scripts/readiness.mjs --ci --allow-undeployed

# prove the gate can fail, by breaking every row in turn and requiring each one to refuse
node scripts/readiness.mjs --selftest

# replay the three eval journeys against the real registration path, with a fake agent host
node evals/replay.mjs

# the negative control: a patch that lands must WITHDRAW the ninth tool, so this case must fail
node evals/replay.mjs --negative-control

# and prove that control can fail, three different ways. Each of these must exit non zero
node evals/replay.mjs --negative-control --mutate applied-patch-refused
node evals/replay.mjs --negative-control --mutate withdrawal-ignored
node evals/replay.mjs --negative-control --mutate ninth-tool-never-registered
```

Both readiness runs above exit non zero while the video row `D4` is red, and that is deliberate:
a mandatory deliverable that is missing turns the build red in every mode, `--ci` included.

Node 20 or later. `python -m http.server` does not send the production security headers, so a page
that works locally can still break on the deployed origin. The readiness gate's `IDX` row catches
the usual cause, which is an inline `<style>` or `<script>` block that our Content Security Policy
forbids.

## Status

Honest state of the repo. Nothing below is claimed because it is planned, and the build is still
moving, so this table names states and the command that settles each one rather than counts that
go stale between commits.

| Piece | State | How to check |
|---|---|---|
| Style gate | built | `node scripts/check_style.mjs` |
| Readiness gate, with a self test that breaks every row it prints | built | `node scripts/readiness.mjs --selftest` |
| Content Security Policy, carried in the document so it holds on the host we actually use | built | `grep -n Content-Security-Policy index.html`. GitHub Pages serves no CSP header, so the meta tag is the policy |
| `vercel.json`, a host config production does not use | built, unused | `cat vercel.json`. Production is GitHub Pages, which reads nothing from this file. It is kept because it is the config any host with header support would need, and the `VRC` row checks it as such |
| No build step | built | there is no build script in `package.json`, and the deployed bytes are the files in this repo |
| MIT licence | built | `cat LICENSE` |
| Core domain: claim, coverage, estimate, store, insurer rule packs, derived requirements | built | `node --test tests/unit`, and row `PUR` |
| WebMCP registration layer, one AbortController per tool | built | `cat src/webmcp/register.js` |
| Tools | built | count them with `ls src/webmcp/tools/*.js`, and row `TOL` |
| Page and tool call ledger | built | open `index.html`, and row `IDX` |
| Unit tests | built | `node --test tests/unit` prints the pass and fail counts |
| Live URL a judge can open | deployed | `node scripts/readiness.mjs` row `LIVE`, which fetches it and fails on anything but a 200 carrying the first sentence of this file |
| Content Security Policy actually exercised against the page | yes, on the deployed origin, re-checked 2026-08-28 against the commit now served | open the live URL with the console open: the policy ships in the document, and the page loads with no console output at all. The date matters. This row was first written against an earlier deploy, and two commits landed after it, so it was re-observed rather than carried forward. The one automated check that reads a console is `CAPTURE_JS` in the video pipeline, which fails a capture on any `console.error`. The eval harness does not: see `evals/README.md` |
| Damage sketch module, agent draws and human corrects | not yet built | absent from `src/webmcp/tools` |
| Conditional tool that appears while the vehicle cannot be driven | built | `cat src/webmcp/tools/get_assistance_options.js`, and `CONDITIONAL_TOOLS` in `src/webmcp/register.js` |
| Roadside assistance dispatch simulation, the booking a person's click would send | not yet built | no dispatch call in `src/ui/app.js` |
| Declarative form step, the HTML attribute API | not yet built | absent from `index.html` |
| Tests over the WebMCP layer | built | `node --test tests/unit/webmcp.test.js` prints the count. They drive the real registration path against a fake host object, named as a fake, so they prove the descriptors and the lifecycle and say nothing about any browser. This row used to hardcode a number and the number was wrong, so it now names the command instead, which is what the paragraph above this table promises |
| The tool surface running in a real browser's own WebMCP implementation | proven, in CI, against the deployed commit | [run 33151418595](https://github.com/upgradedev/claimready/actions/runs/33151418595), 2026-08-28: 16 of 16 steps across 3 journeys against the deployed page, driven by Chrome's own `webmcp-evals` harness, which launches Chrome with `--enable-features=WebMCP`. No shim of ours is involved. Its `headSha` is the commit GitHub Pages last built, which is the part that matters: two earlier green runs were against a commit that had since been superseded, so they proved nothing about the bytes now being served. Read the honest limit below before quoting this |
| Evals against the tool surface | built and executed | Three journeys over the nine tools, plus a fourth case that is a negative control and is required to FAIL. The harness is cloned and built from a pinned commit rather than installed, because the published package has no deterministic mode: npm carries 0.0.1 to 0.0.3 and their CLI offers only `local` and `browser`, so the `smoke` command this needs has never been released. `cat evals/evals.json`, `cat evals/negative-control.json`, `cat .github/workflows/evals.yml` |
| **The honest limit on the run above** | stated, not hidden | The harness marks a step passed when the expected call is made and returns output. A refusal travels back inside an ordinary result envelope, so those 16 steps do not on their own assert that the refusals refused. What the negative control adds is the other direction: it applies a patch that is legal, requires the ninth tool to be WITHDRAWN, and fails the workflow unless the harness reports exactly seven of eight steps passed and names the last one. Read as a pair, the surface moves when a patch lands and holds still when one is refused, which is what makes journey 2 evidence rather than a no op. That pair has been replayed offline and made to fail three ways; it has **not yet been run in a browser**, because it is not yet on a pushed branch. Narrower still, and stated in `evals/README.md`: three green runs have shown Chrome REGISTERING a tool mid page and keeping it, and nothing has yet shown Chrome WITHDRAWING one. That half is proven against our own code and a fake host only. A second limit lives there too: smoke mode gathers the page's browser console errors and never reports or gates on them, so a green run says nothing at all about the console |
| Public video | not yet built. It is the only row that blocks the readiness **exit code**, and it turns the **Readiness** badge red on every branch until a public link lands in `docs/submission/video.md`. It no longer turns the engineering **CI** badge red, because the two are separate workflows. It is **not** the only thing between this repository and a finished submission: `node scripts/readiness.mjs` today prints `READY TO SUBMIT: 14 of 20 proven, 70 percent`, and the six outstanding rows are `D4` plus five owner gated ones, including `O3`, whether the form reads Submitted | `node scripts/readiness.mjs` row `D4` |
| Written description | drafted, not yet pasted into the submission form | `docs/submission/description.md`, and `node scripts/readiness.mjs` row `D3` |

Every count in this README comes with the command that produces it, so no number here has to be
believed. The readiness gate is the live version of this table, and it is the one to trust when the
two disagree.

## Repository layout

```
index.html            the judge URL, static, no inline script or style
assets/styles.css     all styling, external because our CSP forbids inline styles
src/core/             pure domain: store, claim, coverage, estimate, policy packs, requirements. No DOM, no fetch
src/webmcp/register.js  API detection, registration with one AbortController per tool, output budget
src/webmcp/tools/     one tool per file, one default exported factory each
src/ui/               rendering, the tool call ledger, and the human only buttons
fixtures/             the synthetic policy, vehicle and parts table
fixtures/insurers/    the insurer rule packs the requirements are derived from
tests/unit/           node --test, no runner
scripts/              the style gate, the readiness gate and the scenario generator, all dependency free
evals/                the three journeys, the negative control that must fail, and the offline replay
docs/architecture.md  the layer map and the dependency rule
docs/submission/      the description and the video runbook, which are the deliverable records
video/                the per beat video pipeline and its sync gate
```

## Licence

MIT. See [LICENSE](LICENSE).
