"""Recrop the eight seat avatars from the 看山 master sheet.

`public/avatars/image0.png` is a 4x2 sheet of eight 小看山, each wearing a
different coloured scarf (灰蓝 / 豆沙粉 / 鼠尾草绿 / 浅杏 / 薰衣草紫 / 柔和赭黄 / 青灰 / 莓果).

The eight poses differ in size, so cropping straight on the grid yields avatars
with inconsistent canvas ratio, subject position and visual size, which
`.seat-avatar img` then renders unevenly through `object-fit: cover` in a 140px
circle. This script normalises every seat to one spec: character height
aligned, feet on a shared baseline, horizontally centred.

Two properties of the sheet shape the implementation:

* Cells are separated by light gutters. Cell bounds are taken from the inner
  edge of each gutter, so no separator strip leaks into an avatar.
* The backdrop is a soft blue gradient rather than a flat fill, and the crop is
  wider than a cell. Padding with one flat colour would leave a visible seam,
  so the backdrop is extrapolated per row from the cell's own blue pixels.

Usage:
    python scripts/recrop-seat-avatars.py

Writes `public/avatars/image1.png` .. `image8.png` in row-major order (seat 1..8).
The previous files remain in git history: `git checkout -- public/avatars/`.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "public" / "avatars" / "image0.png"
OUT_DIR = ROOT / "public" / "avatars"

GRID_COLS, GRID_ROWS = 4, 2
CANVAS = 512        # side of the square output
CHAR_HEIGHT = 370   # normalised character height, measured on the line art
BASELINE = 444      # y of the character's feet inside the canvas
INK_MAX = 700       # RGB sum below this counts as character, not backdrop
BLUE_OVER_RED = 10  # backdrop is bluish; the white body is not
BLUE_MIN = 235


def find_bands(projection, min_len=4):
    """Locate runs of blank columns/rows, which mark the gutters between cells."""
    blank = projection <= 2
    bands, start = [], None
    for index, is_blank in enumerate(blank):
        if is_blank and start is None:
            start = index
        elif not is_blank and start is not None:
            if index - start >= min_len:
                bands.append((start, index - 1))
            start = None
    if start is not None and len(blank) - start >= min_len:
        bands.append((start, len(blank) - 1))
    return bands


def cell_bounds(projection, size):
    """Split on the inner edge of each gutter; blank margins flush with the image edge are ignored."""
    gutters = [b for b in find_bands(projection) if b[0] > 0 and b[1] < size - 1]
    edges = [0]
    for start, end in gutters:
        edges.extend((start, end + 1))
    edges.append(size)
    return list(zip(edges[0::2], edges[1::2]))


def backdrop_mask(cell):
    """Pixels belonging to the blue backdrop, excluding the white body and the shadow."""
    return (cell[:, :, 2] - cell[:, :, 0] > BLUE_OVER_RED) & (cell[:, :, 2] > BLUE_MIN)


def row_backdrops(cell, fallback):
    """One backdrop colour per row, forward/backward filled where a row is fully covered."""
    mask = backdrop_mask(cell)
    rows = np.full((cell.shape[0], 3), np.nan)
    for y in range(cell.shape[0]):
        if mask[y].any():
            rows[y] = np.median(cell[y][mask[y]], axis=0)
    known = np.flatnonzero(~np.isnan(rows[:, 0]))
    if known.size == 0:
        return np.tile(np.asarray(fallback, dtype=float), (cell.shape[0], 1))
    for channel in range(3):
        rows[:, channel] = np.interp(np.arange(cell.shape[0]), known, rows[known, channel])
    return rows


def character_box(cell):
    """Bounds of the character, taken from the line art so the ground shadow is excluded."""
    ys, xs = np.nonzero(cell.sum(axis=2) < 300)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def render(cell, box, backdrops):
    """Normalise one cell onto the shared canvas spec."""
    x0, y0, x1, y1 = box
    height, width = cell.shape[:2]
    scale = CHAR_HEIGHT / (y1 - y0 + 1)
    region = int(round(CANVAS / scale))

    # Canvas pixel (ox, oy) maps back to the cell by anchoring on the
    # character's horizontal centre and the shared baseline.
    px = int(round(CANVAS / 2 / scale - (x0 + x1) / 2))
    py = int(round((BASELINE - CHAR_HEIGHT) / scale - y0))

    canvas = np.zeros((region, region, 3), dtype=np.uint8)
    for oy in range(region):
        sy = oy - py
        canvas[oy, :] = backdrops[min(max(sy, 0), height - 1)].astype(np.uint8)
        if 0 <= sy < height:
            left = max(0, px)
            right = min(region, px + width)
            if left < right:
                canvas[oy, left:right] = cell[sy, left - px:right - px]
    return Image.fromarray(canvas).resize((CANVAS, CANVAS), Image.LANCZOS)


def main():
    sheet = Image.open(SHEET).convert("RGB")
    wide = np.array(sheet).astype(int)
    ink = wide.sum(axis=2) < INK_MAX

    cols = cell_bounds(ink.sum(axis=0), sheet.size[0])
    rows = cell_bounds(ink.sum(axis=1), sheet.size[1])
    assert len(cols) == GRID_COLS and len(rows) == GRID_ROWS, \
        f"grid detection failed: {len(cols)} cols x {len(rows)} rows"

    for row, (ry0, ry1) in enumerate(rows):
        for col, (rx0, rx1) in enumerate(cols):
            seat = row * GRID_COLS + col + 1
            cell = wide[ry0:ry1, rx0:rx1]
            box = character_box(cell)
            mask = backdrop_mask(cell)
            fallback = np.median(cell[mask], axis=0) if mask.any() else (215, 238, 253)
            avatar = render(cell, box, row_backdrops(cell, fallback))
            target = OUT_DIR / f"image{seat}.png"
            avatar.save(target, optimize=True)
            print(f"seat {seat}: cell {rx1 - rx0}x{ry1 - ry0} "
                  f"character {box[2] - box[0] + 1}x{box[3] - box[1] + 1} "
                  f"-> {CANVAS}x{CANVAS} {target.name}")


if __name__ == "__main__":
    main()
