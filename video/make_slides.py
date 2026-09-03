#!/usr/bin/env python3
"""
The two slide beats, rendered from this file rather than from a design tool.

WHY THIS EXISTS. The demo opened on a screen recording of a claim page, and a judge who has never
filed a motor claim had nothing to hold on to: the words first notice of loss, intake and clause
all arrive in the first fifteen seconds and none of them is explained. The cut now opens on a
context beat and closes on a card, and both are built here so that re rendering them is a command
rather than an afternoon.

WHY FFMPEG AND NOT A BROWSER. Every other beat in this pipeline is either the deployed page filmed
by Playwright or a screen recording somebody made. A slide is neither, and the two honest ways to
make one are a design tool, whose output nobody can re derive, or a program. This is the program.
It uses drawtext and drawbox, which ship with ffmpeg, and the fonts Windows already has. There is
no new dependency, and `python video/make_slides.py` reproduces both files exactly.

THE BUDGET IS THE DESIGN CONSTRAINT, AND IT IS NOT NEGOTIABLE HERE. video/sync_gate.py caps the cut
at 170 seconds and the eight recorded beats already spend 149.4 of them. So the whole of the context
and the whole of the close have to fit in what is left. Their NARRATION is what spends that budget,
at 10.80 and 6.30 seconds measured, and the takes are cut longer than that on purpose because the
build trims a long take for nothing and freezes the last frame of a short one. Raising the cap was the other way to make room and it was
refused: the number is this build's own margin under the organizer's three minute rule, and moving a
threshold to fit content is the thing this repository refuses everywhere else.

THE TEXT LIVES IN FILES, NOT IN THE FILTERGRAPH. drawtext takes its text either inline, where a
colon, a comma or an apostrophe has to be escaped twice and a mistake is silent, or from a file. It
reads from files here, written beside the output, so what is on screen is what is in the file.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BEATS = os.path.join(HERE, "beats")
WORK = os.path.join(HERE, "slides-work")

WIDTH, HEIGHT, FPS = 1920, 1080, 30

# The page's own dark palette, from assets/styles.css. A slide that introduces the product in
# colours the product does not use reads as a different product.
BG = "0x10151b"
INK = "0xe7edf3"
INK_SOFT = "0xa9b6c3"
ACCENT = "0x6aa6ea"
AGENT = "0xc3a7ec"
YOU = "0x7fd6b4"

# Windows ships these. drawtext wants a forward slash path and an escaped colon after the drive.
FONT = "C\\:/Windows/Fonts/segoeui.ttf"
FONT_BOLD = "C\\:/Windows/Fonts/seguisb.ttf"
FONT_MONO = "C\\:/Windows/Fonts/consola.ttf"


def line(index, text):
    """Write one line of slide text to its own file and return the path drawtext reads."""
    os.makedirs(WORK, exist_ok=True)
    path = os.path.join(WORK, f"line{index:02d}.txt")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return path.replace("\\", "/").replace(":", "\\:")


def text(idx, body, *, font, size, colour, y, start, stop, rise=18):
    """
    One line of type, faded in and settling upward, drawn only while it is on screen.

    The fade is on drawtext's own alpha rather than a fade filter, so lines can overlap in time
    without dimming each other, and `enable` keeps a line out of the graph entirely outside its
    window, which is what stops eleven lines costing eleven full frame draws every frame.
    """
    fade = 0.45
    src = line(idx, body)
    alpha = (f"if(lt(t,{start}),0,"
             f"if(lt(t,{start + fade}),(t-{start})/{fade},"
             f"if(lt(t,{stop - 0.35}),1,max(0,({stop}-t)/0.35))))")
    drift = f"{y}+{rise}*max(0,1-(t-{start})/{fade})"
    return (f"drawtext=textfile='{src}':fontfile='{font}':fontsize={size}:fontcolor={colour}"
            f":alpha='{alpha}':x=(w-text_w)/2:y='{drift}':enable='between(t,{start},{stop})'")


def rule(x_from, x_to, y, thickness, colour, start, stop, grow=0.7):
    """A hairline that draws itself left to right. The only motion here that is not type."""
    width = f"min({x_to - x_from},{x_to - x_from}*(t-{start})/{grow})"
    return (f"drawbox=x={x_from}:y={y}:w='{width}':h={thickness}:color={colour}@0.9:t=fill"
            f":enable='between(t,{start},{stop})'")


def render(name, seconds, layers):
    out_dir = os.path.join(BEATS, name)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "take.mp4")
    graph = ",".join(layers)
    argv = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"color=c={BG}:s={WIDTH}x{HEIGHT}:r={FPS}:d={seconds}",
        "-vf", graph,
        "-frames:v", str(int(round(seconds * FPS))),
        "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        out,
    ]
    subprocess.run(argv, check=True)
    print(f"  {name:<22} {seconds:>4.1f}s  {out}")


def context_beat():
    """
    Three cards, and every timing here is set by ONE measured number: 10.80 seconds.

    THE PICTURE IS FITTED TO THE VOICE, NEVER TO THIS FILE. `fit_picture` computes the frame count
    from the encoded narration and keeps the FIRST that many frames of the take. The first version
    of this beat was written to twelve seconds; the narration rendered at 10.80, and the build said
    so in one line nobody read as a design constraint:

        00-context          owner         12s   10.80s    0.00s

    So the take was cut at 10.80. The third card's last line was scheduled to appear at 9.95 and
    fade out at 11.95, which means it existed for 0.85 seconds and was cut off in the middle of its
    own fade IN. The owner watched the cut and said that card goes by too fast to read. It did.

    TWO RULES CAME OUT OF THAT, and they are why the cards below look the way they do.

    First, three cards inside eleven seconds means no card carries more than two lines. The middle
    card used to carry three and the last carried three plus a rule. The weakest line of each is
    deleted rather than compressed, because a line nobody can finish reading is worse than a line
    nobody wrote. The one that went was "The rules that decide it live on the insurer's page",
    which the closing card says again anyway.

    Second, THE LAST CARD DOES NOT FADE OUT. Its lines appear and hold to the end of the take, so
    wherever the trim lands after they arrive, they are whole. A fade out scheduled past the trim
    point is invisible; a fade out scheduled before it spends the only seconds the last card has.

    Everything is complete by 10.7 seconds, which leaves the narration room to render shorter than
    it did without cutting a line off again.
    """
    hold = 11.40
    return [
        text(1, "A van reverses into a parked car.", font=FONT_BOLD, size=74, colour=INK,
             y=430, start=0.10, stop=3.30),
        text(2, "Nobody is hurt. The paperwork starts.", font=FONT, size=44, colour=INK_SOFT,
             y=545, start=0.70, stop=3.30),

        text(3, "FIRST NOTICE OF LOSS", font=FONT_BOLD, size=64, colour=ACCENT,
             y=430, start=3.45, stop=6.85),
        rule(660, 1260, 515, 3, ACCENT, 3.70, 6.85),
        text(4, "The first form an insurer sees. Every motor claim starts on one.",
             font=FONT, size=44, colour=INK, y=575, start=3.95, stop=6.85),

        text(6, "One field the policy needed and nobody asked for", font=FONT_BOLD, size=58,
             colour=INK, y=430, start=7.00, stop=hold),
        text(7, "is a second call to the driver, days later.", font=FONT, size=52,
             colour=YOU, y=535, start=7.55, stop=hold),
        rule(560, 1360, 630, 3, YOU, 7.85, hold),
    ]


def closing_beat():
    """Six seconds. The name, the one sentence, and the two links a judge is meant to open."""
    return [
        text(11, "ClaimReady", font=FONT_BOLD, size=96, colour=INK,
             y=360, start=0.10, stop=7.15),
        rule(830, 1090, 490, 4, AGENT, 0.45, 7.15),
        text(12, "The insurer's page hands your own agent its rules as typed tools.",
             font=FONT, size=46, colour=INK_SOFT, y=560, start=0.80, stop=7.15),
        text(13, "upgradedev.github.io/claimready", font=FONT_MONO, size=40, colour=ACCENT,
             y=690, start=1.60, stop=7.15),
        text(14, "github.com/upgradedev/claimready", font=FONT_MONO, size=40, colour=ACCENT,
             y=750, start=1.95, stop=7.15),
    ]


def main():
    if not os.path.isdir(BEATS):
        print(f"no beats directory at {BEATS}", file=sys.stderr)
        return 1
    print("rendering the two slide beats")
    # BOTH TAKES RUN LONGER THAN THEIR NARRATION MEASURED, ON PURPOSE. The build trims a long
    # take for nothing and HOLDS the last frame of a short one, so overshooting is free and
    # undershooting shows as a frozen frame. Measured on the 2026-09-03 build: 00-context
    # rendered at 10.80s and 09-closing at 6.30s, and 09-closing held for 0.30s because its
    # take was 6.00. These two are 11.40 and 7.20.
    render("00-context", 11.40, context_beat())
    render("09-closing", 7.20, closing_beat())
    print("both written. `python video/build_video.py --plan` will now count them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
