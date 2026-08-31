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
    06b-declared-form/  beat.json, narration.txt, take.mp4   (recorded by the owner)
    ...
```

Beat order is directory order, sorted. That is why the declarative beat is called
`06b-declared-form`: it has to sit between `06-refusal` and `07-human-files`, because
`renderDeclaredForm` in `src/ui/render.js` disables every control on that form once the claim is
filed, so after `07` there is nothing left to record.

Everything the build writes goes to `tmp/video`, which the repository already ignores. Nothing
generated is ever committed. The inputs are committed: the narration, the beat specifications, and
the owner's takes.

## Two kinds of beat

**Machine beats** are captured here by Playwright driving the real deployed page at
`CLAIMREADY_URL`. They are reproducible and they assert what has to be on screen. If the page stops
registering its tools, `02-publishes` fails the build rather than being filmed in that state. The
number spoken in the narration of that beat is therefore a measured number, not a claim: the capture
step `expect_tool_count` fails if the page registers anything other than eight.

**Two counts, and they are not the same count.** The status strip counts what the browser accepted
right now, which is eight on a freshly loaded draft. The tools panel counts what the page publishes,
which is ten: nine that register through `registerTool`, of which `get_assistance_options` only
registers once the claim says the car cannot be driven, plus one declared by four attributes on a
form in `index.html` that nothing registers at all. `01-problem` asserts the ten on the panel with
no agent in the browser, and `02-publishes` asserts the eight on the strip and the panel reading
`8 of 9 tools registered with your agent`, so both numbers are read off the deployed page rather
than asserted here. `05-reconcile` is where a viewer sees the ninth register.

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

## A machine beat is a photograph, so the cache key is what it photographed

A machine beat's picture is the deployed page. Its real inputs are therefore the narration, the beat
specification, **and what the host is serving**. Until 2026-08-27 the last of those was hashed as the
URL string alone, which says nothing about what the URL returns, so once a beat was filmed it was a
cache hit for ever no matter what the page did next.

That is not a hypothetical. The only machine footage on record was filmed at `cfc5c0c`. The commit
after it put a tools panel on `index.html`, inside the frame that `01`, `02` and `08` scan, and
nothing in the pipeline noticed, because neither the beat hash nor the workflow cache key had ever
heard of `index.html`.

Two changes, and they have to stay in step with each other:

- `CAMERA_PATHS` in `build_video.py` is `index.html`, `src` and `assets`. Every file under them is
  hashed, line endings folded to LF so the digest means the same thing here and on a runner, and
  that digest goes into every machine beat's hash along with the URL and the deployed commit. Change
  one character of `index.html` and all three machine beats are rebuilt.
- The `hashFiles(...)` key in `.github/workflows/video.yml` names the same three paths. A key that
  covers less than the hash covers means CI restores footage the builder would have rebuilt. There
  is deliberately no `restore-keys` fallback: a bare `video-build-` prefix matches the newest cache
  under any earlier key, which is exactly how old footage gets adopted by a build that changed the
  page. An exact hit or nothing.

Re rendering costs a run. Shipping the wrong page costs the entry.

## The build refuses to film a page it cannot name

Before any beat is built, and before a cent is spent on narration, `verify_deployed` fetches every
one of those camera files from the live host and runs two comparisons, chained rather than side by
side so a failure names one cause:

| | Compared | A failure means |
| --- | --- | --- |
| 1 | the bytes the host served against the bytes on disk | the deployed page is not the tree this build is hashing, so filming would produce a beat that shows one page while the manifest, the narration and the cache key describe another |
| 2 | the bytes on disk against `git show <sha>:<path>` | the tree is not the commit the manifest is about to claim, and since the host cannot be serving an uncommitted edit, the SHA would be a statement about different bytes than the ones that were hashed |

Transitively, the deployed page is that commit. A non 200 on any camera file fails as well: a file
that will not fetch is not a file that was checked.

The commit comes from `--deployed-sha`, then `CLAIMREADY_DEPLOYED_SHA`, then `GITHUB_SHA`, then the
checkout's `HEAD`. Naming one by hand loosens nothing, because the tree still has to match it. It is
written into `manifest.json` as `deployed_sha`, printed beside the cut, and printed by `--plan` as
what it is at that point: a claim nobody has checked yet, since the plan touches no network.

There is no flag that skips this. If the host is behind, wait for the deployment or build from the
commit the host is serving.

## The WebMCP surface in the machine beats is the browser's own

This section used to disclose a host of ours. It no longer needs to. The capture launches the
installed **Chrome Dev channel** with `--enable-features=WebMCP` and films the page registering
against the API that browser provides, so nothing of ours stands in for the agent surface. The
capture prints which name it found, `document.modelContext` or `navigator.modelContext`, and
refuses to film a browser that has neither rather than filming a page that says no agent is
present.

What that buys is not tidiness. The browser is the half that turns the declarative form into a
tool, so a beat filmed this way shows a surface holding **nine** tools, the eight this page
registers plus `record_supporting_details`, which it never registers. Beat 02 asserts exactly that,
by count and by name.

The fallback host is still in `CAPTURE_JS` and is **off**. `CLAIMREADY_ALLOW_SHIM=1` turns it on
for a machine with no WebMCP capable Chrome, and it prints a warning when it does. It cannot
synthesise a tool from HTML attributes, so beat 02's assertion fails under it. That failure is the
design: a shim run would film a page that differs from the one a judge opens, and it should stop
rather than pass.

`CLAIMREADY_CHROME_CHANNEL` picks the channel. The default is `chrome-dev`, which is what CI
installs and what the eval harness drives. Chrome stable 151 carries WebMCP as well, observed on
2026-08-31, so a desktop run can set `chrome`.

The owner beats are a real agent in a real browser, which is exactly why they cannot be captured
here.

## Audio locked, to the frame

The narration is rendered first and its duration is measured from the encoded file. The picture is
then cut to `ceil(audio * 30) / 30` seconds, so the video is at most one frame longer than the audio
and never shorter. That is arithmetic, not a tolerance, which is why the measured drift across
every beat that has been rendered is zero.

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

# one beat, after fixing one sentence or replacing one take. It renders that beat and stops:
# see the one beat contract below
python video/build_video.py --beat 05-reconcile

# gate the result, reading the encoded files rather than the plan
python video/sync_gate.py
```

`build_video.py` needs `ffmpeg`, `ffprobe`, `node` with playwright for the machine beats, and
`ELEVENLABS_API_KEY` for the narration. Install none of that on a work machine. Push the branch and
run the **Video** workflow, which installs ffmpeg and a browser inside the job and nowhere else.

Without the secret the build stops and names it. There is no silent fallback, because a voiceless
cut looks finished and is not.

## The one beat contract

Three files used to say three different things about `--beat`, and the disagreement was not
academic. The builder rendered one beat and assembled nothing. The workflow rendered one beat,
skipped the assembly and skipped the gate, and then ran an upload step and a "what happens next"
step that were not guarded at all, so a one beat dispatch either failed on `if-no-files-found` or
handed back whatever `cut.mp4` the cache had restored from an earlier run, beside a freshly rendered
beat, with no gate having read that pair. This file said the cut was reassembled around the beat
that changed, which it never was.

One sentence now, stated in four places:

> A --beat run renders one beat and never assembles or gates a cut, so nothing it produces may be uploaded.

It lives once, as `ONE_BEAT_CONTRACT` in `sync_gate.py`. `build_video.py` imports it and prints it.
`.github/workflows/video.yml` and [`docs/submission/video.md`](../docs/submission/video.md) carry it
word for word.

The safe behaviour is the one that ships, in three parts:

- A one beat run **deletes** any `cut.mp4`, `captions.vtt`, `manifest.json` and `concat.txt` left in
  the build directory by an earlier run, and says which files it removed. The per beat cache is left
  alone, so the next full build still restores every beat it can.
- In the workflow, the assembly step, the sync gate step, the upload of the cut and the upload
  instructions are all guarded on `if: inputs.beat == ''`. A one beat dispatch gets its own
  artifact, `claimready-beat-<id>`, carrying that beat and its captions and nothing else, plus a
  step that says what it is not.
- Check I of the sync gate asserts all of that: the sentence in every file that has to state it,
  `ONE_BEAT_CONTRACT` named in the builder, and a guard on every step of the build job that could
  hand back a cut. It reads no media, so it runs on every push inside `--selftest`, and it runs
  first on a real gate so a broken contract is refused before `ffprobe` is asked anything.

To ship, run the build with `beat` empty. That assembles every beat, restores the unchanged ones
from the cache, and gates the result.

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
| I | one beat contract | the builder, the workflow, this file and the runbook disagreeing about `--beat`, or a workflow step that could ship a cut losing its beat guard |

## Proof that the gate fails

A gate nobody has watched fail is a decoration.

### Every check, on every run

`python video/sync_gate.py --selftest` breaks the build on purpose once per check and asserts that
the matching check, and not some other one, is the thing that fires. It then gates an unbroken tree
and asserts it passes, because a gate that refuses everything is as useless as one that refuses
nothing. It builds real encoded media with ffmpeg, needs no secret, no network and no deployed page,
and it is the step that runs on every push.

Re-run on 2026-08-31, after check I was added. Every check fired and both good trees passed:

```
  ok   A  the cap moved in one file only
  ok   B  a beat named in the manifest is missing
  ok   C  audio longer than the picture
  ok   D  a cue that outlives its beat
  ok   E  overlapping cues in the cut
  ok   F  the cut does not match its beats
  ok   G  a cut longer than the cap
  ok   H  a beat with no voice on it
  ok   I  a workflow step that could ship a cut with no beat guard
  ok   I  the owner runbook not stating the contract
  ok   I  the builder not carrying the one contract sentence
  ok   I  the unbroken contract fixture passes
  ok   I  this repository states the contract in 3 files and the builder, and guards 4 shipping step(s)

  ok   --  the unbroken fixture passes

sync gate self test: PASS. Every check above was seen to fail, and the good tree passed.
```

Check I found a real defect in its own first run, which is the only reason to trust it at all. Its
first version looked for `sync_gate.py` and `build_video.py` anywhere in a workflow step, and it
flagged the cache step, whose key hashes both of those files **by name**. Naming a file is not
running it. `step_ships_a_cut` now requires the interpreter on the same line as the script, and the
selftest run above is the one taken after that fix.

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
against the encoded beat files.

**Every row below is now historical, and one beat is missing from the table entirely.** On
2026-08-31 the narration was rewritten again in `01`, `02`, `04`, `05` and `07`, the targets moved
in `01`, `02`, `04`, `06` and `08`, and a ninth beat, `06b-declared-form`, was added and has never
been rendered. So the cut row below is not this cut, and no replacement figure is invented. The
targets now add to 166s against the 170s cap, which
`python video/build_video.py --plan` prints on its first line.

The paragraph that follows was written on 2026-08-28 and is kept because the reasoning still holds.

**Five of these rows were superseded then, and more are now.** The narration was rewritten on 2026-08-27, after the render,
to take a false sentence out of `04` and to rewrite `06` around the refusal the page now actually
produces. It was rewritten again on 2026-08-28, in `05`, `06` and `07`, after a review found that
`07` filed the claim over an insurer requirement `05` had just spent its whole length showing as
open, and that `06` ended on a claim about what an agent can do rather than about what the tool
surface publishes. Nothing has been rendered since, so the affected rows are marked rather than
adjusted, and no replacement number is invented. Word counts are the one thing that can be stated
without rendering, and `python video/build_video.py --plan` prints them.

Every column below is historical except the last two. The target column is the target as it stood on
the day of the render, not necessarily what `beat.json` says now: `06-refusal` has moved from 13s to
22s and then to 23s, `05-reconcile` from 21s to 23s and `07-human-files` from 12s to 16s, because
each of those beats now has more to say. The current numbers are the ones
`python video/build_video.py --plan` prints.

| Beat | Target on the day | Narration, measured | Drift | Target now | Still the narration that was measured |
| --- | --- | --- | --- | --- | --- |
| `01-problem` | 14s | 11.90s | 0.0 ms | 14s | yes |
| `02-publishes` | 15s | 15.00s | 0.0 ms | 15s | yes |
| `03-agent-fills` | 29s | 26.10s | 0.0 ms | 29s | no, one word changed, 75 words either way |
| `04-human-corrects` | 25s | 23.80s | 0.0 ms | 25s | no, 67 words then, 69 now |
| `05-reconcile` | 21s | 21.00s | 0.0 ms | 23s | no, rewritten, 55 words then, 60 now |
| `06-refusal` | 13s | 12.20s | 0.0 ms | 23s | no, rewritten twice, 34 words then, 52 now |
| `07-human-files` | 12s | 11.60s | 0.0 ms | 16s | no, rewritten, 37 words then, 40 now |
| `08-close` | 16s | 14.20s | 0.0 ms | 16s | yes |
| **cut** | **145s** | **135.80s** | | **166s over nine beats** | six of the nine changed and one did not exist, so 135.80s is not this cut |

Two things still follow. The targets in `beat.json` are all a little longer than the narration on
purpose, because a take that runs long is trimmed and a take that runs short is held on its last
frame, which reads on screen as a freeze. Record long. And at 166s of targets against a 170s cap,
the cut has room even if every beat renders at its full target, which none of them does. The margin
is 4s of targets rather than 9s, which is still comfortable because the finished length is the
narration and the narration has always come in under its target by five to ten percent. It is not
comfortable enough to spend again without re-reading this paragraph.

Where the 5s that `06b-declared-form` needed came from, since the cap does not move: 2s off
`01-problem`, which is atmosphere over the draft as the page boots it, three rows answered and seven
reading `not set`, and was the beat doing the least work, 3s off
`04-human-corrects` because a false clause came out of its narration, and 2s off `06-refusal` and
1s off `08-close`, both of which had targets well above what their word counts imply. `02-publishes`
kept its 15s while its narration got shorter. The cap in `sync_gate.py` and in the workflow is
untouched at 170s.

The measurement used stand in pictures, so it said nothing about what the beats look like. It said
that the render path completes, that the sync arithmetic holds on real speech rather than on a test
tone, and that the finished length fitted the narration of the day.

**That table is one render, not a constant.** Rendering the same `narration.txt` twice does not
return the same duration: `07-human-files` came back at 11.60s in the run above and at 10.70s when
it was rendered again later the same day, a difference of about eight percent. So treat every figure
as a sample. The headroom under the cap, which is the gap between the finished narration and 170s
rather than the 4s gap between the targets and 170s, absorbs that variation many times over, and
that is the reason to keep it rather than fill it. The beat cache means a beat that has already
been rendered keeps the audio it was rendered with, so a cut does not change length underneath you
between runs.

## What has and has not been run

Honest state, so nobody trusts a limb that has never moved.

| Part | Evidence |
| --- | --- |
| narration, encode, fit, mux, captions, concat, gate | run end to end on real narration for the eight beats that existed on 2026-08-27. Six of the nine beats have been rewritten since, and `06b-declared-form` has never been rendered at all |
| the trim branch of `fit_picture` | run, every beat in that dry run |
| the freeze branch, `tpad=stop_mode=clone` | run against a deliberately short card, 0.0 ms drift |
| the freeze guard past 1.5s | run through the real build path, refused with the take path named |
| all nine gate checks | each seen to fail, and the good tree seen to pass, 2026-08-31 |
| check I, the one beat contract | run against this repository and against four fixture repositories: three broken one way each and refused, one whole and passed |
| the camera digest in `beat_hash` | run, 2026-08-27. `index.html` was edited in place, the three machine beats were hashed before and after, all three moved, and the same beats hashed with the old function did not move. The file was put back byte for byte |
| `verify_deployed` | run, 2026-08-27, against a stand in host on the filesystem. Seen to pass when the host, the tree and the named commit agree, and seen to refuse on each of: no commit named, the tree not being the named commit, the host serving one camera file as it was at `cfc5c0c`, and a camera file the host would not serve |
| `verify_deployed` against the real host | **run, 2026-08-31**, against `https://upgradedev.github.io/claimready/` from this machine, through the new `--verify-deployed` flag, which films nothing and spends nothing. All 22 camera sources fetched, `the deployed page is 1ee157d, on every one of those files`, exit 0. Refused three ways in the same session: a commit the tree is not, which named `assets/styles.css`; no URL given; and a URL whose files answer 404 |
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
