#!/usr/bin/env python3
"""Redraw src/app/favicon.ico from the mark and the token registry.

Everything else in the icon set is generated per request — `app/icon.tsx`, `apple-icon.tsx`
and `opengraph-image.tsx` are `ImageResponse` routes that read `styles/tokens.css` at render
time, so they cannot drift from the palette. `.ico` has no route form: browsers ask for
`/favicon.ico` by name and Next serves whatever binary sits in `app/`. This script is that
file's generator, so the one asset the registry cannot reach at runtime can at least be
regenerated from it on demand:

    python3 frontend/scripts/build-favicon.py

Two frames, 16 and 32, each hand-snapped to whole pixels — the mark's 6/3/6 proportions do
not land on integers at those sizes, and a resampled 16px favicon is mush. Stdlib only
(zlib + struct); adding Pillow to a Node repo for two rectangles would be the larger cost.
"""

import re
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "styles" / "tokens.css"
OUT = ROOT / "src" / "app" / "favicon.ico"


def token(name: str) -> tuple[int, int, int, int]:
    """The registry value for `name`, as RGBA. Loud if it is missing or not a hex."""
    match = re.search(rf"(?<![\w-]){re.escape(name)}:\s*#([0-9a-fA-F]{{6}})\s*;", TOKENS.read_text())
    if not match:
        raise SystemExit(f"{name} not found as a 6-digit hex in {TOKENS}")
    value = match.group(1)
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), 255)


# x, y, w, h for the stem and the answering bar, per frame size. Same shape as
# components/brand-mark.tsx: a tall bar, a gap, a bar half its height hanging from the top.
FRAMES = {
    16: {"stem": (4, 2, 3, 12), "turn": (9, 2, 3, 6)},
    32: {"stem": (7, 4, 7, 24), "turn": (18, 4, 7, 12)},
}


def frame(size: int) -> bytes:
    """One `size`×`size` RGBA PNG of the mark on the rail ground."""
    ground, stem, turn = token("--rail"), token("--rail-text"), token("--primary")
    pixels = [[ground] * size for _ in range(size)]
    for colour, (x0, y0, w, h) in ((stem, FRAMES[size]["stem"]), (turn, FRAMES[size]["turn"])):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                pixels[y][x] = colour

    # Filter byte 0 (None) per scanline — the image is four flat colours, so a real filter
    # would buy nothing on a file this size.
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    images = [(size, frame(size)) for size in sorted(FRAMES)]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)

    directory, body = b"", b""
    for size, png in images:
        # PNG-in-ICO rather than BMP-in-ICO: no bottom-up rows, no separate AND mask, and
        # every browser since IE11 reads it.
        directory += struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        body += png

    OUT.write_bytes(header + directory + body)
    print(f"wrote {OUT.relative_to(ROOT.parent)} ({len(header + directory + body)} bytes)")


if __name__ == "__main__":
    main()
