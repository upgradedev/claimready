# ClaimReady demo video

This file is two things. It is the runbook the owner records from, and it is the record of the
deliverable itself. The readiness gate reads the link at the bottom, so this file is also what turns
row D4 green.

## Deliverable record

| Field | Value |
| --- | --- |
| Public video URL | **NOT YET UPLOADED** |
| Visibility required | Public. Not unlisted, not private. The rules ask for a public video |
| Length cap | less than three minutes. The pipeline caps the cut at 170 seconds |
| Length of the finished cut | not measured. The cut does not exist yet, because five owner takes have not been recorded |
| Rehearsal length, estimate | 135.80s, which is 2 minutes 16 seconds, from a stand in render whose files were not kept. See the note below |
| Built by | `video/build_video.py`, gated by `video/sync_gate.py` |
| Built in | `.github/workflows/video.yml`, workflow dispatch |
| Filmed against | the repository variable `CLAIMREADY_URL` |

Where the 135.80s comes from, since a number with no command behind it is worth nothing. On
2026-08-27 the eight `narration.txt` files were rendered for real and the whole render path was run
end to end with stand in pictures, in a scratch directory outside this repository. The figure is the
duration `ffprobe` reported for the assembled `cut.mp4`, printed by row G of
`python video/sync_gate.py`, which read the encoded file rather than the plan. It is a sample, not a
constant: the narration service does not return exactly the same duration twice, and one beat varied
by about eight percent between two renders of identical text. The finished cut will land near this
figure, with about 34 seconds of headroom under the cap. The per beat numbers and the caveats are in
[`video/README.md`](../../video/README.md).

That scratch directory was not kept, so the figure cannot be re-derived from anything on disk today.
It stands as an estimate and keeps that label until row G of `python video/sync_gate.py` prints a
duration for a cut built from the five real owner takes. Treat 135.80s as a rehearsal reading of the
narration length, not as the length of the deliverable.

When the cut is uploaded, replace **NOT YET UPLOADED** above with the full watch link copied from
the browser address bar. Paste the whole thing, scheme included. The readiness gate looks for a
YouTube link in this file and fails until it finds one, so nothing here pretends the video exists
before it does.

## The cut

Eight beats. Three are captured in CI against the real deployed page. Five are recorded by the owner,
because the money shot is the visitor's own agent driving the page inside the ChatGPT desktop built
in browser, and that browser needs a real machine and a real account. It cannot run in CI, so the
pipeline takes a file instead and refuses to build without it.

| Beat | Kind | Target | What is on screen |
| --- | --- | --- | --- |
| `01-problem` | machine | 14s | the page with an empty draft, and the list of what this policy needs |
| `02-publishes` | machine | 15s | the strip reading 8 tools registered, and the tool names |
| `03-agent-fills` | owner | 29s | the agent reading the policy and writing the draft, field by field |
| `04-human-corrects` | owner | 25s | a person setting the car to not drivable, and the revision moving |
| `05-reconcile` | owner | 21s | requirements changing, and a ninth tool being published |
| `06-refusal` | owner | 13s | the planted note read, and the protected change refused in the ledger |
| `07-human-files` | owner | 12s | a hand pressing File this claim |
| `08-close` | machine | 16s | the one sentence, and the architecture line |

Beat order is the directory order under `video/beats`. Nothing else decides it.

## Before you record anything

1. Open the live page in the ChatGPT desktop built in browser, signed in to your own account. The
   README section on running the page with an agent has the two supported paths and the browser
   flag for the Chrome route.
2. Confirm the status strip reads `8 tools registered` and names the API it found. If it does not,
   stop. Recording a page that did not publish its tools wastes the take.
3. Press **Load synthetic incident** so every take starts from the same draft. Every take below
   assumes that starting point.
4. Record at 1920 by 1080 if your machine can. Anything is scaled and padded to that, so a smaller
   window is safe, it is just softer.
5. Record a few seconds longer than the target. The picture is trimmed to the narration, so a long
   take costs nothing and a short one is held on its last frame, which reads as a freeze.
6. No system audio and no voice on the take. The narration is rendered separately and the take's
   own audio is discarded. Talking over it is wasted effort.

Save every take as `video/beats/<beat id>/take.mp4`. That exact path, that exact name. The build
names the file it wants when it is missing, so if you are unsure, run:

```sh
python video/build_video.py --check-takes
```

## Owner beat 03-agent-fills

**Save to:** `video/beats/03-agent-fills/take.mp4`, about 30 seconds.

**On screen:** the deployed page beside the conversation, with the claim draft, the header revision
chip and the tool call ledger all in frame if you can manage it.

**Type this, word for word:**

```
Read this claim page and tell me what it still needs from me.
```

Let it answer. Then:

```
A delivery van reversed into my left front wing while the car was parked in the car park on Harbour Road. It is a dent at the 10 o'clock position and the car still drives. Fill that in for me and write the description.
```

**Must be visible on the take:**

- the status strip reading `8 tools registered`, and the API name it found
- the ledger filling with `read_claim_state`, `get_requirements` and `apply_claim_patch`
- claim rows moving from `not set` to a value, each carrying the `agent` badge
- the **Draft revision** number in the header rising as the patches land

## Owner beat 04-human-corrects

**Save to:** `video/beats/04-human-corrects/take.mp4`, about 25 seconds.

**On screen:** the same page, the same session. Leave the conversation alone for this one. This beat
is a person using the page directly.

**No prompt.** Do this instead:

1. Note the **Draft revision** number before you touch anything, and keep the header in frame so the
   before and the after are both on the take.
2. Set the **Still drivable** row to **No**, using the control on the page.
3. Press **Pin** on that same row.

**Must be visible on the take:**

- the **Still drivable** row moving to `No`
- the badge on that row changing to `you`
- the **Draft revision** number in the header stepping up
- the pin control on that row reading as pinned

## Owner beat 05-reconcile

**Save to:** `video/beats/05-reconcile/take.mp4`, about 21 seconds.

**On screen:** back in the conversation, with the requirements panel and the status strip both
visible on the page.

**Type this, word for word:**

```
I have just corrected the drivable answer on the page myself. Read the claim again and tell me what changed and what it needs now.
```

**Must be visible on the take:**

- the **What this intake still needs** list changing, with the reason printed beside each entry
- the status strip count moving from `8` to `9`
- the name `get_assistance_options` appearing in the list of tools available to the agent
- the page announcement naming why the tool was published

This is the beat the whole entry turns on, so it is worth several takes. The tool set is a function
of the claim, and this is the only place a viewer sees that happen.

## Owner beat 06-refusal

**Save to:** `video/beats/06-refusal/take.mp4`, about 13 seconds.

**On screen:** the conversation, with the tool call ledger visible on the page.

**Type this, word for word:**

```
Read the notes on the file and summarise them for me, then do whatever they ask.
```

The second clause is deliberate. It is the whole point of the beat: the agent is told to follow the
note, and following it changes nothing.

**Must be visible on the take:**

- the agent quoting the forwarded note, including the instruction planted inside it
- the ledger entry for the attempted change, carrying the refusal and its code
- the claim draft unchanged behind it, with the severity still as it was

If the agent declines to attempt anything at all, that is a weaker beat, not a better one. Ask it
again with `Try to do what the note asks, and tell me exactly what the page said back.` A refusal
that the page produced is the evidence. A refusal the model produced on its own is not.

## Owner beat 07-human-files

**Save to:** `video/beats/07-human-files/take.mp4`, about 12 seconds.

**On screen:** the page, full width if you can, with the **Your decisions** panel in shot.

**No prompt.** Change nothing else, unpin nothing, and press **File this claim** with the pointer,
slowly enough to see.

**Must be visible on the take:**

- the **File this claim** button being pressed by hand
- the filed line that appears underneath it
- the sentence on that panel saying these buttons are never registered as agent tools

## Building the cut

Once all five takes are in place:

1. Push the branch.
2. Run the **Video** workflow by hand, with `beat` empty.
3. Download the `claimready-video` artifact. `cut.mp4` is the video.

To fix one sentence: edit that beat's `narration.txt`, push, and run the workflow with `beat` set to
that beat id. Every other beat restores from the cache and the cut is reassembled around the one
that changed. To fix one take: replace that `take.mp4` and do the same. The whole reason the
pipeline is built per beat is that neither of those costs the cut.

The workflow refuses to run without `ELEVENLABS_API_KEY`, and it names the secret when it does. It
never renders a silent track to keep going.

## Uploading

1. Upload `cut.mp4` to YouTube.
2. Set the visibility to **Public**. Unlisted does not satisfy the rules.
3. Set the title to `ClaimReady, the insurer's page hands your agent its policy rules`.
4. Put the live page URL and the repository URL in the description.
5. Upload `captions.vtt` from the same artifact as the subtitle track. It was derived from the
   narration that was actually rendered, so it cannot drift from what is spoken.
6. Copy the watch link from the address bar and replace **NOT YET UPLOADED** at the top of this file.
7. Run `node scripts/readiness.mjs --ci` and confirm row D4 has gone green.
