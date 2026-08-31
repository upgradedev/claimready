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
  python video/build_video.py --beat 05-reconcile   render one beat only, see the contract below
  python video/build_video.py --force               ignore the cache
  python video/build_video.py --plan                say what would be built, spend nothing
  python video/build_video.py --check-takes         list the owner takes that are missing

Needs ffmpeg and ffprobe on PATH, node with playwright for machine beats, and ELEVENLABS_API_KEY
for narration. Nothing is installed by this script. In CI the workflow provides all three.

THE ONE BEAT CONTRACT, stated here, in the workflow, in video/README.md and in the runbook,
and asserted by check I of video/sync_gate.py so the four can never drift apart again:

  A --beat run renders one beat and never assembles or gates a cut, so nothing it produces
  may be uploaded.

The sentence lives once, as ONE_BEAT_CONTRACT in sync_gate.py, and is imported below. A one
beat run also DELETES any cut, caption file and manifest left in the build directory by an
earlier run, because a stale cut sitting beside a fresh beat, with nothing gating the pair,
is the exact artifact somebody uploads by mistake.
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

from sync_gate import (  # noqa: E402
    MAX_TOTAL_SECONDS,
    FPS,
    ONE_BEAT_CONTRACT,
    probe_streams,
    write_vtt,
)

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


# --------------------------------------------------------- what is on camera

# A machine beat is a photograph of the deployed page, so the sources below are the beat's real
# input, exactly as the narration is. This used to be hashed as the URL string alone, which said
# nothing about what the URL was serving, so a beat filmed against an older page was a cache hit
# for ever.
#
# That is not hypothetical. The only machine footage on record was filmed at cfc5c0c. The commit
# after it, d054311, put a tools panel on index.html, inside the frame that beats 01, 02 and 08
# scan. Nothing in the pipeline noticed, because neither the beat hash nor the workflow cache key
# had ever heard of index.html.
CAMERA_PATHS = ["index.html", "src", "assets"]

CAMERA_SKIP_DIRECTORIES = {"__pycache__", ".git"}


def camera_files():
    """Every on camera source, as repository relative posix paths, sorted for a stable digest."""
    found = []
    for entry in CAMERA_PATHS:
        full = os.path.join(REPO, entry)
        if os.path.isfile(full):
            found.append(entry)
            continue
        if not os.path.isdir(full):
            raise BuildError(
                f"{full} is on the camera list and does not exist. The list is CAMERA_PATHS in "
                f"{os.path.relpath(__file__, REPO)}, and a path that is not there means the beat "
                f"hash is covering less of the page than it claims."
            )
        for base, directories, names in os.walk(full):
            directories[:] = sorted(d for d in directories if d not in CAMERA_SKIP_DIRECTORIES)
            for name in sorted(names):
                path = os.path.join(base, name)
                found.append(os.path.relpath(path, REPO).replace("\\", "/"))
    return sorted(found)


def normalised(data):
    """
    Line endings folded to LF before anything is hashed or compared.

    The digest is part of a cache key that has to mean the same thing on this machine and on a
    runner, and the host serves the committed bytes while a Windows checkout with autocrlf may hold
    the same file with CRLF. Without this, the same page would hash two ways and the deployed page
    would read as stale on one of the two platforms.
    """
    return data.replace(b"\r\n", b"\n")


def camera_digest(files=None):
    """
    One hash over the bytes of every on camera source, as they stand in the working tree.

    The file list can be passed in so one walk serves the hash, the verification and the manifest.
    Walking it again later would let two of those three describe different sets of files, which is
    the drift this is here to remove.
    """
    digest = hashlib.sha256()
    for relative in (camera_files() if files is None else files):
        with open(os.path.join(REPO, relative), "rb") as handle:
            body = normalised(handle.read())
        digest.update(f"{relative}:{hashlib.sha256(body).hexdigest()}\n".encode("utf-8"))
    return digest.hexdigest()


def deployed_sha(explicit=None):
    """
    The commit the machine beats are being filmed against, as it was told to us.

    Told, not discovered: nothing here proves it yet. verify_deployed is what turns it into a
    measurement, and until that has run the value is a label on an unchecked claim.
    """
    for value in (explicit,
                  os.environ.get("CLAIMREADY_DEPLOYED_SHA"),
                  os.environ.get("GITHUB_SHA")):
        if value and value.strip():
            return value.strip()
    result = subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"],
                            capture_output=True, text=True)
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    return None


def site_base(url):
    """The directory the deployed page's own relative links resolve against."""
    base = (url or "").split("#")[0].split("?")[0]
    if not base:
        return None
    if base.lower().endswith((".html", ".htm")):
        base = base.rsplit("/", 1)[0] + "/"
    if not base.endswith("/"):
        base += "/"
    return base


def fetch_bytes(url, timeout=30):
    request = urllib.request.Request(url, headers={
        "User-Agent": "claimready-video-builder",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        # urlopen already raises on an HTTP error status, so this only has to catch the odd
        # success that is not a 200. A scheme with no status, which is what a file URL is in the
        # self test below, reports None and is read on its own terms.
        status = getattr(response, "status", None)
        if status is not None and status != 200:
            raise BuildError(f"{url} answered {status}.")
        return response.read()


def git_blob(sha, relative):
    result = subprocess.run(["git", "-C", REPO, "show", f"{sha}:{relative}"], capture_output=True)
    if result.returncode != 0:
        tail = (result.stderr or b"").decode("utf-8", "replace").strip()[-400:]
        raise BuildError(
            f"git could not read {relative} at {sha}. Either that commit is not in this checkout, "
            f"or the file did not exist in it.\n\n{tail}"
        )
    return result.stdout


def verify_deployed(url, sha, files=None):
    """
    Prove the deployed page is the tree that is about to be hashed, and that the tree is the SHA
    the manifest is about to claim.

    Two comparisons, chained rather than run side by side, so a failure names one cause:

      deployed bytes  ==  working tree bytes     the beat hash records the tree, so this is the
                                                 comparison that decides whether footage is current
      working tree    ==  git blob at <sha>      which is what makes the SHA in the manifest a
                                                 statement about the thing that was filmed

    Transitively the deployed page is that SHA. A non 200 on any camera source fails: a file that
    will not fetch is not a file that was checked.
    """
    base = site_base(url)
    if not base:
        raise BuildError(
            "the machine beats film a deployed page and no URL was given. Set CLAIMREADY_URL, or "
            "pass --url."
        )
    if not sha:
        raise BuildError(
            "no deployed SHA. Pass --deployed-sha, or set CLAIMREADY_DEPLOYED_SHA, or run this "
            "inside the git checkout the page was deployed from. The manifest records what was "
            "filmed, so an unnamed commit is not a build this pipeline will assemble."
        )

    files = camera_files() if files is None else files
    print(f"checking {len(files)} on camera source(s) at {base} against {sha[:12]}")

    for relative in files:
        target = base + relative
        try:
            served = normalised(fetch_bytes(target))
        except BuildError:
            raise
        except (urllib.error.URLError, OSError) as error:
            raise BuildError(
                f"could not read {target}, which is on camera in the machine beats: {error}. "
                f"Nothing is filmed against a page that cannot be read whole."
            )

        with open(os.path.join(REPO, relative), "rb") as handle:
            local = normalised(handle.read())

        if hashlib.sha256(served).hexdigest() != hashlib.sha256(local).hexdigest():
            raise BuildError(
                f"the deployed page is not what is on disk. {target} does not match {relative} in "
                f"this checkout.\n\n"
                f"  deployed  {hashlib.sha256(served).hexdigest()[:16]}  {len(served)} bytes\n"
                f"  on disk   {hashlib.sha256(local).hexdigest()[:16]}  {len(local)} bytes\n\n"
                f"Filming would produce a beat that shows one page while the manifest, the "
                f"narration and the cache key all describe another.\n\n"
                f"The likeliest cause is not a broken deployment. It is that this build is running "
                f"from a commit the host has never served: a branch that is ahead of whatever the "
                f"live site is built from, or a commit whose deployment has not finished. Check "
                f"which branch this run checked out before you go looking at the host. Then either "
                f"wait for the deployment, or build from the commit the host is serving. Do not "
                f"film through it."
            )

        expected = normalised(git_blob(sha, relative))
        if hashlib.sha256(local).hexdigest() != hashlib.sha256(expected).hexdigest():
            raise BuildError(
                f"what is on disk is not the SHA you named. {relative} in this checkout does not "
                f"match {relative} at {sha}.\n\n"
                f"The deployed page cannot be showing an uncommitted edit, so the SHA this build "
                f"would write into the manifest would be a claim about a different set of bytes "
                f"than the ones it hashed. Commit the change and deploy it, or name the SHA the "
                f"tree actually is."
            )

    print(f"the deployed page is {sha[:12]}, on every one of those files")
    return sha


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
    if record.get("note"):
        lines.append(f"    note: {record['note']}")
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

    # .cjs, deliberately. This script is written under the repository root, whose package.json
    # declares {"type": "module"} so that node --test reads the .js sources as ES modules. A
    # generated .js file there is therefore parsed as ESM, and its first require() throws before
    # a browser is ever opened. The extension is the whole fix, and it stays until the generated
    # script is written in module syntax.
    script_path = os.path.join(out_beat_dir, "capture.cjs")
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
        stderr = (result.stderr or "").strip()
        # Two very different failures arrive on the same exit code, and calling both a finding
        # about the site sent a real defect in this file to the wrong place once already. If the
        # script did not even start, the site is not the story.
        camera = any(
            marker in stderr
            for marker in ("require is not defined", "Cannot find module", "SyntaxError",
                           "ERR_MODULE_NOT_FOUND", "playwright")
        )
        blame = (
            "the capture script itself did not run, so this is a defect in the camera and says "
            "nothing about the page"
            if camera else
            "the page is filmed as it really is, so this is a finding about the deployed site "
            "rather than about the camera"
        )
        raise BuildError(
            f"capturing beat {spec['id']} against {url} failed. {blame}.\n\n{stderr[-1500:]}"
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

def beat_hash(spec, url, sha=None, sources=None):
    """
    Everything a beat is made of, in one hash.

    For an owner beat the picture is a file, so the file is hashed. For a machine beat the picture
    is a photograph of the deployed page, so what the page is made of is hashed: the URL, the
    commit it is serving, and the bytes of every on camera source. Hashing the URL alone, which is
    what this did until d054311 made it matter, meant the cache could not tell one page from
    another and stale footage was adopted for ever.

    `sources` is passed in so a caller that has already computed the digest does not walk the tree
    once per beat, and so a test can hash a hypothetical tree without touching this one.
    """
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
        digest.update(f"|{sha or ''}|".encode("utf-8"))
        digest.update((sources if sources is not None else camera_digest()).encode("utf-8"))
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

def build_beat(spec, out_root, url, force, sha=None, sources=None):
    beat_id = spec["id"]
    out_beat_dir = os.path.join(out_root, "beats", beat_id)
    os.makedirs(out_beat_dir, exist_ok=True)

    want = beat_hash(spec, url, sha, sources)
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


def assemble(entries, out_root, url=None, sha=None, sources=None, camera=None):
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
        # What the machine beats were filmed against, so a reader of the finished cut can tell
        # which page they are looking at. Both values were verified against the live host before
        # any beat was built: see verify_deployed.
        "filmed_url": url,
        "deployed_sha": sha,
        "camera_digest": sources,
        # The list the digest was taken over, passed in rather than walked again here. Walking it
        # a second time at assembly would let the manifest name a file set that no longer matches
        # its own digest, which is the exact class of drift this pipeline is trying to remove.
        "camera_files": camera,
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

def discard_stale_cut(out_root):
    """
    Delete anything in the build directory that looks like a finished cut.

    A --beat run rebuilds one beat and assembles nothing. Whatever cut, caption file and
    manifest an earlier run left behind therefore describe a set of beats that no longer
    exists on disk, and no gate has read that pair. Leaving them there is how a stale cut ends
    up uploaded beside a freshly rendered beat, which is the one failure the beat input has
    actually caused.

    The per beat cache under <out>/cache is deliberately untouched. It is keyed on the beat
    hash, so it is still correct, and clearing it would make the next full build re render
    every beat and spend a narration credit on each one for nothing.

    @param out_root the build directory
    @returns the file names that were removed, in the order they were removed
    """
    removed = []
    for name in ("cut.mp4", "captions.vtt", "manifest.json", "concat.txt"):
        path = os.path.join(out_root, name)
        if os.path.isfile(path):
            os.remove(path)
            removed.append(name)
    return removed


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the demo video, one beat at a time.")
    parser.add_argument("--beat", default=None,
                        help="render one beat id. " + ONE_BEAT_CONTRACT)
    parser.add_argument("--out", default=DEFAULT_OUT, help="build directory. Default <repo>/tmp/video")
    parser.add_argument("--url", default=os.environ.get("CLAIMREADY_URL", "").strip() or None,
                        help="the deployed page the machine beats are filmed against")
    parser.add_argument("--deployed-sha", default=None,
                        help="the commit the deployed page is serving. Defaults to "
                             "CLAIMREADY_DEPLOYED_SHA, then GITHUB_SHA, then the checkout's HEAD. "
                             "The build refuses to film when the live page is not this commit")
    parser.add_argument("--force", action="store_true", help="ignore the cache")
    parser.add_argument("--plan", action="store_true", help="say what would happen and spend nothing")
    parser.add_argument("--check-takes", action="store_true",
                        help="list the owner takes that are missing, then stop")
    parser.add_argument("--capture-only", action="store_true",
                        help="film the machine beats against the deployed page and stop. No "
                             "narration key is read, nothing is assembled, and no owner take is "
                             "required. This exists so the browser capture is proved to work "
                             "before anyone records a take or spends a narration credit")
    args = parser.parse_args(argv)

    beats = load_beats()
    check_runbook_names_every_owner_beat(beats)
    sha = deployed_sha(args.deployed_sha)

    if args.check_takes:
        # Scoped by --beat, the same way the build is. Without this, asking whether ONE machine
        # beat can be rendered answered a different question, whether every owner take exists, and
        # a job re rendering a single beat refused over four recordings it was never going to use.
        scope_for_takes = beats
        if args.beat:
            named = [s for s in beats if s["id"] == args.beat]
            if not named:
                raise BuildError(
                    f"no beat called {args.beat!r}. There is: " + ", ".join(s["id"] for s in beats)
                )
            scope_for_takes = named
        gaps = missing_takes(scope_for_takes)
        if not gaps:
            where = f"beat {args.beat}" if args.beat else "the cut"
            print(f"every owner take {where} needs is present. It can be built.")
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

        # The plan spends nothing and touches no network, so these two are printed as the claim
        # they are. The build fetches every one of those files from the host and refuses to film
        # when the answer differs.
        camera = camera_files()
        sources = camera_digest(camera)
        print(f"\n  machine beats would be filmed against: {args.url or 'no URL set'}")
        print(f"  deployed sha, told and not yet verified: {sha or 'unknown'}")
        print(f"  on camera sources, {len(camera)} files, digest {sources[:16]}")

        gaps = missing_takes(beats)
        if gaps:
            print(f"\n{len(gaps)} owner take(s) missing: " + ", ".join(s["id"] for s in gaps))
        return 0

    need("ffmpeg", "every beat is encoded here")
    need("ffprobe", "every duration is measured, never assumed")

    if args.capture_only:
        # The one limb of this pipeline that no test can stand in for: a real browser, driving the
        # real deployed page, on a runner. Prove it here, where a failure costs a rerun, rather
        # than on the day the owner has already recorded five takes and the narration is paid for.
        machine = [s for s in beats if s["kind"] == "machine"]
        if not machine:
            print("no machine beats to film.")
            return 0
        verify_deployed(args.url, sha, camera_files())
        print(f"\nfilming {len(machine)} machine beat(s) against {args.url}\n")
        failures = []
        for spec in machine:
            out_beat_dir = os.path.join(args.out, "beats", spec["id"])
            os.makedirs(out_beat_dir, exist_ok=True)
            try:
                path = capture_machine_beat(spec, out_beat_dir, args.url)
                seconds = (probe_streams(path)["video"] or 0.0) if os.path.isfile(path) else 0.0
                if seconds <= 0:
                    raise BuildError(f"the capture at {path} has no video duration.")
                print(f"  {spec['id']:<20}captured {seconds:>7.2f}s  {path}")
            except Exception as error:  # noqa: BLE001 report every beat, do not stop at the first
                failures.append((spec["id"], str(error)))
                print(f"  {spec['id']:<20}FAILED  {error}")
        if failures:
            print(f"\n{len(failures)} of {len(machine)} machine beats could not be filmed.",
                  file=sys.stderr)
            return 1
        print("\nevery machine beat filmed. The browser capture works on this runner.")
        return 0

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

    # Before a cent is spent and before anything is assembled: the page that is about to be filmed
    # has to be the commit this build says it filmed. Only the beats in scope decide whether this
    # runs, so rebuilding one owner beat needs no deployment at all.
    camera = camera_files()
    sources = camera_digest(camera)
    if any(s["kind"] == "machine" for s in scope):
        verify_deployed(args.url, sha, camera)
        print()

    if single:
        print(f"building one beat into {args.out}\n")
        build_beat(single, args.out, args.url, args.force, sha, sources)
        removed = discard_stale_cut(args.out)
        print(f"\n{ONE_BEAT_CONTRACT}")
        if removed:
            print(
                "\nA cut from an earlier run was sitting in this directory beside the beat "
                "that was just rendered, so it was deleted rather than left to be picked up:"
            )
            for name in removed:
                print(f"  removed {name}")
            print(
                "  the per beat cache was left alone, so the next full build still restores "
                "every beat it can"
            )
        print(
            f"\nTo produce something that may be uploaded, assemble the whole cut and gate "
            f"it:\n"
            f"  python video/build_video.py\n"
            f"  python video/sync_gate.py --root {args.out}"
        )
        return 0

    print(f"building {len(beats)} beats into {args.out}\n")
    entries = [build_beat(spec, args.out, args.url, args.force, sha, sources) for spec in beats]

    cut, total = assemble(entries, args.out, args.url, sha, sources, camera)

    print(f"\n  {'beat':<20}{'kind':<9}{'target':>8}{'actual':>9}{'start':>9}")
    for entry in entries:
        print(
            f"  {entry['id']:<20}{entry['kind']:<9}"
            f"{entry.get('target_seconds') or 0:>7}s{entry['seconds']:>8.2f}s"
            f"{entry['start_seconds']:>8.2f}s"
        )
    print(f"\ncut: {cut}")
    print(f"filmed against {args.url} at {sha}")
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
