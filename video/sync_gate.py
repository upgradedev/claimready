#!/usr/bin/env python3
"""
ClaimReady video sync gate.

This gate reads the shipped pixels and the shipped audio. It never reads the plan. Every number it
asserts on comes back from ffprobe or ffmpeg run against a file that is about to be uploaded, so a
build that renders the wrong thing cannot pass by having a tidy manifest.

What it asserts, and every one of these exits non zero on failure:

  A  cap agreement      MAX_TOTAL_SECONDS below and VIDEO_MAX_TOTAL_SECONDS in the workflow are the
                        same number. Changing the cap in one place is a failure, not a change.
  B  manifest           the manifest names beats in order, and every file it names exists.
  C  audio video sync   per beat, the audio stream duration and the video stream duration are
                        within one frame of each other.
  D  beat captions      per beat, every cue lies inside that beat, starts before it ends, and no
                        two cues overlap.
  E  cut captions       the assembled caption file places every cue inside the bounds of the beat
                        it belongs to, and no two cues overlap.
  F  beats make the cut the beat durations add up to the duration of the cut that ships.
  G  total under cap    the cut, probed with ffprobe, is shorter than MAX_TOTAL_SECONDS.
  H  audible            every beat carries audio above the silence floor, so a build that lost its
                        narration fails here instead of shipping voiceless.

Usage:
  python video/sync_gate.py                     gate the build in <repo>/tmp/video
  python video/sync_gate.py --root DIR          gate a build somewhere else
  python video/sync_gate.py --selftest          prove every check above can fail, no secret needed
  python video/sync_gate.py --make-fixture DIR  write a small passing build tree, for experiments

The self test needs ffmpeg and ffprobe and nothing else. It needs no API key, no network and no
deployed page, which is why it is the step that runs when the narration secret is absent.
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

# ------------------------------------------------------------------ constants

# The rules say the video must be less than three minutes. This is the one place the number lives
# in Python. The workflow declares the same number under VIDEO_MAX_TOTAL_SECONDS and check A fails
# if the two ever disagree, so moving the cap means moving both.
MAX_TOTAL_SECONDS = 170.0

FPS = 30
FRAME_SECONDS = 1.0 / FPS

# Mean volume floor. Narration sits far above this. A beat that lost its audio track, or was muxed
# with silence, sits far below it.
SILENCE_FLOOR_DB = -50.0

WORKFLOW_RELATIVE = os.path.join(".github", "workflows", "video.yml")
WORKFLOW_KEY = "VIDEO_MAX_TOTAL_SECONDS"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

CUE_LINE = re.compile(
    r"^(\d\d):(\d\d):(\d\d)\.(\d\d\d)\s+-->\s+(\d\d):(\d\d):(\d\d)\.(\d\d\d)\s*$"
)


class GateFailure(Exception):
    """One assertion that did not hold, carrying the check id it belongs to."""

    def __init__(self, check, message):
        super().__init__(f"[{check}] {message}")
        self.check = check


# -------------------------------------------------------------------- probing

def _run(argv):
    return subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace")


def require_tools():
    missing = [name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None]
    if missing:
        raise GateFailure(
            "TOOLS",
            "this gate reads the shipped media, so it needs "
            + " and ".join(missing)
            + " on PATH. Install nothing on a work machine: run this in CI, where the workflow "
              "installs ffmpeg before it reaches this step.",
        )


def probe_streams(path):
    """Return {'video': seconds or None, 'audio': seconds or None, 'format': seconds or None}."""
    result = _run([
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_type,duration,nb_frames,r_frame_rate:format=duration",
        "-of", "json", path,
    ])
    if result.returncode != 0:
        raise GateFailure("PROBE", f"ffprobe could not read {path}: {result.stderr.strip()}")

    data = json.loads(result.stdout or "{}")
    out = {"video": None, "audio": None, "format": None, "frames": None, "fps": None}

    fmt = (data.get("format") or {}).get("duration")
    if fmt not in (None, "N/A"):
        out["format"] = float(fmt)

    for stream in data.get("streams") or []:
        kind = stream.get("codec_type")
        if kind not in ("video", "audio"):
            continue
        duration = stream.get("duration")
        if duration not in (None, "N/A"):
            out[kind] = float(duration)
        if kind == "video":
            frames = stream.get("nb_frames")
            if frames not in (None, "N/A"):
                out["frames"] = int(frames)
            rate = stream.get("r_frame_rate")
            if rate and "/" in rate:
                num, den = rate.split("/", 1)
                if float(den) != 0:
                    out["fps"] = float(num) / float(den)

    # A stream that reports no duration is not a pass and is not an excuse. Count the frames.
    if out["video"] is None and out["frames"] and out["fps"]:
        out["video"] = out["frames"] / out["fps"]

    return out


def mean_volume_db(path):
    """Mean volume of the audio in a file, in dBFS. Returns None when there is no audio at all."""
    result = _run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", path,
        "-map", "0:a:0?", "-af", "volumedetect", "-f", "null", "-",
    ])
    match = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?) dB", result.stderr or "")
    if match:
        return float(match.group(1))
    return None


# ------------------------------------------------------------------- captions

def parse_vtt(path):
    """Return [(start_seconds, end_seconds, text)] for a WebVTT file, in file order."""
    with open(path, "r", encoding="utf-8") as handle:
        lines = handle.read().replace("\r\n", "\n").split("\n")

    cues = []
    index = 0
    while index < len(lines):
        match = CUE_LINE.match(lines[index])
        if match:
            parts = [int(x) for x in match.groups()]
            start = parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 1000.0
            end = parts[4] * 3600 + parts[5] * 60 + parts[6] + parts[7] / 1000.0
            body = []
            index += 1
            while index < len(lines) and lines[index].strip() != "":
                body.append(lines[index])
                index += 1
            cues.append((start, end, " ".join(body).strip()))
        index += 1
    return cues


def check_cues(check, label, cues, lower, upper):
    """Cues sit inside [lower, upper], run forwards, and never overlap."""
    if not cues:
        raise GateFailure(check, f"{label} carries no cues. Narration was rendered but not captioned.")

    previous_end = None
    for position, (start, end, text) in enumerate(cues, start=1):
        if end <= start:
            raise GateFailure(
                check,
                f"{label} cue {position} ends at {end:.3f}s, at or before its start {start:.3f}s.",
            )
        if start < lower - 1e-6:
            raise GateFailure(
                check,
                f"{label} cue {position} starts at {start:.3f}s, before the beat begins at {lower:.3f}s.",
            )
        if end > upper + FRAME_SECONDS + 1e-6:
            raise GateFailure(
                check,
                f"{label} cue {position} ends at {end:.3f}s, past the beat end at {upper:.3f}s. "
                f"Captions may run to the last frame and no further.",
            )
        if previous_end is not None and start < previous_end - 1e-6:
            raise GateFailure(
                check,
                f"{label} cue {position} starts at {start:.3f}s while cue {position - 1} is still "
                f"on screen until {previous_end:.3f}s.",
            )
        previous_end = end


# ----------------------------------------------------------------- the checks

def read_workflow_cap(workflow_path):
    if not os.path.isfile(workflow_path):
        raise GateFailure(
            "A",
            f"the workflow that publishes the cut is missing at {workflow_path}, so the cap has "
            f"nothing to agree with.",
        )
    with open(workflow_path, "r", encoding="utf-8") as handle:
        text = handle.read()
    found = re.findall(rf"{WORKFLOW_KEY}\s*:\s*[\"']?(\d+(?:\.\d+)?)[\"']?", text)
    if not found:
        raise GateFailure(
            "A",
            f"{WORKFLOW_KEY} does not appear in {workflow_path}. The cap must be declared in the "
            f"workflow as well as in this file, so that moving it in one place fails here.",
        )
    values = {float(value) for value in found}
    if len(values) != 1:
        raise GateFailure(
            "A",
            f"{WORKFLOW_KEY} appears in {workflow_path} with more than one value: "
            f"{sorted(values)}. Pick one.",
        )
    return values.pop()


def check_a_cap_agreement(workflow_path):
    declared = read_workflow_cap(workflow_path)
    if abs(declared - MAX_TOTAL_SECONDS) > 1e-9:
        raise GateFailure(
            "A",
            f"the cap disagrees with itself. sync_gate.py says {MAX_TOTAL_SECONDS:g} seconds and "
            f"{os.path.basename(workflow_path)} says {declared:g}. Change both, or change neither.",
        )
    return declared


def load_manifest(root):
    path = os.path.join(root, "manifest.json")
    if not os.path.isfile(path):
        raise GateFailure(
            "B",
            f"no manifest at {path}. Run build_video.py first: this gate reads a build, it does "
            f"not make one.",
        )
    with open(path, "r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    beats = manifest.get("beats")
    if not isinstance(beats, list) or not beats:
        raise GateFailure("B", "the manifest lists no beats.")

    ids = [entry.get("id") for entry in beats]
    if sorted(ids) != ids:
        raise GateFailure(
            "B",
            f"the manifest beats are out of order: {ids}. The cut is assembled in beat id order.",
        )
    return manifest


def gate(root, workflow_path, verbose=True):
    """Run every check against a build tree. Raises GateFailure on the first thing that is wrong."""
    require_tools()

    lines = []

    declared = check_a_cap_agreement(workflow_path)
    lines.append(f"A  cap agreement      sync_gate.py and the workflow both say {declared:g}s")

    manifest = load_manifest(root)
    beats = manifest["beats"]

    cut_path = os.path.join(root, manifest.get("cut", "cut.mp4"))
    if not os.path.isfile(cut_path):
        raise GateFailure("B", f"the manifest names a cut at {cut_path} and there is no file there.")

    for entry in beats:
        beat_file = os.path.join(root, entry["video"])
        caption_file = os.path.join(root, entry["captions"])
        for path in (beat_file, caption_file):
            if not os.path.isfile(path):
                raise GateFailure("B", f"beat {entry['id']} names {path}, which does not exist.")
    lines.append(f"B  manifest           {len(beats)} beats, every named file present")

    # C, D and H are per beat and read the beat file itself.
    measured = []
    for entry in beats:
        beat_id = entry["id"]
        beat_file = os.path.join(root, entry["video"])
        streams = probe_streams(beat_file)

        if streams["video"] is None:
            raise GateFailure("C", f"beat {beat_id} has no readable video stream duration.")
        if streams["audio"] is None:
            raise GateFailure(
                "C",
                f"beat {beat_id} has no audio stream at all. The picture is held to the narration, "
                f"so a beat without narration is a build failure, not a quiet beat.",
            )

        drift = abs(streams["video"] - streams["audio"])
        if drift > FRAME_SECONDS + 1e-6:
            raise GateFailure(
                "C",
                f"beat {beat_id} is out of sync by {drift * 1000:.1f} ms. video "
                f"{streams['video']:.3f}s, audio {streams['audio']:.3f}s, and one frame at {FPS} "
                f"fps is {FRAME_SECONDS * 1000:.1f} ms. The picture must be trimmed or held to the "
                f"narration, never the other way round.",
            )

        volume = mean_volume_db(beat_file)
        if volume is None:
            raise GateFailure("H", f"beat {beat_id} carries no measurable audio.")
        if volume < SILENCE_FLOOR_DB:
            raise GateFailure(
                "H",
                f"beat {beat_id} has a mean volume of {volume:.1f} dB, below the silence floor of "
                f"{SILENCE_FLOOR_DB:.1f} dB. This build is voiceless and must not ship.",
            )

        beat_cues = parse_vtt(os.path.join(root, entry["captions"]))
        check_cues("D", f"beat {beat_id}", beat_cues, 0.0, streams["video"])

        measured.append({
            "id": beat_id,
            "video": streams["video"],
            "audio": streams["audio"],
            "drift_ms": drift * 1000.0,
            "volume_db": volume,
            "cues": len(beat_cues),
        })

    worst = max(measured, key=lambda row: row["drift_ms"])
    lines.append(
        f"C  audio video sync   worst drift {worst['drift_ms']:.1f} ms on {worst['id']}, "
        f"budget {FRAME_SECONDS * 1000:.1f} ms"
    )
    lines.append(
        f"D  beat captions      {sum(row['cues'] for row in measured)} cues, all inside their beat, "
        f"none overlapping"
    )
    quietest = min(measured, key=lambda row: row["volume_db"])
    lines.append(
        f"H  audible            quietest beat {quietest['id']} at {quietest['volume_db']:.1f} dB, "
        f"floor {SILENCE_FLOOR_DB:.1f} dB"
    )

    # E: the assembled captions, cue by cue, against the beat each one belongs to.
    cut_captions = os.path.join(root, manifest.get("captions", "captions.vtt"))
    if not os.path.isfile(cut_captions):
        raise GateFailure("E", f"the cut has no caption file at {cut_captions}.")
    all_cues = parse_vtt(cut_captions)

    starts = []
    running = 0.0
    for row in measured:
        starts.append(running)
        running += row["video"]
    total_from_beats = running

    consumed = 0
    for index, row in enumerate(measured):
        lower = starts[index]
        upper = starts[index] + row["video"]
        slice_ = all_cues[consumed:consumed + row["cues"]]
        if len(slice_) != row["cues"]:
            raise GateFailure(
                "E",
                f"the assembled captions ran out during beat {row['id']}. Expected "
                f"{row['cues']} cues and found {len(slice_)}.",
            )
        check_cues("E", f"cut, beat {row['id']}", slice_, lower, upper)
        consumed += row["cues"]

    if consumed != len(all_cues):
        raise GateFailure(
            "E",
            f"the assembled captions carry {len(all_cues)} cues but the beats account for "
            f"{consumed}. Something was captioned that is not in the cut.",
        )
    check_cues("E", "cut", all_cues, 0.0, total_from_beats)
    lines.append(f"E  cut captions       {len(all_cues)} cues, each inside the beat it belongs to")

    # F and G read the cut that ships.
    cut = probe_streams(cut_path)
    cut_duration = cut["video"] if cut["video"] is not None else cut["format"]
    if cut_duration is None:
        raise GateFailure("F", f"ffprobe reports no duration for the cut at {cut_path}.")

    slack = FRAME_SECONDS * len(measured) + 0.05
    if abs(cut_duration - total_from_beats) > slack:
        raise GateFailure(
            "F",
            f"the cut is {cut_duration:.3f}s but the beats add up to {total_from_beats:.3f}s, a "
            f"gap of {abs(cut_duration - total_from_beats):.3f}s against a budget of {slack:.3f}s. "
            f"The file that ships is not the beats that were gated.",
        )
    lines.append(
        f"F  beats make the cut cut {cut_duration:.3f}s against {total_from_beats:.3f}s of beats"
    )

    if cut_duration >= MAX_TOTAL_SECONDS:
        raise GateFailure(
            "G",
            f"the cut runs {cut_duration:.3f}s and the cap is {MAX_TOTAL_SECONDS:g}s. Shorten a "
            f"narration file and rebuild that beat. Do not move the cap.",
        )
    lines.append(
        f"G  total under cap    {cut_duration:.3f}s of {MAX_TOTAL_SECONDS:g}s, "
        f"{MAX_TOTAL_SECONDS - cut_duration:.3f}s spare"
    )

    if verbose:
        print(f"sync gate: PASS. {os.path.basename(cut_path)} read from disk, not from the plan.\n")
        for line in lines:
            print("  " + line)
        print()
        print(f"  {'beat':<20}{'video':>9}{'audio':>9}{'drift':>10}{'volume':>10}{'cues':>6}")
        for row in measured:
            print(
                f"  {row['id']:<20}{row['video']:>8.3f}s{row['audio']:>8.3f}s"
                f"{row['drift_ms']:>8.1f}ms{row['volume_db']:>9.1f}dB{row['cues']:>6}"
            )

    return {"beats": measured, "cut_seconds": cut_duration}


# ----------------------------------------------------------------- fixtures

def _vtt_timestamp(seconds):
    if seconds < 0:
        seconds = 0.0
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    whole = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{whole:06.3f}"


def write_vtt(path, cues):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("WEBVTT\n\n")
        for index, (start, end, text) in enumerate(cues, start=1):
            handle.write(f"{index}\n")
            handle.write(f"{_vtt_timestamp(start)} --> {_vtt_timestamp(end)}\n")
            handle.write(f"{text}\n\n")


def _make_beat_file(path, seconds, silent=False, colour="0x1b2330", label="beat"):
    """A tiny beat file with exactly ceil(seconds*FPS) frames and audio of the same length."""
    frames = max(1, int(math.ceil(seconds * FPS - 1e-9)))
    audio_seconds = frames / FPS
    tone = "anullsrc=r=48000:cl=stereo" if silent else "sine=frequency=320:r=48000"
    argv = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"color=c={colour}:s=320x180:r={FPS}",
        "-f", "lavfi", "-i", tone,
        "-frames:v", str(frames),
        "-t", f"{audio_seconds:.6f}",
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "96k",
        "-fflags", "+genpts",
        path,
    ]
    result = _run(argv)
    if result.returncode != 0:
        raise RuntimeError(f"could not build the fixture beat {label}: {result.stderr[-800:]}")


def make_fixture(root, beat_seconds=None, silent_beat=None, long_beat=None):
    """
    Write a small but structurally real build tree that the gate passes.

    The fixture is not a mock of the gate's inputs. It is the same shape the real build writes,
    made of real encoded media, so every assertion runs against pixels here too.
    """
    if beat_seconds is None:
        beat_seconds = [3.0, 2.5, 4.0]

    os.makedirs(root, exist_ok=True)
    beats_dir = os.path.join(root, "beats")
    os.makedirs(beats_dir, exist_ok=True)

    manifest_beats = []
    all_cues = []
    running = 0.0
    concat_lines = []

    for index, seconds in enumerate(beat_seconds, start=1):
        beat_id = f"{index:02d}-fixture"
        directory = os.path.join(beats_dir, beat_id)
        os.makedirs(directory, exist_ok=True)
        beat_file = os.path.join(directory, "beat.mp4")
        _make_beat_file(
            beat_file,
            seconds,
            silent=(silent_beat == index),
            label=beat_id,
        )
        actual = probe_streams(beat_file)["video"]

        cues = [
            (0.0, actual / 2.0, f"{beat_id} first half"),
            (actual / 2.0, actual, f"{beat_id} second half"),
        ]
        write_vtt(os.path.join(directory, "captions.vtt"), cues)
        for start, end, text in cues:
            all_cues.append((running + start, running + end, text))

        manifest_beats.append({
            "id": beat_id,
            "kind": "machine",
            "video": os.path.relpath(beat_file, root).replace("\\", "/"),
            "captions": os.path.relpath(
                os.path.join(directory, "captions.vtt"), root).replace("\\", "/"),
            "start_seconds": running,
            "seconds": actual,
        })
        concat_lines.append(f"file '{beat_file.replace(chr(92), '/')}'")
        running += actual

    if long_beat is not None:
        # A cut that is over the cap, made of one very long beat. Nothing about the gate is
        # relaxed to build this: the media really is that long.
        beat_id = "99-overlong"
        directory = os.path.join(beats_dir, beat_id)
        os.makedirs(directory, exist_ok=True)
        beat_file = os.path.join(directory, "beat.mp4")
        _make_beat_file(beat_file, long_beat, label=beat_id)
        actual = probe_streams(beat_file)["video"]
        cues = [(0.0, actual, "overlong fixture beat")]
        write_vtt(os.path.join(directory, "captions.vtt"), cues)
        all_cues.append((running, running + actual, "overlong fixture beat"))
        manifest_beats.append({
            "id": beat_id,
            "kind": "machine",
            "video": os.path.relpath(beat_file, root).replace("\\", "/"),
            "captions": os.path.relpath(
                os.path.join(directory, "captions.vtt"), root).replace("\\", "/"),
            "start_seconds": running,
            "seconds": actual,
        })
        concat_lines.append(f"file '{beat_file.replace(chr(92), '/')}'")
        running += actual

    list_path = os.path.join(root, "concat.txt")
    with open(list_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(concat_lines) + "\n")

    cut_path = os.path.join(root, "cut.mp4")
    result = _run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", list_path,
        "-c", "copy", "-movflags", "+faststart", cut_path,
    ])
    if result.returncode != 0:
        raise RuntimeError(f"could not assemble the fixture cut: {result.stderr[-800:]}")

    write_vtt(os.path.join(root, "captions.vtt"), all_cues)

    with open(os.path.join(root, "manifest.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump({
            "fixture": True,
            "fps": FPS,
            "cut": "cut.mp4",
            "captions": "captions.vtt",
            "beats": manifest_beats,
        }, handle, indent=2)
        handle.write("\n")

    return root


def write_workflow_stub(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("name: fixture\nenv:\n  " + WORKFLOW_KEY + f": \"{value:g}\"\n")


# ----------------------------------------------------------------- self test

def expect_failure(check, label, root, workflow_path):
    try:
        gate(root, workflow_path, verbose=False)
    except GateFailure as failure:
        if failure.check != check:
            print(f"  selftest FAIL  {label}: expected check {check} to fire, got {failure}")
            return False
        print(f"  ok   {check}  {label}")
        print(f"       it said: {failure}")
        return True
    print(f"  selftest FAIL  {label}: the gate passed something it must refuse.")
    return False


def selftest():
    """
    Break the build on purpose, once per check, and prove the gate refuses each one.

    A gate that has never been seen to fail is a decoration. This runs before the gate is trusted,
    needs no secret, and is the step the workflow can always run.
    """
    require_tools()
    print("sync gate self test: every check is made to fail on purpose, then the good tree passes.\n")

    passed = True
    with tempfile.TemporaryDirectory(prefix="claimready-syncgate-") as work:
        good_workflow = os.path.join(work, "wf-good", WORKFLOW_RELATIVE)
        write_workflow_stub(good_workflow, MAX_TOTAL_SECONDS)

        # A: the cap moved in the workflow and not here.
        bad_workflow = os.path.join(work, "wf-bad", WORKFLOW_RELATIVE)
        write_workflow_stub(bad_workflow, MAX_TOTAL_SECONDS + 30)
        base = make_fixture(os.path.join(work, "base"))
        passed &= expect_failure("A", "the cap moved in one file only", base, bad_workflow)

        # B: the manifest names a beat file that is not there.
        broken = os.path.join(work, "no-file")
        make_fixture(broken)
        os.remove(os.path.join(broken, "beats", "02-fixture", "beat.mp4"))
        passed &= expect_failure("B", "a beat named in the manifest is missing", broken, good_workflow)

        # C: the audio runs longer than the picture, which is the failure the whole pipeline exists
        # to prevent. Built by re encoding one beat with a longer audio track.
        drifted = os.path.join(work, "drift")
        make_fixture(drifted)
        target = os.path.join(drifted, "beats", "02-fixture", "beat.mp4")
        stretched = target + ".stretched.mp4"
        result = _run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", target,
            "-f", "lavfi", "-i", "sine=frequency=320:r=48000", "-t", "5.0",
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
            "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "96k", stretched,
        ])
        if result.returncode != 0:
            print("  selftest FAIL  could not build the drifted beat:", result.stderr[-400:])
            passed = False
        else:
            os.replace(stretched, target)
            passed &= expect_failure("C", "audio longer than the picture", drifted, good_workflow)

        # D: a caption that runs past the end of its own beat.
        overrun = os.path.join(work, "caption-overrun")
        make_fixture(overrun)
        caption = os.path.join(overrun, "beats", "01-fixture", "captions.vtt")
        cues = parse_vtt(caption)
        cues[-1] = (cues[-1][0], cues[-1][1] + 1.5, cues[-1][2])
        write_vtt(caption, cues)
        passed &= expect_failure("D", "a cue that outlives its beat", overrun, good_workflow)

        # E: two cues on screen at once in the assembled caption file.
        overlap = os.path.join(work, "caption-overlap")
        make_fixture(overlap)
        joined = os.path.join(overlap, "captions.vtt")
        cues = parse_vtt(joined)
        cues[1] = (max(0.0, cues[1][0] - 0.9), cues[1][1], cues[1][2])
        write_vtt(joined, cues)
        passed &= expect_failure("E", "overlapping cues in the cut", overlap, good_workflow)

        # F: the cut on disk is not the beats that were gated. One beat is swapped for a longer
        # one after assembly, which is exactly what a stale build directory looks like.
        stale = os.path.join(work, "stale-cut")
        make_fixture(stale)
        swap = os.path.join(stale, "beats", "03-fixture", "beat.mp4")
        _make_beat_file(swap, 9.0, label="03-fixture-swapped")
        caption = os.path.join(stale, "beats", "03-fixture", "captions.vtt")
        length = probe_streams(swap)["video"]
        write_vtt(caption, [(0.0, length / 2, "first"), (length / 2, length, "second")])
        passed &= expect_failure("F", "the cut does not match its beats", stale, good_workflow)

        # G: over the cap. The media really is longer than the cap, so nothing is widened here.
        overlong = os.path.join(work, "overlong")
        make_fixture(overlong, beat_seconds=[2.0], long_beat=MAX_TOTAL_SECONDS + 2.0)
        passed &= expect_failure("G", "a cut longer than the cap", overlong, good_workflow)

        # H: a beat that lost its narration and is silent.
        silent = os.path.join(work, "silent")
        make_fixture(silent, silent_beat=2)
        passed &= expect_failure("H", "a beat with no voice on it", silent, good_workflow)

        # And the good tree, which must pass. A gate that fails everything is as useless as one
        # that passes everything.
        print()
        try:
            gate(base, good_workflow, verbose=False)
            print("  ok   --  the unbroken fixture passes")
        except GateFailure as failure:
            print(f"  selftest FAIL  the unbroken fixture was refused: {failure}")
            passed = False

    print()
    if passed:
        print("sync gate self test: PASS. Every check above was seen to fail, and the good tree passed.")
        return 0
    print("sync gate self test: FAIL. A check did not fire when it was supposed to.")
    return 1


# ---------------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description="Gate the rendered cut against the shipped media.")
    parser.add_argument("--root", default=os.path.join(REPO, "tmp", "video"),
                        help="the build directory build_video.py wrote. Default <repo>/tmp/video")
    parser.add_argument("--workflow", default=os.path.join(REPO, WORKFLOW_RELATIVE),
                        help="the workflow that must declare the same cap")
    parser.add_argument("--selftest", action="store_true",
                        help="prove every check can fail. Needs ffmpeg, needs no secret")
    parser.add_argument("--make-fixture", metavar="DIR", default=None,
                        help="write a small passing build tree, for breaking by hand")
    args = parser.parse_args(argv)

    if args.selftest:
        return selftest()

    if args.make_fixture:
        require_tools()
        make_fixture(args.make_fixture)
        print(f"fixture build tree written to {args.make_fixture}")
        print("gate it with:  python video/sync_gate.py --root " + args.make_fixture)
        return 0

    try:
        gate(args.root, args.workflow)
    except GateFailure as failure:
        print(f"sync gate: FAIL. {failure}", file=sys.stderr)
        print(
            "\nNothing here is negotiable. Fix the build, do not move the threshold.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
