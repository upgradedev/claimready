# The video pipeline

The demo video is built one beat at a time. A beat is a directory. It holds the narration that is
spoken over it and the specification of what is on screen, and it is the unit that gets rebuilt.

That is the whole design decision. Fixing one sentence costs one beat. Re recording one take costs
one beat. The cut is a concatenation and is never the reason anything is re rendered. A pipeline
that can only rebuild the whole film is a pipeline that makes "leave the video to the end" the
rational choice, and then the video does not get made.

```
video/
  build_video.py        renders and assembles
  sync_gate.py          reads the finished files and refuses the bad ones
  beats/
    01-problem/         beat.json, narration.txt
    02-publishes/       beat.json, narration.txt
    03-agent-fills/     beat.json, narration.txt, take.mp4   (recorded by the owner)
    ...
```

Everything the build writes goes to `tmp/video`, which the repository already ignores. Nothing
generated is ever committed. The inputs are committed: the narration, the beat specifications, and
the owner's takes.

## Two kinds of beat

**Machine beats** are captured here by Playwright driving the real deployed page at
`CLAIMREADY_URL`. They are reproducible and they assert what has to be on screen. If the page stops
registering its eight tools, `02-publishes` fails the build rather than being filmed in that state.
The number spoken in the narration of that beat is therefore a measured number, not a claim: the
capture step `expect_tool_count` fails if the page registers anything other than eight.

**Owner beats** are an mp4 the owner records of their own screen while their own agent drives the
page. That is the money shot for this entry, and it cannot run in CI: the ChatGPT desktop built in
browser needs a real machine and a real account. So the pipeline takes the file, matches it to the
narration, and refuses to build at all when one is missing, naming the exact path and what to
record. It never quietly produces a shorter cut.

To the composer they are the same thing. Both are trimmed or held to their narration, encoded
identically, and concatenated.

The recording instructions for every owner beat are in
[`docs/submission/video.md`](../docs/submission/video.md), which is also the deliverable record.
`build_video.py` refuses to run if an owner beat is not named in that file, so a beat cannot be
added without somebody being told how to record it.

## Disclosure: the WebMCP host in the machine beats

A headless browser has no agent in it, so the capture script installs one thing before the page
loads: an object at `document.modelContext` with `registerTool` on it, backed by an `EventTarget`
and honouring the `AbortSignal` each registration is given.

Nothing about the page is stubbed. Every tool in those frames is the page's own tool, registered by
the page's own code, and every tool call in the ledger really ran. The host is the same surface an
agent browser provides, and it is written out in full in `CAPTURE_JS` inside `build_video.py` so a
reader can check that claim rather than take it.

The owner beats need no such thing. They are a real agent in a real browser, which is exactly why
they cannot be captured here.

## Audio locked, to the frame

The narration is rendered first and its duration is measured from the encoded file. The picture is
then cut to `ceil(audio * 30) / 30` seconds, so the video is at most one frame longer than the audio
and never shorter. That is arithmetic, not a tolerance, which is why the measured drift across all
eight beats is zero.

The picture follows the voice. The voice is never stretched to fit a picture.

A take shorter than its narration is held on its last frame rather than desynchronised, and every
gate stays green through that, because a frozen frame is a frame. That is the one remaining way this
pipeline could hand back a quietly defective cut, so a hold beyond 1.5 seconds is a hard build
failure naming the take and the shortfall. Under 1.5 seconds it is normal: the last word of a
sentence usually outlives the last thing that moves on screen.

Captions are derived from the narration that was actually rendered, and time is shared out across
the cues by character count. There is no second caption file to drift away from the script.

## Running it

```sh
# what would be built, and which owner takes are still missing. Spends nothing.
python video/build_video.py --plan

# just the missing takes, with the recording instructions for each
python video/build_video.py --check-takes

# the whole cut
python video/build_video.py

# one beat, after fixing one sentence or replacing one take
python video/build_video.py --beat 05-reconcile

# gate the result, reading the encoded files rather than the plan
python video/sync_gate.py
```

`build_video.py` needs `ffmpeg`, `ffprobe`, `node` with playwright for the machine beats, and
`ELEVENLABS_API_KEY` for the narration. Install none of that on a work machine. Push the branch and
run the **Video** workflow, which installs ffmpeg and a browser inside the job and nowhere else.

Without the secret the build stops and names it. There is no silent fallback, because a voiceless
cut looks finished and is not.

## The cap, and why it lives in two files

`MAX_TOTAL_SECONDS` in `sync_gate.py` is 170 seconds. `VIDEO_MAX_TOTAL_SECONDS` in
`.github/workflows/video.yml` is 170 seconds. Check A of the gate reads the workflow and fails when
the two disagree, so moving the cap in one place is a failure rather than a change. The rules say
the video must be less than three minutes, and 170 leaves ten seconds of margin against a player
that rounds up.

## What the gate asserts

Every one of these reads a file that is about to be uploaded. None of them reads the manifest and
believes it.

| | Check | Refuses |
| --- | --- | --- |
| A | cap agreement | the cap moved in one file and not the other |
| B | manifest | a beat named in the manifest that is not on disk |
| C | audio video sync | a beat whose audio and video differ by more than one frame |
| D | beat captions | a cue outside its own beat, or two cues on screen at once |
| E | cut captions | a cue that landed in the wrong beat once assembled |
| F | beats make the cut | a cut that is not the beats that were gated |
| G | total under cap | a cut at or over 170 seconds |
| H | audible | a beat below the silence floor, which is what a lost narration looks like |

## Proof that the gate fails

A gate nobody has watched fail is a decoration.

### Every check, on every run

`python video/sync_gate.py --selftest` breaks the build on purpose once per check and asserts that
the matching check, and not some other one, is the thing that fires. It then gates an unbroken tree
and asserts it passes, because a gate that refuses everything is as useless as one that refuses
nothing. It builds real encoded media with ffmpeg, needs no secret, no network and no deployed page,
and it is the step that runs on every push.

Run on 2026-08-27, all eight checks fired and the good tree passed:

```
  ok   A  the cap moved in one file only
  ok   B  a beat named in the manifest is missing
  ok   C  audio longer than the picture
  ok   D  a cue that outlives its beat
  ok   E  overlapping cues in the cut
  ok   F  the cut does not match its beats
  ok   G  a cut longer than the cap
  ok   H  a beat with no voice on it

  ok   --  the unbroken fixture passes

sync gate self test: PASS. Every check above was seen to fail, and the good tree passed.
```

### One beat, broken by hand, once

Done on 2026-08-27 against a real build tree, not a mock. `$TMP` below is a scratch directory
outside the repository.

Build a passing tree and gate it:

```sh
python video/sync_gate.py --make-fixture "$TMP/gatedemo"
python video/sync_gate.py --root "$TMP/gatedemo"
```

```
sync gate: PASS. cut.mp4 read from disk, not from the plan.

  A  cap agreement      sync_gate.py and the workflow both say 170s
  B  manifest           3 beats, every named file present
  C  audio video sync   worst drift 0.0 ms on 01-fixture, budget 33.3 ms
  D  beat captions      6 cues, all inside their beat, none overlapping
  H  audible            quietest beat 01-fixture at -24.1 dB, floor -50.0 dB
  E  cut captions       6 cues, each inside the beat it belongs to
  F  beats make the cut cut 9.500s against 9.500s of beats
  G  total under cap    9.500s of 170s, 160.500s spare

  beat                    video    audio     drift    volume  cues
  01-fixture             3.000s   3.000s     0.0ms    -24.1dB     2
  02-fixture             2.500s   2.500s     0.0ms    -24.1dB     2
  03-fixture             4.000s   4.000s     0.0ms    -24.1dB     2
```

Now break one beat, by giving `02-fixture` a 3.6 second audio track over its 2.5 second picture,
which is exactly the failure the whole pipeline exists to prevent:

```sh
B="$TMP/gatedemo/beats/02-fixture/beat.mp4"
cp "$B" "$B.good"
ffmpeg -y -i "$B.good" -f lavfi -i "sine=frequency=320:r=48000" -t 3.6 \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -ar 48000 -ac 2 -b:a 96k "$TMP/broken.mp4"
mv "$TMP/broken.mp4" "$B"
python video/sync_gate.py --root "$TMP/gatedemo"
```

Verbatim:

```
sync gate: FAIL. [C] beat 02-fixture is out of sync by 1100.0 ms. video 2.500s, audio 3.600s, and one frame at 30 fps is 33.3 ms. The picture must be trimmed or held to the narration, never the other way round.

Nothing here is negotiable. Fix the build, do not move the threshold.
```

Exit status `1`. Restore the beat and the gate goes green again:

```sh
mv "$B.good" "$B"
python video/sync_gate.py --root "$TMP/gatedemo"
```

```
sync gate: PASS. cut.mp4 read from disk, not from the plan.
...
  C  audio video sync   worst drift 0.0 ms on 01-fixture, budget 33.3 ms
```

Exit status `0`. Nothing in the gate was changed to make either run come out the way it did.

## Measured narration lengths

Before asking anybody to record anything, the render path was run end to end on the real narration
with stand in colour cards for the pictures, in a scratch directory outside the repository. An
instrument that has never completed on spent data has no business consuming a take somebody sat down
to record.

Measured 2026-08-27. Every number below came back from `ffprobe` through `video/sync_gate.py`, run
against the encoded beat files. The narration is the eight `narration.txt` files as they stand.

| Beat | Target in `beat.json` | Narration, measured | Drift |
| --- | --- | --- | --- |
| `01-problem` | 14s | 11.90s | 0.0 ms |
| `02-publishes` | 15s | 15.00s | 0.0 ms |
| `03-agent-fills` | 29s | 26.10s | 0.0 ms |
| `04-human-corrects` | 25s | 23.80s | 0.0 ms |
| `05-reconcile` | 21s | 21.00s | 0.0 ms |
| `06-refusal` | 13s | 12.20s | 0.0 ms |
| `07-human-files` | 12s | 11.60s | 0.0 ms |
| `08-close` | 16s | 14.20s | 0.0 ms |
| **cut** | **145s** | **135.80s** | 34.20s under the cap |

Two things follow from that table. The cut lands at 2 minutes 16 seconds, inside the three minute
rule with room. And the targets in `beat.json` are all a little longer than the narration on purpose,
because a take that runs long is trimmed and a take that runs short is held on its last frame, which
reads on screen as a freeze. Record long.

The measurement used stand in pictures, so it says nothing about what the beats look like. It says
that the render path completes, that the sync arithmetic holds on real speech rather than on a test
tone, and that the finished length fits.

**That table is one render, not a constant.** Rendering the same `narration.txt` twice does not
return the same duration: `07-human-files` came back at 11.60s in the run above and at 10.70s when
it was rendered again later the same day, a difference of about eight percent. So treat every figure
as a sample. The 34 seconds of headroom under the cap absorbs that variation many times over, which
is the reason to keep the headroom rather than fill it. The beat cache means a beat that has already
been rendered keeps the audio it was rendered with, so a cut does not change length underneath you
between runs.

## What has and has not been run

Honest state, so nobody trusts a limb that has never moved.

| Part | Evidence |
| --- | --- |
| narration, encode, fit, mux, captions, concat, gate | run end to end on real narration for all eight beats, 2026-08-27 |
| the trim branch of `fit_picture` | run, every beat in that dry run |
| the freeze branch, `tpad=stop_mode=clone` | run against a deliberately short card, 0.0 ms drift |
| the freeze guard past 1.5s | run through the real build path, refused with the take path named |
| all eight gate checks | each seen to fail, and the good tree seen to pass |
| `CAPTURE_JS` | syntax checked with `node --check` against the emitted file. Not executed |
| `capture_machine_beat`, Playwright | **not run.** It first runs in CI, where the browser exists |

The capture limb is the one thing here that has never executed, because it needs a browser this
machine is not allowed to install. Its first real run is the workflow. The failure it is most likely
to produce is a selector or a wait that no longer matches the deployed page, and it is written to
fail loudly and say what it read instead.

`CAPTURE_JS` fails the capture on any page error or any `console.error` from the live page. That is
deliberate rather than inherited: the deployed page was opened on 2026-08-27 and its console was
empty, so an error appearing during a capture is a regression worth stopping for, not noise to film
through.
