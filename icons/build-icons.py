#!/usr/bin/env python3
"""Build the Streamliner extension icons.

Draws a white exclamation mark, tilted 45 degrees, with horizontal speed lines
trailing behind it, on a charcoal rounded square. Writes two master SVGs and
the four PNG sizes that manifest.json refers to.

Two details are easy to get wrong, so they are worth stating.

The speed lines run under the mark rather than stopping short of it. Three bars
with visible rounded ends, stacked at even spacing, read as a list icon instead
of as motion. The mark carries a halo stroke in the background colour, which
keeps it separate from the lines it covers.

There is one master, and every size comes from it. An earlier version had a
second, simplified master for the small sizes, which left the mark with three
trails in chrome://extensions and two in the toolbar menu and the settings
dialog. One master means one mark everywhere.

Requires rsvg-convert and ImageMagick:

    brew install librsvg imagemagick

Run it from anywhere:

    python3 icons/build-icons.py
"""

import math
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent

CHARCOAL = "#3F454D"
MARK = "#fff"
LINE = "#fff"

# A darker charcoal loses its edge against Chrome's dark background, and a
# lighter one weakens the white mark against the light one. This value holds
# up on both.
#
# A red mark (#D8232A) looks good at 128 pixels, but it fails at 16 and 32.
# Small sizes live on luminance contrast, and red against this charcoal has
# little. White has plenty. Red also out-dims the trail, so it inverts the
# hierarchy: the grey lines end up brighter than the mark they trail. Dimming
# the trail fixes the hierarchy but then the speed lines vanish at 16 pixels.

K = math.sqrt(0.5)

# Exclamation stem, drawn upright around the origin. The arcs give it a round
# cap at each end. A squared-off cap makes the tilted mark look like a pen nib.
STEM = "M -11,-35 A 11,11 0 0 1 11,-35 L 6.5,1 A 6.5,6.5 0 0 1 -6.5,1 Z"
DOT_R = 8.5
STEM_HALF = 9.5  # average half-width of the stem, for the flank calculation

# Gradient ids are namespaced because this markup is also inlined into Content
# Manager's own page, where a bare id="g0" is one document-wide id among
# thousands and url(#g0) resolves to whichever element happens to come first.
ID = "streamliner-icon-"

# Where the mark's parts land once the group is rotated 45 degrees, per unit of
# scale, measured from the group origin.
DOT_OFFSET = (-16.97, 16.97)
INK_CENTRE = (5.14, -5.14)

# Each speed line is (offset from the dot's y, thickness, opacity at the head).
# Three lines, and heavier than they want to be at 128, because they also have
# to survive 32. An earlier set at thickness 7 with the faintest at 0.42 looked
# better large and dissolved into haze small.
LINES = [(-38, 8, 0.50), (-19, 8, 0.70), (0, 8, 0.92)]
SCALE = 1.10
CENTRE = (82, 64)

LEFT = 13  # where the lines fade in from
TUCK = 9   # how far each line runs under the mark
HALO = 9   # background-coloured stroke that separates mark from lines


def left_flank(ox, oy, scale, y):
    """The x of the mark's left edge at a given y, for a line to tuck under."""
    return ox - 2 * STEM_HALF * scale * K - (y - oy)


def master(lines, scale, centre):
    ox = centre[0] - INK_CENTRE[0] * scale
    oy = centre[1] - INK_CENTRE[1] * scale
    dot_y = oy + DOT_OFFSET[1] * scale
    dot_left = ox + DOT_OFFSET[0] * scale - DOT_R * scale

    gradients, rects = [], []
    for i, (offset, thickness, opacity) in enumerate(lines):
        y = dot_y + offset
        # The lowest line tucks under the dot; the rest under the stem.
        edge = dot_left if offset == 0 else left_flank(ox, oy, scale, y)
        gradients.append(
            f'<linearGradient id="{ID}g{i}" x1="0" y1="0" x2="1" y2="0">'
            f'<stop offset="0" stop-color="{LINE}" stop-opacity="0"/>'
            f'<stop offset="0.85" stop-color="{LINE}" stop-opacity="{opacity}"/>'
            f"</linearGradient>"
        )
        rects.append(
            f'<rect x="{LEFT}" y="{y - thickness / 2:.1f}" '
            f'width="{edge + TUCK - LEFT:.1f}" height="{thickness}" '
            f'rx="{thickness / 2}" fill="url(#{ID}g{i})"/>'
        )

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" '
        'width="128" height="128">\n'
        f"  <defs>{''.join(gradients)}</defs>\n"
        f'  <rect x="2" y="2" width="124" height="124" rx="28" fill="{CHARCOAL}"/>\n'
        f"  {''.join(rects)}\n"
        f'  <g transform="translate({ox:.2f},{oy:.2f}) rotate(45) scale({scale})"\n'
        f'     fill="{MARK}" stroke="{CHARCOAL}" stroke-width="{HALO}" paint-order="stroke">\n'
        f'    <path d="{STEM}"/><circle cx="0" cy="24" r="{DOT_R}"/>\n'
        "  </g>\n</svg>\n"
    )


def main():
    svg_path = HERE / "icon.svg"
    svg_path.write_text(master(LINES, SCALE, CENTRE))
    for size in (128, 48, 32, 16):
        png_path = HERE / f"icon{size}.png"
        subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size),
             str(svg_path), "-o", str(png_path)],
            check=True,
        )
        print(f"{svg_path.name} -> {png_path.name}")


if __name__ == "__main__":
    main()
