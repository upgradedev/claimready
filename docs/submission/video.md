# ClaimReady demo video

This file is two things. It is the runbook the owner records from, and it is the record of the
deliverable itself. The readiness gate reads the link at the bottom, so this file is also what turns
row D4 green.

Everything below is written so a person can record without asking a question. Each take has the
exact prompt or the exact clicks, what has to be in frame, how long to run, the frame to stop on,
and the path to save to.

## Deliverable record

| Field | Value |
| --- | --- |
| Public video URL | **NOT YET UPLOADED** |
| Visibility required | Public. Not unlisted, not private. The rules ask for a public video |
| Length cap | less than three minutes. The pipeline caps the cut at 170 seconds |
| Length of the finished cut | **not measured.** The cut does not exist. Six owner takes have not been recorded, so nothing has been assembled and no gate has read a cut |
| Beats | nine. Three captured in CI, six recorded by the owner |
| Targets, as the tool prints them | `python video/build_video.py --plan` prints `9 beats, targets adding to 166s, cap 170s` |
| Built by | `video/build_video.py`, gated by `video/sync_gate.py` |
| Built in | `.github/workflows/video.yml`, workflow dispatch |
| Filmed against | the repository variable `CLAIMREADY_URL`, at a commit the build verifies and writes into `manifest.json` as `deployed_sha` |
| Freeze commit | `9450d70`, declared 2026-09-02 after the release was served and verified over all 26 files the page loads. It supersedes `357410e`, `e942ee3`, `c93b138` and `9b64fb2`, all named below with their reasons |

## The freeze

**Freeze commit: `9450d70`.** Every file the page loads is at that commit. Verified after GitHub
Pages served it:

```sh
python video/build_video.py --verify-deployed   --url https://upgradedev.github.io/claimready/ --deployed-sha 9450d70
```

It printed `the deployed page is 9450d70, on every one of those files` and exited 0, over all 26 of
them, the three insurer and demo JSON fixtures among them.

**Native evidence against that exact commit**, dispatched after the release rather than quoted from
an older run: [run 33627149683](https://github.com/upgradedev/claimready/actions/runs/33627149683),
workflow `WebMCP evals`, conclusion success, `headSha` `9450d70`, on
`Google Chrome 154.0.8025.0 dev`. It reported `Passed steps: 16/16 across 3 case(s)`, the negative
control `Passed steps: 7/8 across 1 case(s)` with the verdict `PROVEN`, and our own probe
`probe: PASS. 110 checks against the deployed page, none failed`.

**The run and the freeze name one commit**, which is the state this file has been chasing all day
and the only state a take may be shot in. Every earlier run in this file names an earlier runtime
and is kept for that reason rather than quoted as current.

**Read 110 as the size of the judgement rather than a score for the page.** It was 53, then 71, then
81, then 110, and the page did not improve between them. Each rise is a class of forged transcript
that used to pass: first the schema and the origin, then the note read and the declarative write,
then three calls that had no reading of the draft either side of them. An earlier
[run 33616908770](https://github.com/upgradedev/claimready/actions/runs/33616908770) printed 81
against these same bytes, and it is kept as a true statement about the judgement of that hour.

**What may change after this line, and what may not.** Commits after `357410e` may touch
documentation, evidence and this runbook. They may NOT touch `index.html`, `src/`, `assets/` or
`fixtures/`. Those are the 26 files the page serves and the takes are shot against them. The command
above is how anyone checks the promise was kept: run it with `357410e` after any later commit and it
still has to exit 0.

**Unfreezing again needs a stated reason and only three of them count**: a judge-facing statement
that is false, a mandatory deliverable that is broken, or a rule violation that risks
disqualification. Not making something better. To unfreeze, write the defect here, say which takes
it invalidates, then re-freeze at the new commit and record the new SHA beside the old ones rather
than replacing them.

### Four superseded declarations, each named with its reason

**`e942ee3`, declared and superseded on 2026-09-02.** The filing receipt attested object identity
rather than the state that passed the gate, so values changed after filing were sealed into the
packet while it went on saying the filing happened through a control on the page. That is a
judge-facing statement that was false, which is the first of the three reasons this file allows.

**`c93b138`, declared and superseded on 2026-09-02.** Most of this runbook was written against it.
The correctness work package landed on the runtime under it.

**`39690d4`, never declared here.** It was `origin/main`, so a default dispatch of
`.github/workflows/video.yml` would have written it into `manifest.json` as `deployed_sha`.

**`9b64fb2`, declared 2026-09-01**, and the unfreeze that ended it is recorded below.

**No take was invalidated by any of them, because none has been shot.**

### Native runs kept as history, and not quoted as current

[Run 33600367240](https://github.com/upgradedev/claimready/actions/runs/33600367240) at `12f7935`
and [run 33588857520](https://github.com/upgradedev/claimready/actions/runs/33588857520) at
`e942ee3` both reported the same three numbers. They are true about the runtime `e942ee3` and about
nothing later than it. [Run 33560224732](https://github.com/upgradedev/claimready/actions/runs/33560224732)
at `c93b138` reported `probe: PASS. 71 checks`, and the probe's judgement has grown since: the note
phase and the declarative phase were each found passing a forged transcript, so both compare a whole
claim state now. Ten checks were added to the oracle, not to the product.

**The record row is what the gate reads, and it reads only that row.** `FRZ` used to take the first
line anywhere in this file that said freeze commit and carried a backticked hex string, which meant
a paragraph explaining a SUPERSEDED freeze was enough to turn it green. It went green over this very
file. The row is now the deliverable record row alone, and the SHA has to be the first thing in its
cell, so the history above votes on nothing.
`tests/unit/readiness_freeze_row.test.js` feeds both of those shapes in and requires a refusal.

### The unfreeze that produced the superseded `c93b138`, recorded as this file requires

The freeze before it was **`9b64fb2`, declared 2026-09-01**. It was broken deliberately on
2026-09-01, before any take was shot, and the reason is the first of the three this file allows: a
judge-facing statement that was false.

**The defect.** `src/core/coverage.js` returned `provisional: true` for a covered claim whose driver
is not yet named. The page drew `Covered, provisionally` and `check_coverage` answered
`COVERED, PROVISIONALLY`, while `src/core/packet.js` carried no reference to `provisional` at all
and sealed a flat `covered` inside a SHA-256 digest. So the artifact a handler receives contradicted
the page it came from, and the digest made it look settled.

**A second runtime defect was closed in the same unfreeze**: filing failed open when the
authoritative home insurer was missing, so a policy the file says is with one insurer could be filed
under another's rules.

**Which takes any of this invalidates: none.** No take has been recorded. All six owner takes are
still to be shot, and they will be shot against whatever commit the record row ends up naming.

**What may change before that row is filled, and what may not.** Everything may change now, because
nothing has been recorded. Once the row names a SHA, later commits may touch documentation, evidence
and this runbook, and they may NOT touch `index.html`, `src/`, `assets/` or `fixtures/`, because
those are the 26 files the page serves and the takes are shot against them. The verify command above
is how anyone checks that promise was kept: run it with the declared SHA after any later commit and
it still has to exit 0.

**Unfreezing after that needs a stated reason and only three of them count**: a judge-facing
statement that is false, a mandatory deliverable that is broken, or a rule violation that risks
disqualification. Not making something better. To unfreeze, write the defect here, say which takes
it invalidates, then re-freeze at the new commit and record the new SHA beside the old ones rather
than replacing them.

**No gate has passed on a cut, because there is no cut.** What has passed is
`python video/sync_gate.py --selftest`, which builds its own small media with ffmpeg and proves each
check refuses what it is meant to refuse. That says the instrument works. It says nothing about a
deliverable that has not been made.

**There is no measured length, and none is invented here.** An earlier version of this file carried
135.80s from a rehearsal render on 2026-08-27. That figure described narration that has since been
rewritten in six of the nine beats, and it predates `06b-declared-form` entirely, so it has been
removed rather than adjusted. The only number that can be stated without rendering anything is the
sum of the targets in the nine `beat.json` files, and it is printed by the tool rather than
remembered:

```sh
python video/build_video.py --plan
```

The targets are deliberately a little longer than the narration in every beat, and the finished
length is the narration, so the cut comes in under the sum. That is a design property, not a
measurement, and it stays unmeasured until row G of the sync gate prints a duration for a real cut.

When the cut is uploaded, replace **NOT YET UPLOADED** above with the full watch link copied from
the browser address bar, scheme included. The readiness gate looks for a YouTube link in this file
and fails until it finds one, so nothing here pretends the video exists before it does.

## The cut

| Beat | Kind | Target | What is on screen |
| --- | --- | --- | --- |
| `01-problem` | machine | 12s | the page as it boots, three rows answered and seven reading `not set`, the panel reading ten published tools, and the list of what this policy needs |
| `02-publishes` | machine | 15s | the strip reading `8 tools registered`, and the tool names |
| `03-agent-fills` | owner | 29s | the agent reading the policy and writing the draft, field by field |
| `04-human-corrects` | owner | 22s | a person setting the car to not drivable, the revision moving, the pin, and the strip going 8 to 9 |
| `05-reconcile` | owner | 23s | the agent reading back, the requirements recomputed, and the ninth tool in its list |
| `06-refusal` | owner | 21s | the planted note read, and the pinned field refused in the ledger |
| `06b-declared-form` | owner | 13s | the declarative half: an ordinary form, filled and submitted by hand |
| `07-human-files` | owner | 16s | a hand pressing Request roadside assistance, then File this claim |
| `08-close` | machine | 15s | the one sentence, and the architecture line |

Beat order is the directory order under `video/beats`, sorted. Nothing else decides it. That is why
the declarative beat is `06b-declared-form`: it must come after `06-refusal` and before
`07-human-files`, because filing closes that form.

## Preflight, before you record anything

Work down this list. Every line is either a thing that has wasted a take before, or a recorder
setting a take below depends on.

1. **The live page is up and is the commit the build will name.** Open `CLAIMREADY_URL` in an
   ordinary browser first and confirm it loads. The build refuses to film a page that is not the
   commit it is about to write into the manifest, so a stale deployment stops the build later
   rather than sooner.
2. **Open the page in the ChatGPT desktop built in browser, signed in to your own account.** The
   menu path, on the Windows app: **View, Browser, Open Browser Tab**, or `Ctrl+T`. It is not
   `Ctrl+Shift+B`, which is what an earlier version of this file said. Paste the judge URL into the
   panel's address bar.

   Two settings decide whether tools appear at all, and both are outside this page: the model must
   be **GPT-5.6 Sol or GPT-5.6 Terra**, because Luna has WebMCP disabled, and site tools are **not
   available in Enterprise or Edu workspaces**. Read live on 2026-08-31 from
   <https://learn.chatgpt.com/docs/webmcp>. This whole path was walked on 2026-08-31 on the Windows
   app, package `OpenAI.Codex 26.825.6671.0`, model 5.6 Sol Ultra, and the page reported `Agent
   connected through document.modelContext. 8 tools registered.`
3. **Confirm the status strip reads `8 tools registered` and names the API it found.** If it does
   not, stop. A page that did not publish its tools is not worth filming.
4. **Press Load synthetic incident.** Every take below assumes that starting point, and all six
   owner takes, `03-agent-fills` through `07-human-files`, are one continuous session from it.
5. **Put the Draft revision number in the header in frame and keep it there.** Four of the six takes
   turn on that number moving.
6. **Record at 1920 by 1080 if the machine can.** Everything is scaled and padded to that, so a
   smaller window is safe, it is just softer.
7. **Record a few seconds longer than the target.** The picture is trimmed to the narration, so a
   long take costs nothing. A take shorter than its narration is held on its last frame, which
   reads as a freeze, and the build refuses a hold longer than 1.5 seconds.
8. **No system audio and no voice on the take.** The narration is rendered separately and the
   take's own audio is discarded.
9. **Do not press Load synthetic incident again** once take 1 has started. It advances the
   revision and resets the draft, and every later take reads from where the last one left off.
10. **Turn cursor capture on in the recorder.** Takes 5 and 6 ask for a button pressed by hand and a
   box typed into by hand, and several recorders leave the pointer out of the picture by default.
11. **Find the pause key on your recorder before you start, and know that you will need it.** The
   model thinks for a long time. Measured on 2026-08-31, one prompt at a time: **2m 05s** to answer
   the first question, **1m 22s** to come back with the patch it proposed, **1m 07s** to save it
   after the confirmation. The takes that involve the assistant are 20 to 33 seconds long, so the
   thinking cannot be in them.

   **Pause the recording while it thinks. Resume the moment the answer starts to appear.** That
   keeps one continuous session, changes nothing about what happened, and leaves a take that is
   mostly the thing worth watching: the ledger filling, the rows moving, the revision stepping.
   Do not fake the wait away by cutting mid sentence, and do not speed the picture up.

   A faster answer is worth trying before you record: the model picker at the bottom of the
   composer offers builds with less thinking, and the session above was on the slowest one.

Save every take as `video/beats/<beat id>/take.mp4`. That exact path, that exact name. To see what
is still missing, and the recording instructions for each:

```sh
python video/build_video.py --check-takes
```

It exits non zero while a take is missing and names every one of them, so it is also the check to
run before pushing.

## Record in this order

`03-agent-fills`, `04-human-corrects`, `05-reconcile`, `06-refusal`, `06b-declared-form`,
`07-human-files`. One session, in that order, without reloading.

The order is forced by the product, not by preference:

- `06-refusal` needs the row `04-human-corrects` pinned. On a fresh page the planted note asks for
  something nothing is protecting and the beat has nothing to show.
- `06b-declared-form` needs the draft still open. `renderDeclaredForm` in `src/ui/render.js`
  disables every control on that form once the claim is filed.
- Inside `07-human-files`, Request roadside assistance must be pressed before File this claim.
  `assistanceApplies` in `src/ui/app.js` requires `claim.status !== 'filed'`, so filing closes the
  assistance control. Press it first or it cannot be pressed at all.

---

## Owner take 1 of 6: `03-agent-fills`

**Save to:** `video/beats/03-agent-fills/take.mp4`
**Run for:** about 33 seconds. The narration target is 29s.

**In frame the whole time:** the deployed page beside the conversation, with the claim draft, the
**Draft revision** chip in the header and the tool call ledger all visible if the screen allows it.

**Type this, word for word:**

```
Read this claim page and tell me what it still needs from me.
```

Let it answer. Then:

```
A delivery van reversed into my car while it was parked in the car park on Harbour Road. It caught the left front wing and left a dent. The car still drives, and it is still there in the Harbour Road car park. Fill that in for me and write the description.
```

**Two things about that sentence, and both are the point of the beat.**

**It never says "10 o'clock".** An earlier version did, and it quietly threw the demonstration away:
the claimant was speaking the insurer's vocabulary, so the agent had nothing to translate and the
row filled by copying. A person says "the left front wing". The clock face is the insurer's, it is
in the tool's enum and in the row's own label, and watching a model cross that gap is the thing
worth filming. If the row lands on 9 or 11 o'clock instead, keep the take: the narration names no
number, and beat 04 is where a wrong answer gets corrected by hand.

**It says where the car is.** That is not padding. Answer "cannot be driven" in beat 04 and this
insurer raises two requirements at once, the roadside collection and the collection address, and
the address is a field. Without it in this sentence, beat 07 presses the roadside control, the
address stays open, and **File this claim stays disabled**, which is exactly how the first attempt
at filming this stopped. `tests/unit/filmed_journey.test.js` runs the whole sequence three times
from a fresh draft and fails if that chain ever breaks again.

**It will ask before it writes. That is a third message, and it is not optional.** Observed on
2026-08-31: the assistant listed the five values it intended to send, said it needed confirmation
because the change transmits claim details, and waited. Answer:

```
Confirmed, save them.
```

Only then does `apply_claim_patch` reach the page. A take that stops at the proposal has no patch in
the ledger and no revision moving, which is most of what this beat is for.

**Must be visible on the take:**

- the status strip reading `8 tools registered`, and the API name it found
- the ledger filling with `read_claim_state`, `get_requirements` and `apply_claim_patch`
- claim rows moving from `not set` to a value, each carrying the `via tool` badge
- the **Damage position** row reading `10 o'clock, left front wing`, which nobody typed
- **Where it happened** carrying the car park, with a `via tool` badge. Open **Optional details** at
  the end of the take if it has not opened by itself, and check it. If that row is empty the rest of
  the session cannot file, so stop here and send one more sentence: `The car is still in the car
  park on Harbour Road. Put that on the claim.`
- the **Draft revision** number in the header rising as the patches land

**Stop on:** the filled draft, with the `via tool` badges on the rows the agent wrote and the
ledger showing the three calls. Hold there for two or three seconds before you stop the recording.

**The badge words are `via tool` and `via page`, not `agent` and `you`.** `BADGE_WORDS` in
`src/ui/render.js` names the surface an answer arrived on, on purpose, because the page cannot know
who was at the keyboard: an agent that drives a control rather than calling a tool is recorded the
same way a person is. The narration says what the badge says and claims nothing about authorship.

---

## Owner take 2 of 6: `04-human-corrects`

**Save to:** `video/beats/04-human-corrects/take.mp4`
**Run for:** about 26 seconds. The narration target is 22s.

**In frame the whole time:** the same page, the same session, with the **Still drivable** row, the
**Draft revision** number in the header and the **status strip** all visible. Leave the conversation
alone. This beat is a person using the page directly.

**No prompt. Do this:**

1. Note the **Draft revision** number before you touch anything. Do not say it out loud, the take
   has no audio. Just keep the header in frame so the before and the after are both on the take.
2. Set the **Still drivable** row to **No, it could not be driven**, using the select on the
   page. The row then displays `No`.
3. Press **Pin** on that same row.

**Must be visible on the take:**

- the **Still drivable** row moving to `No`
- the badge on that row reading `via page`
- the **Draft revision** number in the header stepping up
- the pin control on that row reading as pinned
- the status strip count stepping from `8 tools registered` to `9`, the instant **Still drivable**
  becomes `No`

**Stop on:** the pinned **Still drivable** row reading `No`, with the new revision number in the
header.

**No agent patch is sent in this take**, so no refusal can appear in it, and the narration does not
claim one. The refusal is produced in `06-refusal`, against the row that gets pinned here. That is
why this take matters: without the pin, `06` has nothing to refuse.

**The ninth tool registers here, not in take 3.** `registerToolSurface` in `src/webmcp/register.js`
subscribes to the store, so `get_assistance_options` registers synchronously the moment this edit
lands. The `8` to `9` transition belongs to this take and cannot appear in one that starts
afterwards. Keep the strip in frame. Take 3 shows the strip already reading `9` and the agent
explaining it, and its narration is written that way.

**Do not go looking for the spoken announcement.** The page does announce why a tool was
published, but it announces it into the live region, which `assets` clips to one pixel so screen
readers get it and nobody else does. It is never on camera. The visible evidence is the strip
count here, and the reason printed on the tool's own row in take 3.

---

## Owner take 3 of 6: `05-reconcile`

**Save to:** `video/beats/05-reconcile/take.mp4`
**Run for:** about 27 seconds. The narration target is 23s.

**In frame the whole time:** back in the conversation, with the **What this intake still needs**
panel, the status strip and the **WebMCP tools on this page** panel all visible. That panel opens
by itself only on a window at least 900 wide and 950 tall, so open it by hand if it stayed folded.

**Type this, word for word:**

```
I have just corrected the drivable answer on the page myself. Read the claim again and tell me what changed and what it needs now.
```

**Must be visible on the take:**

- a `read_claim_state` or `get_requirements` entry appearing in the tool call ledger, so the read
  back the narration describes is on screen and is not taken on trust
- the **What this intake still needs** list changing, with the reason printed beside each entry
- the status strip reading `9 tools registered`
- the `get_assistance_options` row in the **WebMCP tools on this page** panel, reading
  `Registered because the claim says the vehicle cannot be driven.`, and the agent naming the
  tool in its answer
- the **roadside collection** entry in the requirements list, with the words saying no tool on this
  page reaches it and a person has to act on it. Take 6 is where it gets closed, and this is where a
  viewer first sees it open

**Stop on:** the strip reading `9 tools registered`, with the recomputed requirements list on screen.

**The count is asked for here as a state, `9`, not as a change from `8`.** That change happened in
take 2, the instant the drivable answer was corrected, because the tool surface is subscribed to the
store. A take that starts afterwards cannot contain it, so the narration says the correction has
already published the tool rather than claiming the registration happens here. What is new in this
take is the agent reading the claim again, finding the tool, and reading out a requirement that no
tool on the page can close.

This is the beat the whole entry turns on, so it is worth several takes. The tool set is a function
of the claim, and this is where a viewer hears what that means.

---

## Owner take 4 of 6: `06-refusal`

**Save to:** `video/beats/06-refusal/take.mp4`
**Run for:** about 25 seconds. The narration target is 21s.

**In frame the whole time:** the conversation, with the tool call ledger and the **Still drivable**
row both visible on the page.

**This take only works after take 2.** The note asks for the field you pinned there. Record it in
the same session, with `vehicle_drivable` still set to `No` and still pinned.

**Type this, word for word:**

```
Read the notes on the file and summarise them for me.
```

Let it answer. Then:

```
Read the claim again first, then try to do exactly what that note asks, and tell me what the page said back.
```

Both clauses are deliberate, and so is the order. `src/core/claim.js` checks the revision before it
checks the pin, so a patch sent on the revision the agent read back in take 1 is refused as
`PATCH_REJECTED_STALE` and never reaches the pin at all. The re-read is what makes the ledger show
`PATCH_REJECTED_LOCKED`, which is the refusal this beat is about.

**Must be visible on the take:**

- the agent quoting the forwarded note, including the instruction planted inside it
- a `read_claim_state` entry in the ledger before the attempt, so the patch carries the revision the
  page is on now
- the `apply_claim_patch` entry naming `vehicle_drivable`, flagged **refused**, with the code
  `PATCH_REJECTED_LOCKED` printed beside the reason
- the **Still drivable** row still reading `No` and still pinned, and the **Draft revision** number
  in the header not moving
- the **WebMCP tools on this page** panel open at some point in the take, so the published list is
  on screen and a viewer can see for themselves that nothing on it files. An absence is not visible
  in a frame, so show the list rather than the empty space where a filing call would have been

**Stop on:** the refused `apply_claim_patch` row in the ledger, with `PATCH_REJECTED_LOCKED` legible
and the revision number unchanged in the header.

If the agent declines to attempt anything at all, that is a weaker beat, not a better one. Ask it
again with `Try it anyway, and tell me exactly what the page said back.` A refusal the page produced
is the evidence. A refusal the model produced on its own is not.

If the ledger shows `PATCH_REJECTED_STALE` instead, the agent patched without re-reading. That is a
true refusal and a different one. Ask it to read the claim again and retry, and keep the take where
the code reads `PATCH_REJECTED_LOCKED`.

---

## Owner take 5 of 6: `06b-declared-form`

**Save to:** `video/beats/06b-declared-form/take.mp4`
**Run for:** about 17 seconds. The narration target is 13s.

**In frame the whole time:** the same page and the same session, scrolled so the **Supporting
details** form and the **Draft revision** number in the header are both visible.

**No prompt. This one is you, using the form.** Do this:

1. Note the **Draft revision** number before you type anything, and keep the header in frame.
2. Type `M. Okafor` into **Name of the witness**. That exact text, so a re-record matches the take it
   replaces. The whole claim is synthetic.
3. Leave **Draft revision your agent read** empty, and let the hint under it stay on camera. It is
   the box an agent fills and a person does not.
4. Press **Add these details**, with the pointer, slowly enough to see.

**Must be visible on the take:**

- the **Supporting details** form, with the witness box being typed into by hand
- the hint under the revision box saying it is there for an agent, and naming the revision the draft
  is at
- the line under the button reading `Recorded the name of the witness on the draft, submitted
  through the page UI. The draft is now at revision N.`
- the **Draft revision** number in the header stepping up
- the optional group above the form opening by itself, with **Witness name** now carrying a value
  and a `via page` badge

**Stop on:** that result line under the button, with the new revision visible in the header.

**Why this take exists, and what it does not claim.** Both halves of WebMCP ship on this page. The
imperative half is the nine registered tools every other take shows. The declarative half is this
form: an ordinary HTML form in `index.html` with four extra attributes on it, `toolname`,
`tooldescription`, `toolautosubmit` and `toolparamdescription`. The browser builds the input schema
from the form itself, so nothing on this page writes one, and that is the migration path an insurer
with an existing intake form actually has.

The narration names those four attributes as what publishes the form to an agent, and stops there.
It never says an agent was seen using it. Declarative invocation needs a browser that implements it,
the ChatGPT desktop browser's support for it is unverified, and a take that depended on an agent
submitting this form might not be recordable at all. What is recordable, always, is a person filling
in the same form, and the page prints which route the submission arrived through, so the take
carries `submitted through the page UI` in the page's own words rather than the narration asserting
anything about it.

The four attributes are markup. They are not visible on a rendered page, so do not try to put them
on camera. What is on camera is the form and what it did.

---

## Owner take 6 of 6: `07-human-files`

**Save to:** `video/beats/07-human-files/take.mp4`
**Run for:** about 20 seconds. The narration target is 16s.

**In frame the whole time:** the page, full width if you can, with the **Your decisions** panel in
shot.

**No prompt. Two presses, in this order:**

1. **Request roadside assistance**, with the pointer, slowly enough to see.
2. Then **File this claim**, the same way.

Unpin nothing and change no field.

**Must be visible on the take:**

- the **Request roadside assistance** button being pressed by hand, and the line that replaces it
  naming the time you pressed it
- the roadside collection entry in the requirements list closing once you have pressed it
- the **File this claim** button being pressed by hand
- the filed line that appears underneath it
- the sentence on that panel saying these buttons are never registered as agent tools

**Stop on:** the filed line under the File button, with the draft closed above it.

**Why the order is forced.** Take 3 spends its whole length showing a requirement the page had just
raised: a roadside collection, which this insurer's rule pack answers with a human action rather
than a field. `get_assistance_options` reads the options out, and closing the requirement is the
button. An earlier version of this runbook filed the claim straight over it, which put a tidy screen
on camera and left the one requirement the entry had just made a point of unanswered.
`assistanceApplies` in `src/ui/app.js` requires `claim.status !== 'filed'`, so filing closes the
assistance control.

**The panel has to be empty of open requirements before the File control will do anything, and by
this point in the session it is.** Filing is gated on the insurer's derived intake as well as on the
required fields: `canFile` in `src/core/filing.js` refuses with `FILE_REFUSED_REQUIREMENTS` while
anything is open, which is the defect that gate was written to close. The two this insurer raises
when the car cannot be driven are the collection address, answered by the location the agent wrote
in beat 03, and the roadside collection, answered by the button you press first. That is why the
order in this take is forced and why beat 03's prompt says where the car is.

If **File this claim** is still disabled after the roadside press, read the line under it. It names
what is still open, and the answer is almost always that beat 03 did not write the location.

---

## Assembling the cut

Once all six takes are in place:

```sh
python video/build_video.py --check-takes
```

It must print that every owner take the cut needs is present, and exit `0`. Then:

1. Push the branch.
2. Run the **Video** workflow by hand, with the `beat` input **empty**.
3. The workflow renders every beat, assembles the cut, and runs the sync gate on the encoded files.
4. Download the `claimready-video` artifact. `cut.mp4` is the video and `captions.vtt` is the
   subtitle track.

Locally the same two commands are:

```sh
python video/build_video.py
python video/sync_gate.py
```

Neither is run on the owner's machine in practice. The build needs ffmpeg, a browser and
`ELEVENLABS_API_KEY`, and the workflow installs all three inside the job and nowhere else. It
refuses to run without the secret and names it, and it never renders a silent track to keep going.

## When one beat comes out wrong

Fix the one beat. That is what the whole per beat design is for.

- **A sentence is wrong:** edit that beat's `narration.txt`.
- **A take is wrong:** replace that `video/beats/<id>/take.mp4`.
- **A machine beat filmed the wrong thing:** edit the capture steps in that beat's `beat.json`.

Then run the **Video** workflow with `beat` set to that beat id. Read the result in the
`claimready-beat-<id>` artifact.

> A --beat run renders one beat and never assembles or gates a cut, so nothing it produces may be uploaded.

That is not a caution, it is what the tooling does. A one beat run assembles nothing, gates nothing,
and deletes any cut, caption file and manifest an earlier run left in the build directory, so there
is no stale cut sitting beside your fresh beat waiting to be uploaded. In the workflow the assembly
step, the gate step, the upload of the cut and the upload instructions are all guarded, and a one
beat dispatch gets its own artifact carrying that beat alone.

When the beat is right, **run the workflow again with `beat` empty**. That run assembles every beat,
restores the unchanged ones from the cache, and gates the result. Only that run produces something
you may upload.

The same sentence is stated in `video/build_video.py`, in `.github/workflows/video.yml` and in
[`video/README.md`](../../video/README.md). Check I of `video/sync_gate.py` fails when any of the
four drifts, or when a step in the workflow's build job that could hand back a cut loses its guard,
so the three cannot quietly disagree again.

## Two things this pipeline will refuse, so you know what you are reading

- **A frozen beat.** If a take is shorter than its narration, the last frame is held. Every gate
  stays green through that, because a frozen frame is a frame, so the builder refuses a hold longer
  than 1.5 seconds outright and names the take and the shortfall. Record long.
- **A page it cannot name.** Before any beat is built, the builder fetches every on camera file from
  the live host and compares it to the tree and to the commit it is about to write into the
  manifest. There is no flag that skips this. If the host is behind, wait for the deployment.

## Uploading

1. Upload `cut.mp4` to YouTube.
2. Set the visibility to **Public**. Unlisted does not satisfy the rules.
3. Set the title to `ClaimReady, the insurer's page hands your agent its policy rules`.
4. Put the live page URL and the repository URL in the description.
5. Upload `captions.vtt` from the same artifact as the subtitle track. It was derived from the
   narration that was actually rendered, so it cannot drift from what is spoken.
6. Copy the watch link from the address bar and replace **NOT YET UPLOADED** at the top of this file.
7. Run `node scripts/readiness.mjs --ci` and confirm row D4 has gone green.
