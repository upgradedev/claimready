#!/usr/bin/env python3
"""
ClaimReady demo video builder.

The unit of work is a beat, not the cut. Every beat directory under video/beats holds the narration
that is spoken over it and the specification of what is on screen. Change one narration line and one
beat is rebuilt. Re record one take and one beat is rebuilt. The cut is a concatenation, and it is
never the reason anything is re rendered.

Two kinds of beat, and the composer treats them the same:

  machine  captured here, by Playwright, driving the real deployed page. Reproducible, and the
           capture asserts what has to be on screen, so a page that stopped registering its tools
           fails the build instead of being quietly filmed.

  owner    an mp4 the owner recorded of their own screen while their own agent drove the page. The
           agent lives in a browser that cannot run in CI: it needs the owner's machine and the
           owner's account. This build takes that file, matches it to the narration, and refuses to
           run at all when one is missing. It never makes a shorter cut and calls it done.

Audio locked, always. The narration is rendered first, its duration is measured from the encoded
file, and the picture is then trimmed or held to exactly that many frames. The picture follows the
voice. Nothing stretches the voice to fit a picture.

Usage:
  python video/build_video.py                       build every beat and assemble the cut
  python video/build_video.py --beat 05-reconcile   rebuild one beat, no assembly
  python video/build_video.py --force               ignore the cache
  python video/build_video.py --plan                say what would be built, spend nothing
  python video/build_video.py --check-takes         list the owner takes that are missing

Needs ffmpeg and ffprobe on PATH, node with playwright for machine beats, and ELEVENLABS_API_KEY
for narration. Nothing is installed by this script. In CI the workflow provides all three.
"""

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# The repository ignores no __pycache__ directory, because until this pipeline arrived there was no
# Python in it. Importing sync_gate would leave one in the working tree for the next person to
# wonder about, so the cache is switched off before the import rather than cleaned up after it.
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)

from sync_gate import MAX_TOTAL_SECONDS, FPS, probe_streams, write_vtt  # noqa: E402

# Bump this when the render itself changes shape. It is part of every beat hash, so a change to the
# pipeline invalidates the cache the same way a change to a narration line does.
PIPELINE_VERSION = "1"

BEATS_DIR = os.path.join(HERE, "beats")
DEFAULT_OUT = os.path.join(REPO, "tmp", "video")
RUNBOOK = os.path.join(REPO, "docs", "submission", "video.md")

WIDTH = 1920
HEIGHT = 1080
SAMPLE_RATE = 48000

SECRET_NAME = "ELEVENLABS_API_KEY"
VOICE_ENV = "ELEVENLABS_VOICE_ID"
DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"
TTS_MODEL = "eleven_multilingual_v2"
TTS_HOST = "https://api.elevenlabs.io"

MAX_CUE_CHARS = 84

# How long the last frame may be held when a take is shorter than its narration.
#
# The picture is always fitted to the voice, so a short take does not desynchronise anything: it
# freezes. Every gate stays green through that, because a frozen frame is a frame. This is the one
# way the pipeline could still hand back a quietly defective cut, so past this many seconds it is a
# hard failure that names the take and the shortfall. Under it, a held tail is normal and expected,
# since the last word of a sentence usually outlives the last thing that moves on screen.
MAX_HOLD_SECONDS = 1.5


class BuildError(Exception):
    pass


# ------------------------------------------------------------------- helpers

def run(argv, what):
    result = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                            errors="replace")
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip()[-1500:]
        raise BuildError(f"{what} failed.\n\ncommand: {' '.join(argv[:6])} ...\n\n{tail}")
    return result


def need(tool, why):
    if shutil.which(tool) is None:
        raise BuildError(
            f"{tool} is not on PATH, and {why}. Do not install it on a work machine: push the "
            f"branch and let .github/workflows/video.yml do it, where installing is the job."
        )


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


# --------------------------------------------------------------- beat loading

def load_beats():
    if not os.path.isdir(BEATS_DIR):
        raise BuildError(f"there are no beats at {BEATS_DIR}.")

    beats = []
    for name in sorted(os.listdir(BEATS_DIR)):
        directory = os.path.join(BEATS_DIR, name)
        spec_path = os.path.join(directory, "beat.json")
        narration_path = os.path.join(directory, "narration.txt")
        if not os.path.isfile(spec_path):
            continue
        spec = json.loads(read_text(spec_path))
        if spec.get("id") != name:
            raise BuildError(
                f"{spec_path} calls itself {spec.get('id')!r} while it lives in {name!r}. The id "
                f"is the directory name, because that is what orders the cut."
            )
        if not os.path.isfile(narration_path):
            raise BuildError(
                f"beat {name} has no narration.txt. Every beat is spoken over: a silent beat is a "
                f"missing beat, not a design choice."
            )
        spec["_dir"] = directory
        spec["_narration"] = read_text(narration_path).strip()
        if not spec["_narration"]:
            raise BuildError(f"beat {name} has an empty narration.txt.")
        if spec.get("kind") not in ("machine", "owner"):
            raise BuildError(f"beat {name} has kind {spec.get('kind')!r}. It is machine or owner.")
        beats.append(spec)

    if not beats:
        raise BuildError(f"no beat directories found under {BEATS_DIR}.")
    return beats


def take_path(spec):
    return os.path.join(spec["_dir"], spec.get("take", "take.mp4"))


def describe_take(spec):
    """The message a person reads when a take is missing. It has to be enough to go and record."""
    record = spec.get("record") or {}
    lines = [f"  {spec['id']}  {spec.get('title', '')}".rstrip()]
    lines.append(f"    save the screen recording as: {take_path(spec)}")
    lines.append(f"    about {spec.get('target_seconds', '?')} seconds, and it will be trimmed to "
                 f"the narration")
    if record.get("surface"):
        lines.append(f"    on screen: {record['surface']}")
    for prompt in record.get("prompts") or []:
        lines.append(f"    type into the agent, word for word: {prompt}")
    for action in record.get("actions") or []:
        lines.append(f"    do: {action}")
    for item in record.get("must_show") or []:
        lines.append(f"    must be visible: {item}")
    lines.append(f"    the full runbook, with the order to record in, is {RUNBOOK}")
    return "\n".join(lines)


def missing_takes(beats):
    return [s for s in beats if s["kind"] == "owner" and not os.path.isfile(take_path(s))]


def check_runbook_names_every_owner_beat(beats):
    """
    A beat that nobody can be told how to record is a beat that never gets recorded.

    This is here rather than in a document because a rule written as prose in a long file does not
    stop its own repeat. Add an owner beat, forget the runbook entry, and the build stops.
    """
    if not os.path.isfile(RUNBOOK):
        raise BuildError(
            f"{RUNBOOK} does not exist. It is the owner's recording runbook and the deliverable "
            f"record for the video, and the readiness gate reads it."
        )
    text = read_text(RUNBOOK)
    absent = [s["id"] for s in beats if s["kind"] == "owner" and s["id"] not in text]
    if absent:
        raise BuildError(
            "these owner beats are not named anywhere in the runbook, so nobody can record them:\n"
            + "\n".join(f"  {beat_id}" for beat_id in absent)
            + f"\n\nAdd a section for each in {RUNBOOK}, with the literal prompt to type and what "
              f"must be visible on screen."
        )


# ----------------------------------------------------------------- narration

def tts(text, destination):
    key = os.environ.get(SECRET_NAME, "").strip()
    if not key:
        raise BuildError(
            f"{SECRET_NAME} is not set, so there is no narration to render.\n\n"
            f"This build does not fall back to a silent track. A voiceless cut looks finished and "
            f"is not, and it would reach a judge as a broken deliverable.\n\n"
            f"In CI: add {SECRET_NAME} as a repository secret, then run the video workflow.\n"
            f"Locally: set {SECRET_NAME} in the environment of this shell only.\n"
            f"To exercise the gate without any secret at all, run:\n"
            f"  python video/sync_gate.py --selftest"
        )

    voice = os.environ.get(VOICE_ENV, "").strip() or DEFAULT_VOICE_ID
    url = f"{TTS_HOST}/v1/text-to-speech/{voice}?output_format=mp3_44100_128"
    body = json.dumps({
        "text": text,
        "model_id": TTS_MODEL,
        "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.0},
    }).encode("utf-8")

    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("xi-api-key", key)
    request.add_header("content-type", "application/json")
    request.add_header("accept", "audio/mpeg")

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            audio = response.read()
    except urllib.error.HTTPError as error:
        detail = (error.read() or b"").decode("utf-8", "replace")[:600]
        raise BuildError(
            f"the narration service refused the request with HTTP {error.code}. The key itself is "
            f"never printed here.\n\n{detail}"
        )
    except urllib.error.URLError as error:
        raise BuildError(f"could not reach the narration service: {error.reason}")

    if len(audio) < 2048:
        raise BuildError(
            f"the narration service returned {len(audio)} bytes, which is not speech. Refusing to "
            f"build a beat around it."
        )

    with open(destination, "wb") as handle:
        handle.write(audio)


def encode_narration(mp3_path, m4a_path):
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", mp3_path,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "aac", "-b:a", "160k", "-ar", str(SAMPLE_RATE), "-ac", "2",
        m4a_path,
    ], "encoding the narration")
    seconds = probe_streams(m4a_path)["audio"]
    if not seconds or seconds <= 0:
        raise BuildError(f"the encoded narration at {m4a_path} has no duration.")
    return seconds


# ------------------------------------------------------------------ captions

def split_cues(text, total_seconds):
    """
    Cues derived from the narration that was actually rendered, not from a separate caption file
    that can drift away from it. Time is shared out by character count, which tracks speech length
    closely enough for a caption and never invents a number.
    """
    flat = " ".join(text.split())
    sentences = [s.strip() for s in re.split(r"(?<=[.?!:])\s+", flat) if s.strip()]

    chunks = []
    for sentence in sentences:
        if len(sentence) <= MAX_CUE_CHARS:
            chunks.append(sentence)
            continue
        words = sentence.split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if len(candidate) > MAX_CUE_CHARS and current:
                chunks.append(current)
                current = word
            else:
                current = candidate
        if current:
            chunks.append(current)

    if not chunks:
        chunks = [flat]

    weights = [max(1, len(chunk)) for chunk in chunks]
    span = float(sum(weights))

    cues = []
    cursor = 0.0
    for index, chunk in enumerate(chunks):
        if index == len(chunks) - 1:
            end = total_seconds
        else:
            end = cursor + total_seconds * (weights[index] / span)
        end = min(end, total_seconds)
        if end <= cursor:
            end = min(cursor + 0.04, total_seconds)
        cues.append((cursor, end, chunk))
        cursor = end
    return cues


# ------------------------------------------------------------------- capture

CAPTURE_JS = r"""
// Generated by video/build_video.py. Runs in CI only, where playwright is installed.
// It drives the real deployed page and asserts what has to be on screen. A page that stopped
// registering its tools fails this script rather than being filmed in that state.
const fs = require('fs');
const { chromium } = require('playwright');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// A minimal WebMCP host. There is no agent in a headless browser, so the capture supplies the one
// thing an agent browser supplies: an object with registerTool on it. Every tool the page registers
// here is the page's own tool, registered by the page's own code, honouring the page's own
// AbortSignal. Nothing about the page is stubbed. This host is what the ChatGPT browser provides in
// the owner beats, and it is disclosed as such in video/README.md.
const HOST = `(() => {
  const tools = new Map();
  const bus = new EventTarget();
  const context = {
    async registerTool(descriptor, options) {
      if (options && options.signal) {
        if (options.signal.aborted) throw new Error('registration was aborted');
        options.signal.addEventListener('abort', () => {
          tools.delete(descriptor.name);
          bus.dispatchEvent(new Event('toolchange'));
        });
      }
      tools.set(descriptor.name, descriptor);
      bus.dispatchEvent(new Event('toolchange'));
      return true;
    },
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
    dispatchEvent: bus.dispatchEvent.bind(bus),
    __toolNames: () => Array.from(tools.keys()),
    __call: async (name, args) => {
      const tool = tools.get(name);
      if (!tool) throw new Error('no such tool: ' + name);
      return tool.execute(args || {}, {});
    }
  };
  Object.defineProperty(document, 'modelContext', { value: context, configurable: true });
})();`;

function fail(message) {
  console.error('capture failed: ' + message);
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
  const context = await browser.newContext({
    viewport: spec.viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    recordVideo: { dir: spec.raw_dir, size: spec.viewport }
  });
  const page = await context.newPage();

  const problems = [];
  page.on('pageerror', (error) => problems.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push('console error: ' + message.text());
  });

  try {
    for (const step of spec.steps) {
      if (step.do === 'agent_host') {
        await page.addInitScript(HOST);
      } else if (step.do === 'goto') {
        await page.goto(spec.url, { waitUntil: 'load', timeout: 60000 });
      } else if (step.do === 'wait') {
        await page.waitForTimeout(step.ms);
      } else if (step.do === 'wait_text') {
        await page.waitForFunction(
          ([selector, needle]) => {
            const node = document.querySelector(selector);
            return Boolean(node && (node.textContent || '').includes(needle));
          },
          [step.selector, step.contains],
          { timeout: step.timeout || 30000 }
        ).catch(async () => {
          const seen = await page.textContent(step.selector).catch(() => null);
          fail('expected ' + step.selector + ' to contain ' + JSON.stringify(step.contains) +
               ' and it read ' + JSON.stringify(seen));
        });
      } else if (step.do === 'expect_tool_count') {
        const names = await page.evaluate(() => document.modelContext.__toolNames());
        if (names.length !== step.count) {
          fail('expected ' + step.count + ' registered tools and the page registered ' +
               names.length + ': ' + names.join(', '));
        }
        console.log('tools registered: ' + names.join(', '));
      } else if (step.do === 'scroll_to') {
        await page.locator(step.selector).first().scrollIntoViewIfNeeded({ timeout: 15000 });
      } else if (step.do === 'click') {
        await page.locator(step.selector).first().click({ timeout: 15000 });
      } else if (step.do === 'select') {
        await page.locator(step.selector).first().selectOption(step.value, { timeout: 15000 });
      } else if (step.do === 'call_tool') {
        const result = await page.evaluate(
          ([name, args]) => document.modelContext.__call(name, args),
          [step.name, step.args || {}]
        );
        if (!result) fail('tool ' + step.name + ' returned nothing');
      } else {
        fail('unknown capture step: ' + JSON.stringify(step.do));
      }
    }
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }

  const video = page.video();
  await context.close();
  await browser.close();

  if (problems.length) {
    console.error('the page reported problems while it was being filmed:');
    for (const problem of problems) console.error('  ' + problem);
    process.exit(1);
  }

  const path = await video.path();
  fs.writeFileSync(spec.result, JSON.stringify({ video: path }), 'utf8');
  console.log('captured ' + path);
})();
"""


def capture_machine_beat(spec, out_beat_dir, url):
    need("node", "machine beats are captured by Playwright driving the real deployed page")
    if not url:
        raise BuildError(
            "no deployed URL to film. Set CLAIMREADY_URL in the environment, or pass --url. In CI "
            "it comes from the repository variable of the same name."
        )

    raw_dir = os.path.join(out_beat_dir, "raw")
    if os.path.isdir(raw_dir):
        shutil.rmtree(raw_dir)
    os.makedirs(raw_dir, exist_ok=True)

    script_path = os.path.join(out_beat_dir, "capture.js")
    with open(script_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(CAPTURE_JS)

    capture = spec.get("capture") or {}
    payload = {
        "url": url,
        "viewport": capture.get("viewport") or {"width": 1440, "height": 810},
        "steps": capture.get("steps") or [],
        "raw_dir": raw_dir,
        "result": os.path.join(out_beat_dir, "capture-result.json"),
    }
    spec_path = os.path.join(out_beat_dir, "capture-spec.json")
    with open(spec_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=2)

    result = subprocess.run(
        ["node", script_path, spec_path],
        capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=REPO,
    )
    sys.stdout.write(result.stdout or "")
    if result.returncode != 0:
        raise BuildError(
            f"capturing beat {spec['id']} against {url} failed. The page is filmed as it really is, "
            f"so this is a finding about the deployed site, not about the camera.\n\n"
            f"{(result.stderr or '').strip()[-1500:]}"
        )

    with open(payload["result"], "r", encoding="utf-8") as handle:
        return json.load(handle)["video"]


# ------------------------------------------------------------------- picture

def fit_picture(source, destination, audio_seconds, trim_head):
    """
    Hold or trim the picture to the narration, to the frame.

    The frame count is computed from the audio that was actually encoded, so the video duration is
    ceil(audio * fps) / fps and can never be more than one frame away from the audio. That is the
    whole sync guarantee, and it is arithmetic rather than a tolerance.
    """
    frames = max(1, int(math.ceil(audio_seconds * FPS - 1e-9)))
    hold = audio_seconds + 2.0

    filters = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x11151c,"
        f"setsar=1,fps={FPS},"
        f"tpad=stop_mode=clone:stop_duration={hold:.3f}"
    )

    argv = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if trim_head and trim_head > 0:
        argv += ["-ss", f"{trim_head:.3f}"]
    argv += [
        "-i", source,
        "-an", "-vf", filters,
        "-frames:v", str(frames),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-g", str(FPS), "-keyint_min", str(FPS), "-sc_threshold", "0",
        destination,
    ]
    run(argv, "fitting the picture to the narration")
    return frames


def mux(picture, narration, destination):
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", picture, "-i", narration,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "copy",
        "-movflags", "+faststart",
        destination,
    ], "muxing the beat")


# --------------------------------------------------------------------- cache

def beat_hash(spec, url):
    digest = hashlib.sha256()
    digest.update(PIPELINE_VERSION.encode("utf-8"))
    digest.update(f"|{FPS}|{WIDTH}|{HEIGHT}|{SAMPLE_RATE}|".encode("utf-8"))
    digest.update((os.environ.get(VOICE_ENV, "") or DEFAULT_VOICE_ID).encode("utf-8"))
    digest.update(TTS_MODEL.encode("utf-8"))
    digest.update(spec["_narration"].encode("utf-8"))
    digest.update(json.dumps(
        {k: v for k, v in spec.items() if not k.startswith("_")},
        sort_keys=True,
    ).encode("utf-8"))
    if spec["kind"] == "owner":
        digest.update(sha256_file(take_path(spec)).encode("utf-8"))
    else:
        digest.update((url or "").encode("utf-8"))
    return digest.hexdigest()


def cache_path(out_root, beat_id):
    return os.path.join(out_root, "cache", f"{beat_id}.json")


def cached(out_root, spec, want_hash):
    path = cache_path(out_root, spec["id"])
    if not os.path.isfile(path):
        return None
    try:
        entry = json.loads(read_text(path))
    except (ValueError, OSError):
        return None
    if entry.get("hash") != want_hash:
        return None
    for relative in entry.get("outputs", []):
        if not os.path.isfile(os.path.join(out_root, relative)):
            return None
    return entry


def remember(out_root, spec, want_hash, entry):
    os.makedirs(os.path.dirname(cache_path(out_root, spec["id"])), exist_ok=True)
    payload = dict(entry)
    payload["hash"] = want_hash
    with open(cache_path(out_root, spec["id"]), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


# ------------------------------------------------------------------- the build

def build_beat(spec, out_root, url, force):
    beat_id = spec["id"]
    out_beat_dir = os.path.join(out_root, "beats", beat_id)
    os.makedirs(out_beat_dir, exist_ok=True)

    want = beat_hash(spec, url)
    hit = None if force else cached(out_root, spec, want)
    if hit:
        print(f"  {beat_id:<20} cache hit, nothing re rendered")
        return hit

    print(f"  {beat_id:<20} building")

    mp3 = os.path.join(out_beat_dir, "narration.mp3")
    m4a = os.path.join(out_beat_dir, "narration.m4a")
    tts(spec["_narration"], mp3)
    audio_seconds = encode_narration(mp3, m4a)

    if spec["kind"] == "machine":
        source = capture_machine_beat(spec, out_beat_dir, url)
        trim_head = float((spec.get("capture") or {}).get("trim_head_seconds", 0.4))
    else:
        source = take_path(spec)
        trim_head = float(spec.get("trim_head_seconds", 0.0))

    source_seconds = probe_streams(source)["video"] or 0.0
    usable = source_seconds - trim_head
    hold = audio_seconds - usable
    if hold > MAX_HOLD_SECONDS:
        raise BuildError(
            f"beat {beat_id} would freeze for {hold:.1f} seconds.\n\n"
            f"The picture is {usable:.1f}s of usable footage and the narration is "
            f"{audio_seconds:.1f}s, so the last frame would be held for {hold:.1f}s, and the budget "
            f"is {MAX_HOLD_SECONDS:g}s.\n\n"
            f"Every gate would pass this. A frozen frame is a frame, the audio and video still "
            f"match to the frame, and the cut is still under the cap. It would simply be a bad "
            f"beat that nothing refused, which is the one way this pipeline could still hand back "
            f"a quietly defective cut.\n\n"
            + (
                f"Record a longer take and save it again as {source}. Aim for "
                f"{audio_seconds + 3:.0f} seconds or more: a long take is trimmed and costs "
                f"nothing."
                if spec["kind"] == "owner" else
                f"Add more waiting to the capture steps in {os.path.join(spec['_dir'], 'beat.json')} "
                f"so the machine beat runs at least {audio_seconds + 3:.0f} seconds."
            )
            + f"\n\nShortening {os.path.join(spec['_dir'], 'narration.txt')} works too, and changes "
              f"what is said."
        )
    if hold > 1e-6:
        print(
            f"    note: the last frame is held for {hold:.2f}s, inside the {MAX_HOLD_SECONDS:g}s "
            f"budget"
        )

    picture = os.path.join(out_beat_dir, "picture.mp4")
    frames = fit_picture(source, picture, audio_seconds, trim_head)

    beat_file = os.path.join(out_beat_dir, "beat.mp4")
    mux(picture, m4a, beat_file)

    measured = probe_streams(beat_file)
    cues = split_cues(spec["_narration"], audio_seconds)
    captions = os.path.join(out_beat_dir, "captions.vtt")
    write_vtt(captions, cues)

    entry = {
        "id": beat_id,
        "kind": spec["kind"],
        "title": spec.get("title", ""),
        "target_seconds": spec.get("target_seconds"),
        "video": os.path.relpath(beat_file, out_root).replace("\\", "/"),
        "captions": os.path.relpath(captions, out_root).replace("\\", "/"),
        "seconds": measured["video"],
        "audio_seconds": measured["audio"],
        "frames": frames,
        "cues": len(cues),
        "narration": spec["_narration"],
        "outputs": [
            os.path.relpath(beat_file, out_root).replace("\\", "/"),
            os.path.relpath(captions, out_root).replace("\\", "/"),
            os.path.relpath(m4a, out_root).replace("\\", "/"),
        ],
    }
    remember(out_root, spec, want, entry)
    return entry


def assemble(entries, out_root):
    concat = os.path.join(out_root, "concat.txt")
    with open(concat, "w", encoding="utf-8", newline="\n") as handle:
        for entry in entries:
            absolute = os.path.join(out_root, entry["video"]).replace("\\", "/")
            handle.write(f"file '{absolute}'\n")

    cut = os.path.join(out_root, "cut.mp4")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", concat,
        "-c", "copy", "-movflags", "+faststart", cut,
    ], "assembling the cut")

    joined = []
    running = 0.0
    for entry in entries:
        entry["start_seconds"] = running
        for start, end, text in split_cues(entry["narration"], entry["audio_seconds"]):
            joined.append((running + start, running + end, text))
        running += entry["seconds"]

    write_vtt(os.path.join(out_root, "captions.vtt"), joined)

    manifest = {
        "cut": "cut.mp4",
        "captions": "captions.vtt",
        "fps": FPS,
        "width": WIDTH,
        "height": HEIGHT,
        "cap_seconds": MAX_TOTAL_SECONDS,
        "total_seconds": running,
        "beats": [
            {
                "id": e["id"], "kind": e["kind"], "title": e["title"],
                "video": e["video"], "captions": e["captions"],
                "start_seconds": e["start_seconds"], "seconds": e["seconds"],
                "audio_seconds": e["audio_seconds"], "cues": e["cues"],
            }
            for e in entries
        ],
    }
    with open(os.path.join(out_root, "manifest.json"), "w", encoding="utf-8",
              newline="\n") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    return cut, running


# ---------------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the demo video, one beat at a time.")
    parser.add_argument("--beat", default=None, help="rebuild one beat id and do not assemble")
    parser.add_argument("--out", default=DEFAULT_OUT, help="build directory. Default <repo>/tmp/video")
    parser.add_argument("--url", default=os.environ.get("CLAIMREADY_URL", "").strip() or None,
                        help="the deployed page the machine beats are filmed against")
    parser.add_argument("--force", action="store_true", help="ignore the cache")
    parser.add_argument("--plan", action="store_true", help="say what would happen and spend nothing")
    parser.add_argument("--check-takes", action="store_true",
                        help="list the owner takes that are missing, then stop")
    args = parser.parse_args(argv)

    beats = load_beats()
    check_runbook_names_every_owner_beat(beats)

    if args.check_takes:
        gaps = missing_takes(beats)
        if not gaps:
            print("every owner take is present. The cut can be built.")
            return 0
        print("owner takes still to record:\n")
        for spec in gaps:
            print(describe_take(spec))
            print()
        return 1

    if args.plan:
        total = sum(s.get("target_seconds", 0) for s in beats)
        print(f"{len(beats)} beats, targets adding to {total}s, cap {MAX_TOTAL_SECONDS:g}s\n")
        print(f"  {'beat':<20}{'kind':<9}{'target':>8}  narration words")
        for spec in beats:
            words = len(spec["_narration"].split())
            print(f"  {spec['id']:<20}{spec['kind']:<9}{spec.get('target_seconds', 0):>7}s  {words}")
        gaps = missing_takes(beats)
        if gaps:
            print(f"\n{len(gaps)} owner take(s) missing: " + ", ".join(s["id"] for s in gaps))
        return 0

    need("ffmpeg", "every beat is encoded here")
    need("ffprobe", "every duration is measured, never assumed")

    single = None
    if args.beat:
        matches = [s for s in beats if s["id"] == args.beat]
        if not matches:
            raise BuildError(
                f"no beat called {args.beat!r}. There is: " + ", ".join(s["id"] for s in beats)
            )
        single = matches[0]

    # Refuse before spending anything. Rendering narration for seven beats and then discovering the
    # eighth take is missing costs real money and produces nothing.
    scope = [single] if single else beats
    gaps = missing_takes(scope)
    if gaps:
        print("build refused: an owner beat has no recording.\n", file=sys.stderr)
        print("These beats are the visitor's own agent driving the page inside their own browser. "
              "That browser needs the owner's machine and the owner's account, so it cannot be "
              "captured here, and a cut without them is not the cut.\n", file=sys.stderr)
        for spec in gaps:
            print(describe_take(spec), file=sys.stderr)
            print(file=sys.stderr)
        return 1

    os.makedirs(args.out, exist_ok=True)

    if single:
        print(f"building one beat into {args.out}\n")
        build_beat(single, args.out, args.url, args.force)
        print(
            f"\nOne beat rebuilt. The cut was not assembled and the manifest was not touched, so "
            f"run the whole build before gating:\n"
            f"  python video/build_video.py\n"
            f"  python video/sync_gate.py --root {args.out}"
        )
        return 0

    print(f"building {len(beats)} beats into {args.out}\n")
    entries = [build_beat(spec, args.out, args.url, args.force) for spec in beats]

    cut, total = assemble(entries, args.out)

    print(f"\n  {'beat':<20}{'kind':<9}{'target':>8}{'actual':>9}{'start':>9}")
    for entry in entries:
        print(
            f"  {entry['id']:<20}{entry['kind']:<9}"
            f"{entry.get('target_seconds') or 0:>7}s{entry['seconds']:>8.2f}s"
            f"{entry['start_seconds']:>8.2f}s"
        )
    print(f"\ncut: {cut}")
    print(f"total {total:.2f}s of a {MAX_TOTAL_SECONDS:g}s cap")

    if total >= MAX_TOTAL_SECONDS:
        print(
            f"\nthis cut is over the cap. Shorten a narration.txt and rebuild that beat. Do not "
            f"move the cap: it lives in video/sync_gate.py and in the workflow, and the gate fails "
            f"when they disagree.",
            file=sys.stderr,
        )
        return 1

    print(f"\nnow gate it:  python video/sync_gate.py --root {args.out}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BuildError as error:
        print(f"\nbuild failed: {error}", file=sys.stderr)
        sys.exit(1)
