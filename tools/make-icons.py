#!/usr/bin/env python3
"""Rasterise the SVG sources into the PNG icons the manifest and iOS need.

Run from the repo root after editing icon.svg or icon-maskable.svg:

    pip install cairosvg && python3 tools/make-icons.py

The PNGs are committed, so this only has to run when the artwork changes.
"""
import pathlib
import cairosvg

ROOT = pathlib.Path(__file__).resolve().parent.parent

# (source svg, output png, size). "any" icons keep the full-bleed artwork;
# the maskable ones carry their own padding, and iOS reuses them because it
# rounds the corners of an opaque icon rather than masking a transparent one.
JOBS = [
    ("icon.svg", "icon-192.png", 192),
    ("icon.svg", "icon-512.png", 512),
    ("icon-maskable.svg", "icon-maskable-192.png", 192),
    ("icon-maskable.svg", "icon-maskable-512.png", 512),
    ("icon-maskable.svg", "apple-touch-icon.png", 180),
]

for src, out, size in JOBS:
    cairosvg.svg2png(
        url=str(ROOT / src),
        write_to=str(ROOT / out),
        output_width=size,
        output_height=size,
    )
    print(f"{out}  {size}x{size}")
